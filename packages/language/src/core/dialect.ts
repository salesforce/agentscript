/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type {
  Schema,
  FieldType,
  SyntaxNode,
  EmitContext,
  ParseResult,
  Parsed,
  InferFields,
  Comment,
  CommentAttachment,
  CommentTarget,
  CstMeta,
  Range,
  CollectionFieldType,
} from './types.js';

/** A comment that has source-location range info (i.e. was parsed from source). */
type RangedComment = Comment & { range: Range };

/** Type guard: narrows a Comment to RangedComment when `range` is present. */
function hasRange(c: Comment): c is RangedComment {
  return c.range !== undefined;
}
import {
  withCst,
  toRange,
  getKeyText,
  isKeyNode,
  getValueNodes,
  parseResult,
  isSingularFieldType,
  isNamedCollectionFieldType,
  isNamedMap,
  parseCommentNode as sharedParseCommentNode,
  resolveWildcardField,
} from './types.js';
import {
  Diagnostic,
  DiagnosticSeverity,
  DiagnosticCollector,
  createDiagnostic,
  createParserDiagnostic,
  DeprecatedFieldDiagnostic,
} from './diagnostics.js';
import type { Expression } from './expressions.js';
import {
  BooleanLiteral,
  NoneLiteral,
  Identifier,
  Ellipsis,
  ErrorValue,
  expressionParsers,
} from './expressions.js';
import type { Statement } from './statements.js';
import { statementParsers, UnknownStatement } from './statements.js';
import { NamedMap } from './named-map.js';
import type { BlockCore } from './named-map.js';
import { VariableDeclarationNode } from './typed-declarations.js';
import {
  FieldChild,
  UntypedBlock,
  defineFieldAccessors,
  untypedFieldType,
  ErrorBlock,
  StatementChild,
  attachElementText,
  isEmittable,
} from './children.js';
import type { BlockChild } from './children.js';
import { CommentAttacher, attach } from './comment-attacher.js';
import { errorBlockFromNode } from './error-recovery.js';
import { findSuggestion, formatSuggestionHint } from '../lint/lint-utils.js';

// ---------------------------------------------------------------------------
// Discriminant Config — enables field-value-based schema variant resolution
// ---------------------------------------------------------------------------

/**
 * Configuration for discriminant-based schema variant resolution.
 * When provided to `parseMappingElements`, a pre-scan extracts the
 * discriminant field value and selects the corresponding variant schema.
 */
export interface DiscriminantConfig {
  /** The field name whose value selects the variant (e.g., "kind") */
  field: string;
  /** Variant schemas keyed by discriminant value, already merged with base schema */
  variants: Record<string, Record<string, FieldType>>;
  /** Valid variant names for error messages */
  validValues: string[];
}

/**
 * Pre-scan mapping elements for a discriminant field and extract its string value.
 * Returns the value and the CST node of the value (for diagnostics), or undefined
 * if the field is not found.
 */
function prescanDiscriminantValue(
  elements: SyntaxNode[],
  fieldName: string
): { value: string; cstNode: SyntaxNode } | undefined {
  for (const element of elements) {
    if (element.type !== 'mapping_element') continue;
    const keyNode = element.childForFieldName('key');
    if (!keyNode) continue;
    if (getKeyText(keyNode) !== fieldName) continue;

    // Found the discriminant element — extract its colinear string value
    const { colinearValue } = getValueNodes(element);
    if (!colinearValue) continue;

    // Navigate to the actual expression node
    const exprNode =
      colinearValue.childForFieldName('expression') ?? colinearValue;
    const text = exprNode.text?.trim();
    if (!text) continue;

    // Handle quoted strings — strip quotes
    if (
      (text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'"))
    ) {
      return { value: text.slice(1, -1), cstNode: exprNode };
    }
    // Unquoted identifier
    return { value: text, cstNode: exprNode };
  }
  return undefined;
}

/**
 * Scan forward from `startIndex` in `elements` and collect contiguous siblings
 * whose column is strictly greater than `parentColumn`.
 *
 * This implements "orphan adoption": parser's error recovery can break
 * nesting and leave child mapping_elements as siblings of their logical parent.
 * We detect this via source indentation and re-parent them.
 *
 * NOTE: This relies on parser's current ERROR recovery behavior (tested
 * against parser 0.24.x) where ERROR nodes preserve child structure.
 * If parser changes how it flattens ERROR children this may need updating.
 *
 * @returns The adopted siblings and the new element index (pointing at the last
 *          adopted element), or `undefined` if nothing was adopted.
 */
function collectAdoptedSiblings(
  elements: SyntaxNode[],
  startIndex: number,
  parentColumn: number
): { adopted: SyntaxNode[]; newIndex: number } | undefined {
  let lookahead = startIndex + 1;
  while (lookahead < elements.length) {
    const next = elements[lookahead];
    if (next.startCol <= parentColumn) break;
    lookahead++;
  }
  if (lookahead > startIndex + 1) {
    return {
      adopted: elements.slice(startIndex + 1, lookahead),
      newIndex: lookahead - 1,
    };
  }
  return undefined;
}

/** Type guard for values with a `statements` array (e.g., ProcedureValueNode). */
function hasProcedureStatements(
  value: unknown
): value is { statements: Statement[] } {
  return (
    value != null &&
    typeof value === 'object' &&
    'statements' in value &&
    Array.isArray((value as { statements: unknown }).statements)
  );
}

/** Extract the key's source range from a mapping_element CST node. */
function getElementKeyRange(element: SyntaxNode): Range | undefined {
  const keyNode = element.childForFieldName('key');
  const keyChild = keyNode?.namedChildren.find(isKeyNode);
  if (keyChild) return toRange(keyChild);
  if (keyNode) return toRange(keyNode);
  return undefined;
}

/**
 * Collect diagnostics for ERROR and MISSING direct children of a CST node.
 *
 * Called at each AST parse boundary (mapping elements, expressions,
 * statements, root) so that diagnostics are attached to the AST node
 * that owns that CST region — consistent with how all other diagnostics
 * flow through `__diagnostics` → `collectDiagnostics()`.
 *
 * Checks ALL children (named + anonymous) since MISSING nodes for
 * punctuation tokens (`:`, `=`, quotes) are anonymous.
 */
function collectAllCstDiagnostics(root: SyntaxNode): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  collectCstDiagnosticsInner(root, diagnostics);
  return diagnostics;
}

/**
 * Compute a diagnostic range for a MISSING CST node.
 *
 * MISSING nodes are zero-width and sit where the parser gave up, which is
 * often the start of the *next* line (after consuming the newline). Anchor
 * the range to the previous sibling's end so the squiggly appears on the
 * line where the token was actually expected.
 */
function missingNodeRange(node: SyntaxNode): Range {
  const range = toRange(node);
  const prev = node.previousSibling;
  if (
    prev &&
    range.start.line === range.end.line &&
    range.start.character === range.end.character &&
    prev.endPosition.row < node.startPosition.row
  ) {
    const end = prev.endPosition;
    return {
      start: { line: end.row, character: end.column },
      end: { line: end.row, character: end.column },
    };
  }
  return range;
}

function collectCstDiagnosticsInner(
  node: SyntaxNode,
  diagnostics: Diagnostic[]
): void {
  for (const child of node.children) {
    if (child.isMissing) {
      diagnostics.push(
        createParserDiagnostic(
          missingNodeRange(child),
          `Missing ${child.type}`,
          'missing-token'
        )
      );
    } else if (child.isError) {
      // Skip ERROR nodes inside run_statement — RunStatement.parse
      // produces a more specific diagnostic for `with ...` errors.
      if (node.type !== 'run_statement') {
        const text = child.text?.trim();
        diagnostics.push(
          createParserDiagnostic(
            child,
            text
              ? `Syntax error: unexpected \`${text.length > 40 ? text.slice(0, 40) + '…' : text}\``
              : 'Syntax error',
            'syntax-error'
          )
        );
      }
      // Recurse into ERROR children to catch nested MISSING/ERROR nodes
      collectCstDiagnosticsInner(child, diagnostics);
    } else {
      collectCstDiagnosticsInner(child, diagnostics);
    }
  }
}

export class Dialect {
  /** Parse source from parser CST using the given schema. */
  parse<T extends Schema>(
    node: SyntaxNode,
    schema: T
  ): ParseResult<InferFields<T>>;
  parse(
    node: SyntaxNode,
    schema: Record<string, FieldType>
  ): ParseResult<Record<string, unknown>> {
    const docComments: Comment[] = [];
    let mappingNode: SyntaxNode | null = null;

    for (const child of node.namedChildren) {
      if (child.type === 'comment') {
        const attachment: CommentAttachment = mappingNode
          ? 'trailing'
          : 'leading';
        docComments.push(this.parseComment(child, attachment));
      } else if (child.type === 'mapping') {
        mappingNode = child;
      } else if (child.namedChildren.some(c => c.type === 'mapping_element')) {
        mappingNode = child;
      }
    }

    if (
      !mappingNode &&
      node.namedChildren.some(c => c.type === 'mapping_element')
    ) {
      mappingNode = node;
    }

    // Collect root-level siblings outside the mapping node (e.g., ERROR
    // nodes wrapping invalid content). Feed them into parseMappingElements
    // so ERROR recovery can extract valid blocks and diagnose the rest.
    const effectiveNode = mappingNode ?? node;
    let elements = effectiveNode.namedChildren;
    if (mappingNode && mappingNode !== node) {
      const extra: SyntaxNode[] = [];
      for (const child of node.namedChildren) {
        if (child === mappingNode || child.type === 'comment') continue;
        extra.push(child);
      }
      if (extra.length > 0) {
        elements = [...elements, ...extra];
      }
    }

    const result = this.parseMappingElements(elements, schema, effectiveNode);

    // When the document is degenerate:
    // 1. Root is ERROR (e.g., "->", "run") — no source_file wrapper
    // 2. Root has no schema matches and only ErrorBlocks (e.g., "!@#$%^&")
    // Replace fragmented ErrorBlocks with a single one from the root text.
    const resultChildren = result.value.__children as BlockChild[] | undefined;
    const childArr = Array.isArray(resultChildren) ? resultChildren : [];
    const hasSchemaContent = Object.keys(schema).some(
      k => result.value[k] !== undefined
    );
    const allErrorBlocks =
      childArr.length > 0 && childArr.every(c => c instanceof ErrorBlock);
    if (
      !hasSchemaContent &&
      (node.isError || childArr.length === 0 || allErrorBlocks)
    ) {
      // Don't create ErrorBlock when root only has comments — the comments
      // are already attached via docComments and would be emitted twice.
      const hasNonCommentContent = node.namedChildren.some(
        c => c.type !== 'comment'
      );
      if (hasNonCommentContent) {
        const text = node.text?.trim();
        if (text) {
          (result.value as Record<string, unknown>).__children = [
            new ErrorBlock(node.text, node.startCol),
          ];
        }
      }
    }

    // Single post-order pass: collect all ERROR/MISSING diagnostics from the
    // entire CST tree. Push to both value.__diagnostics (for collectDiagnostics
    // AST walk) and result.diagnostics (for direct callers like parseWithDiagnostics).
    const cstDiagnostics = collectAllCstDiagnostics(node);
    if (cstDiagnostics.length > 0) {
      result.value.__diagnostics.push(...cstDiagnostics);
      result.diagnostics.push(...cstDiagnostics);
    }

    if (docComments.length > 0) {
      // Skip attaching doc comments when all children are ErrorBlocks —
      // the ErrorBlock rawText already contains the comment lines and
      // attaching them separately would cause duplication on emission.
      const finalChildren = (result.value as Record<string, unknown>)
        .__children as BlockChild[] | undefined;
      const finalAllErrors =
        Array.isArray(finalChildren) &&
        finalChildren.length > 0 &&
        finalChildren.every(c => c instanceof ErrorBlock);
      if (!finalAllErrors) {
        attach(result.value, docComments);
      }
    }

    return result;
  }

  parseComment(
    node: SyntaxNode,
    attachment: CommentAttachment = 'leading'
  ): Comment {
    return sharedParseCommentNode(node, attachment);
  }

  /** Build the schema path by walking up the CST to the document root. */
  private buildContextPath(node: SyntaxNode): string[] {
    const path: string[] = [];
    let current: SyntaxNode | null = node;

    while (current && current.type !== 'document') {
      if (current.type === 'mapping_element') {
        const keyNode = current.childForFieldName('key');
        const keyChildren = keyNode?.namedChildren.filter(isKeyNode);
        const ids = keyChildren?.map(n => getKeyText(n)) ?? [];
        if (ids.length > 0) {
          path.unshift(...ids);
        }
      }

      current = current.parent;
    }

    return path;
  }

  /**
   * Build a human-readable location string for diagnostics in statement context.
   * e.g. `" in topic 'test' before_reasoning"` from path [topic, test, before_reasoning].
   */
  private formatStatementContext(node: SyntaxNode): string {
    const ctx = this.buildContextPath(node.parent ?? node);
    if (ctx.length === 0) return '';
    // ctx is e.g. ["topic", "test", "before_reasoning"]
    // Format: " in topic 'test' before_reasoning"
    if (ctx.length >= 3) {
      const fieldName = ctx[ctx.length - 1];
      const blockKind = ctx[0];
      const blockName = ctx.slice(1, ctx.length - 1).join(' ');
      return ` in ${blockKind} '${blockName}' ${fieldName}`;
    }
    if (ctx.length === 2) {
      return ` in ${ctx[0]} '${ctx[1]}'`;
    }
    return ` in ${ctx[0]}`;
  }

  /**
   * Parse a mapping block using the given schema.
   * Infers cardinality from key structure (1 id = singular, 2 ids = map).
   */
  parseMapping<T extends Schema>(
    node: SyntaxNode,
    schema: T,
    extraElements?: SyntaxNode[],
    options?: {
      preserveOrphanedStatements?: boolean;
      discriminant?: DiscriminantConfig;
    }
  ): ParseResult<InferFields<T>> {
    const elements = extraElements
      ? [...node.namedChildren, ...extraElements]
      : node.namedChildren;
    const result = this.parseMappingElements(
      elements,
      schema,
      node,
      options?.discriminant
    );

    // Preserve orphaned statement nodes (run_statement, if_statement, etc.)
    // that parser error recovery pushed out of their procedure context
    // into this mapping. These are skipped by parseMappingElements because
    // parseBlockContent normally handles them, but parseMapping callers
    // (NamedBlock.parseMapping, root parse) don't use parseBlockContent.
    // Callers that also use parseStatementNodes (parseBlockContent) pass
    // preserveOrphanedStatements: false to avoid duplication.
    if (options?.preserveOrphanedStatements !== false) {
      const childArr = (result.value as Record<string, unknown>).__children as
        | BlockChild[]
        | undefined;
      if (Array.isArray(childArr)) {
        for (const element of elements) {
          if (element.type in statementParsers) {
            const errBlock = errorBlockFromNode(element);
            if (errBlock) childArr.push(errBlock);
          }
        }
      }
    }

    return result;
  }

  /**
   * Core parsing engine used by parseMapping() and Sequence.
   * Accepts an explicit list of elements so callers can merge elements
   * from different CST locations.
   */
  parseMappingElements<T extends Schema>(
    elements: SyntaxNode[],
    schema: T,
    cstNode: SyntaxNode,
    discriminant?: DiscriminantConfig
  ): ParseResult<InferFields<T>> {
    // -- Discriminant pre-scan: resolve variant schema before main loop --
    let effectiveSchema: T = schema;
    const discriminantDiags: Diagnostic[] = [];
    if (discriminant) {
      const scan = prescanDiscriminantValue(elements, discriminant.field);
      if (scan) {
        const variantSchema = discriminant.variants[scan.value];
        if (variantSchema) {
          effectiveSchema = variantSchema as unknown as T;
        } else {
          discriminantDiags.push(
            createDiagnostic(
              scan.cstNode,
              `Unknown variant '${scan.value}' for discriminant '${discriminant.field}'. Valid values: ${discriminant.validValues.join(', ')}`,
              DiagnosticSeverity.Error,
              'unknown-variant'
            )
          );
        }
      }
      // If discriminant field not found, use base schema;
      // missing-field lint will catch it separately.
    }
    // Replace schema reference for the rest of parsing
    schema = effectiveSchema;

    const fields: Record<string, unknown> = {};
    interface CollectionEntry {
      set(key: string, value: BlockCore): unknown;
      __cst?: CstMeta;
      __diagnostics: Diagnostic[];
    }
    const collections: Record<string, CollectionEntry> = {};
    const dc = new DiagnosticCollector();
    // Merge any diagnostics from discriminant resolution
    for (const d of discriminantDiags) dc.add(d);
    const children: BlockChild[] = [];
    const anonymousCounts: Record<string, number> = {};
    const attacher = new CommentAttacher();

    interface EntryInfo {
      entryBlock: CollectionFieldType['entryBlock'];
      parentFieldType: FieldType;
      createContainer: () => CollectionEntry;
    }
    function resolveEntryInfo(
      ft: FieldType | undefined,
      _tid: string
    ): EntryInfo | undefined {
      if (!ft) return undefined;
      // Only NamedCollectionBlock supports sibling-keyed entries
      // (e.g., `subagent Foo:`, `subagent Bar:`).
      // Plain CollectionBlock uses nested children under a single key
      // (e.g., `tool_definitions:` with `Foo:`, `Bar:` inside).
      if (isNamedCollectionFieldType(ft)) {
        return {
          entryBlock: ft.entryBlock,
          parentFieldType: ft,
          createContainer: () =>
            new (ft as unknown as new () => CollectionEntry)(),
        };
      }
      return undefined;
    }

    // Inside ERROR nodes, schema context is from the parent level and won't
    // match nested fields -- suppress unknown-block warnings
    const insideError = cstNode.type === 'ERROR';

    for (let elementIndex = 0; elementIndex < elements.length; elementIndex++) {
      const element = elements[elementIndex];
      if (element.type === 'comment') {
        attacher.pushLeadingNode(element);
        continue;
      }

      if (element.isMissing) {
        // Diagnostic is collected by the post-walk CST pass
        continue;
      }

      if (element.type === 'ERROR') {
        // ERROR nodes are wrappers -- parse their children recursively
        const errorResult = this.parseMapping(element, schema);

        for (const key of Object.keys(schema)) {
          if (key in errorResult.value) fields[key] = errorResult.value[key];
        }

        // Recover __children from ERROR node parse
        const errorRecord: Record<string, unknown> = errorResult.value;
        const errorChildren = Array.isArray(errorRecord.__children)
          ? (errorRecord.__children as BlockChild[])
          : [];

        // Check whether the recursive parse recovered any schema-matched fields
        const recoveredSchemaFields = Object.keys(schema).some(
          k => k in errorResult.value && errorResult.value[k] !== undefined
        );

        if (errorChildren.length > 0 && recoveredSchemaFields) {
          // Some schema content was recovered — keep the recursively-parsed children
          children.push(...errorChildren);
        } else {
          // No schema content recovered — the fragmented ErrorBlocks from recursive
          // parsing lose anonymous tokens (e.g. "!!!" punctuation). Replace them with
          // a single ErrorBlock from the full ERROR node text for round-trip fidelity.
          const errBlock = errorBlockFromNode(element);
          if (errBlock) children.push(errBlock);
        }

        // Produce "Unrecognized syntax" diagnostic for ERROR nodes that
        // didn't recover any schema-matched content (only ErrorBlocks).
        if (!insideError) {
          const recoveredSchemaContent = Object.keys(schema).some(
            k => k in errorResult.value && errorResult.value[k] !== undefined
          );
          if (!recoveredSchemaContent) {
            const text = element.text?.trim();
            if (text) {
              dc.add(
                createParserDiagnostic(
                  element,
                  `Unrecognized syntax: ${text.length > 40 ? text.slice(0, 40) + '…' : text}`,
                  'syntax-error'
                )
              );
            }
          }
        }

        // Merge semantic diagnostics (unknown fields, etc.) from recursive parse.
        // Parser diagnostics (ERROR/MISSING) are collected by the post-walk CST pass.
        dc.merge(errorResult);

        continue;
      }

      if (element.type !== 'mapping_element') {
        // Skip known statement types, comments, and structural nodes that
        // are part of mapping_element internals (key, colinear_value, etc.)
        if (
          element.type in statementParsers ||
          element.type === 'comment' ||
          element.type === 'key' ||
          element.type === 'expression_with_to' ||
          element.type === 'expression' ||
          element.type === 'variable_declaration' ||
          element.type === 'procedure'
        ) {
          continue;
        }
        // Preserve unrecognized node types (e.g., standalone expressions,
        // templates without context) as ErrorBlocks for round-trip fidelity.
        const errBlock = errorBlockFromNode(element);
        if (errBlock) children.push(errBlock);
        continue;
      }

      // Parser diagnostics (ERROR/MISSING) within mapping_elements are
      // collected by the post-walk CST pass in parse().

      const dedentedCommentsForNextField: Comment[] = [];

      const [typeId, nameId] = this.getKeyIds(element);
      const rawFieldType = schema[typeId];
      let fieldType: FieldType | undefined = Array.isArray(rawFieldType)
        ? rawFieldType[0]
        : rawFieldType;

      // Wildcard prefix fallback — accept fields matching a registered prefix
      if (!fieldType) {
        fieldType = resolveWildcardField(schema, typeId);
      }

      const inlineComments = this.parseInlineComments(element);
      const elementComments = this.parseElementComments(element);

      if (!fieldType) {
        if (!insideError) {
          const keyNode = element.childForFieldName('key');
          const keyChildren = keyNode?.namedChildren.filter(isKeyNode);
          const keyRange = keyChildren?.[0]
            ? toRange(keyChildren[0])
            : toRange(element);

          const parentPath = this.buildContextPath(element.parent ?? element);
          const isRootLevel = parentPath.length === 0;

          const schemaKeys = Object.keys(schema);
          const suggestion = findSuggestion(typeId, schemaKeys);

          const baseMessage = isRootLevel
            ? `Unknown block: ${typeId}`
            : `Unknown field \`${typeId}\` in ${parentPath.join(' ')}`;

          const message = formatSuggestionHint(baseMessage, suggestion);
          const code = isRootLevel ? 'unknown-block' : 'unknown-field';

          const ownDiag = createDiagnostic(
            keyRange,
            message,
            DiagnosticSeverity.Warning,
            code,
            {
              ...(suggestion ? { suggestion } : {}),
              expected: schemaKeys,
            }
          );
          dc.add(ownDiag);
        }

        // Preserve unknown fields with as much structure as possible.
        // Colinear values (e.g., `num: 1`) → FieldChild with parsed expression.
        // Nested mappings → UntypedBlock with recursive children + accessors.
        const { blockValue, colinearValue, procedure } = getValueNodes(element);
        const mappingNode = blockValue?.type === 'mapping' ? blockValue : null;

        if (colinearValue) {
          // Colinear untyped field → parse value, expose as FieldChild
          const expr = this.parseExpression(colinearValue);
          const ft = untypedFieldType(element.text, element.startCol);
          const fc = new FieldChild(typeId, expr, ft);
          attachElementText(fc, element);
          // Drain pending leading comments as ErrorBlocks before the field
          if (attacher.hasPending) {
            attacher.drainAsErrorBlocks(children);
          }
          children.push(fc);
        } else {
          // Nested mapping or key-only → preserve as UntypedBlock
          const untypedBlock = new UntypedBlock(
            typeId,
            nameId,
            element.text,
            element.startCol
          );
          untypedBlock.__cst = { node: element, range: toRange(element) };
          // Attach pending leading comments and set as last target
          // so trailing comments can be flushed onto it later.
          attacher.consumeOnto(untypedBlock);

          if (mappingNode) {
            // Preserve standalone comment lines in the mapping_element that
            // sit outside the inner mapping. Comments on the key line (inline)
            // are already in the rawText header.
            const keyRow = element.startPosition.row;
            const preBlockComments: BlockChild[] = [];
            const postBlockComments: BlockChild[] = [];
            let seenMapping = false;
            for (const child of element.namedChildren) {
              if (child === mappingNode) {
                seenMapping = true;
                continue;
              }
              if (
                child.type === 'comment' &&
                child.startPosition.row !== keyRow
              ) {
                const target = seenMapping
                  ? postBlockComments
                  : preBlockComments;
                target.push(
                  new ErrorBlock(
                    `# ${sharedParseCommentNode(child, 'leading').value}`,
                    0
                  )
                );
              }
            }

            const innerResult = this.parseMappingElements(
              mappingNode.namedChildren,
              {} as Schema,
              mappingNode
            );
            const innerRecord = innerResult.value as Record<string, unknown>;
            const innerChildren = Array.isArray(innerRecord.__children)
              ? (innerRecord.__children as BlockChild[])
              : [];
            untypedBlock.__children = [
              ...preBlockComments,
              ...innerChildren,
              ...postBlockComments,
            ];
            untypedBlock.__diagnostics.push(...innerResult.diagnostics);
          } else if (procedure && procedure.type === 'procedure') {
            // Procedure block values — parse as statement children so they
            // emit at canonical indentation instead of raw text.
            const statements = this.parseProcedure(procedure);
            for (const stmt of statements) {
              untypedBlock.__children.push(new StatementChild(stmt));
            }
          }

          // Wire up property accessors for nested colinear children
          defineFieldAccessors(untypedBlock, untypedBlock.__children);
          children.push(untypedBlock);
        }

        continue;
      }

      if (fieldType.__metadata?.deprecated) {
        const keyNode = element.childForFieldName('key');
        const keyIds = keyNode?.namedChildren.filter(n => n.type === 'id');
        const keyRange = keyIds?.[0] ? toRange(keyIds[0]) : toRange(element);
        const dep = fieldType.__metadata.deprecated;
        const msg = dep.message
          ? `'${typeId}' is deprecated: ${dep.message}`
          : `'${typeId}' is deprecated`;
        const depDiag = new DeprecatedFieldDiagnostic(
          keyRange,
          msg,
          dep.replacement
        );
        dc.add(depDiag);
      }

      const { blockValue, colinearValue, procedure } = getValueNodes(element);
      const valueNode = blockValue ?? colinearValue ?? procedure;
      const entryInfo = resolveEntryInfo(fieldType, typeId);

      if (nameId && entryInfo) {
        // Two ids (e.g., "topic hello:") -- named entry
        // Detect bodyless named entry with orphaned siblings.
        // Tree-sitter error recovery can break nesting, leaving child
        // mapping_elements as siblings. Detect this via source indentation
        // and re-parent them into the block.
        const hasBody = !!(blockValue || colinearValue || procedure);
        let adoptedSiblings: SyntaxNode[] | undefined;
        if (!hasBody) {
          const result = collectAdoptedSiblings(
            elements,
            elementIndex,
            element.startCol
          );
          if (result) {
            adoptedSiblings = result.adopted;
            elementIndex = result.newIndex;
          }
        }

        const { entryBlock, parentFieldType, createContainer } = entryInfo;
        collections[typeId] ??= createContainer();
        const {
          value: parsedValue,
          extraComments,
          diagnostics: entryDiagnostics,
        } = this.parseNamedEntry(
          entryBlock,
          element,
          nameId,
          inlineComments,
          adoptedSiblings
        );
        attacher.consumeOnto(parsedValue as CommentTarget, extraComments);
        collections[typeId].set(nameId, parsedValue as BlockCore);
        const namedFc = new FieldChild(
          typeId,
          parsedValue,
          parentFieldType,
          nameId,
          getElementKeyRange(element)
        );
        children.push(namedFc);
        dc.mergeAll(entryDiagnostics);
      } else if (nameId && isSingularFieldType(fieldType)) {
        // Compound key but field is not a named type -- e.g., "reasoning foo:"
        // where "reasoning" is a singular block and "foo" is unexpected.
        // Emit a diagnostic for the unexpected name and parse as singular field
        // to recover as much as possible.
        const keyNode = element.childForFieldName('key');
        const keyChildren = keyNode?.namedChildren.filter(isKeyNode);
        // Point the diagnostic at the second key id (the unexpected name)
        const nameKeyNode = keyChildren?.[1];
        const nameRange = nameKeyNode
          ? toRange(nameKeyNode)
          : getElementKeyRange(element);
        if (nameRange) {
          dc.add(
            createDiagnostic(
              nameRange,
              `Unexpected name \`${nameId}\` on \`${typeId}\` — this field does not take a name`,
              DiagnosticSeverity.Error,
              'unexpected-block-name'
            )
          );
        }
        const singularField = fieldType;
        if (valueNode) {
          const result = singularField.parse(valueNode, this);
          attacher.consumeOnto(result.value as CommentTarget, inlineComments);
          fields[typeId] = result.value;
          const singularFc = new FieldChild(
            typeId,
            result.value,
            fieldType,
            undefined,
            getElementKeyRange(element)
          );
          children.push(singularFc);
          dc.merge(result);
        }
      } else if (entryInfo && entryInfo.entryBlock.allowAnonymous) {
        // Nameless key with allowAnonymous (e.g., "start_agent:" without a name)
        // -- parse as anonymous instance and store in the collection with a
        //    generated name so it stays in the collection tree.
        if (valueNode) {
          const keyNode = element.childForFieldName('key');
          const keyChildren = keyNode?.namedChildren.filter(isKeyNode);
          const keyRange = keyChildren?.[0]
            ? toRange(keyChildren[0])
            : toRange(element);
          const anonDiag = createDiagnostic(
            keyRange,
            `Anonymous ${typeId} name is not allowed`,
            DiagnosticSeverity.Warning,
            'anonymous-named-block'
          );
          dc.add(anonDiag);
          const idx = (anonymousCounts[typeId] =
            (anonymousCounts[typeId] ?? 0) + 1);
          const syntheticName = `ILLEGAL_anonymous_${typeId}_${idx}`;
          const {
            entryBlock: anonEntryBlock,
            parentFieldType: anonParentFt,
            createContainer,
          } = entryInfo;
          collections[typeId] ??= createContainer();
          const {
            value: parsedValue,
            extraComments,
            diagnostics: entryDiagnostics,
          } = this.parseNamedEntry(
            anonEntryBlock,
            element,
            syntheticName,
            inlineComments
          );
          attacher.consumeOnto(parsedValue as CommentTarget, extraComments);
          collections[typeId].set(syntheticName, parsedValue as BlockCore);
          const anonFc = new FieldChild(
            typeId,
            parsedValue,
            anonParentFt,
            syntheticName,
            getElementKeyRange(element)
          );
          children.push(anonFc);
          dc.mergeAll(entryDiagnostics);
        }
      } else if (isSingularFieldType(fieldType)) {
        // For Block fields with a body, detect orphaned siblings that
        // parser error recovery pushed out of the block's mapping.
        // Pass them as extraElements so they're merged into the block's
        // parseMapping call.
        let adoptedElements: SyntaxNode[] | undefined;
        if (fieldType.__fieldKind === 'Block' && valueNode) {
          const result = collectAdoptedSiblings(
            elements,
            elementIndex,
            element.startCol
          );
          if (result) {
            // Only adopt elements that are indented at or deeper than the
            // block body's children (bodyColumn), to avoid grabbing siblings
            // at the same indent as the block key.
            const bodyColumn = valueNode.startCol;
            const adopted = result.adopted.filter(
              c => c.startCol >= bodyColumn
            );
            if (adopted.length > 0) {
              adoptedElements = adopted;
              elementIndex = result.newIndex;
            }
          }
        }

        const result = this.parseSingularField(
          fieldType,
          typeId,
          element,
          valueNode,
          inlineComments,
          elementComments,
          attacher,
          adoptedElements
        );
        if (result) {
          fields[typeId] = result.value;
          const singularFc = new FieldChild(
            typeId,
            result.value,
            fieldType,
            undefined,
            getElementKeyRange(element)
          );
          children.push(singularFc);
          dc.mergeAll(result.diagnostics);
          dedentedCommentsForNextField.push(...result.dedentedComments);

          // Preserve ERROR children of the mapping_element that weren't part
          // of the parsed value (e.g., double colon `system::` where the second
          // `:` and content are in an ERROR child, or broken tokens between the
          // key and block_value like `after_reasoning:\n  frobnicate @x\n  transition to @y`).
          for (const child of element.children) {
            if (child.isError) {
              const errBlock = errorBlockFromNode(child);
              if (errBlock) children.push(errBlock);
            }
          }
        } else {
          // No value parsed — preserve the entire mapping_element as
          // an ErrorBlock for round-trip fidelity (e.g., "label: !!!broken"
          // or "instructions:" with missing value).
          const errBlock = errorBlockFromNode(element);
          if (errBlock) children.push(errBlock);

          // Emit a diagnostic when the key is present but the value is missing.
          if (!valueNode) {
            dc.add(
              createDiagnostic(
                element,
                `Missing value for '${typeId}'`,
                DiagnosticSeverity.Error,
                'missing-value'
              )
            );
          }
        }
      }

      attacher.setPending(dedentedCommentsForNextField);
    }

    attacher.flush();

    // Set __cst on top-level collection NamedMaps for diagnostic ranges.
    for (const map of Object.values(collections)) {
      if (!map.__cst) {
        map.__cst = { node: cstNode, range: toRange(cstNode) };
      }
    }

    // __children is attached as metadata (like __cst, __diagnostics) for:
    // 1. Document-level emission (emitDocument reads parsed.__children)
    // 2. ERROR node recovery (recursive parseMappingElements extracts children)
    // Block constructors receive children via explicit parameter, NOT from this object.
    // See extractChildren() in block.ts for the boundary extraction.
    const value: Record<string, unknown> = {
      ...fields,
      ...collections,
      __children: children,
    };
    // SAFETY: value structurally matches InferFields<T> after parsing against schema T
    const parsed = withCst(value, cstNode) as Parsed<InferFields<T>>;
    // Attach only own-level diagnostics to the mapping value so that
    // Block.fromParsedFields can propagate ONLY own diagnostics to the
    // block node, preventing the same diagnostic from appearing on
    // every ancestor block in the tree.
    parsed.__diagnostics = dc.own;
    return parseResult(parsed, dc.all);
  }

  /**
   * Parse a singular field value (Block, TypedMap, or Primitive).
   * Handles comment splitting (before/after body), dedented comment detection,
   * and key-only fallbacks for empty blocks and typed maps.
   */
  private parseSingularField(
    singularField: FieldType,
    typeId: string,
    element: SyntaxNode,
    valueNode: SyntaxNode | null,
    inlineComments: Comment[],
    elementComments: Comment[],
    attacher: CommentAttacher,
    extraElements?: SyntaxNode[]
  ): {
    value: unknown;
    dedentedComments: Comment[];
    diagnostics: Diagnostic[];
  } | null {
    const dedentedComments: Comment[] = [];

    if (valueNode) {
      const result = singularField.parse(valueNode, this, extraElements);
      const containerOnlyComments = elementComments.filter(
        c => c.range?.start.line !== element.startRow
      );
      const { beforeBody, afterBody } = this.splitContainerComments(
        containerOnlyComments,
        valueNode
      );
      if (
        singularField.__fieldKind === 'TypedMap' ||
        singularField.__fieldKind === 'Collection'
      ) {
        this.attachToFirstTypedMapEntry(result.value, beforeBody);
      } else if (singularField.__fieldKind === 'Primitive') {
        this.attachToFirstProcedureStatement(result.value, beforeBody);
      } else if (
        singularField.__fieldKind === 'Block' &&
        beforeBody.length > 0
      ) {
        // Block containers: attach beforeBody to the first child field
        const blockObj = result.value as Record<string, unknown>;
        const firstChildKey = Object.keys(blockObj).find(
          k =>
            !k.startsWith('__') &&
            blockObj[k] &&
            typeof blockObj[k] === 'object'
        );
        if (firstChildKey) {
          attach(blockObj[firstChildKey] as CommentTarget, beforeBody);
        }
      }
      let remainingAfterBody: Comment[] = afterBody;
      if (singularField.__fieldKind === 'Primitive') {
        // afterBody entries are guaranteed to have range info (see
        // splitContainerComments), so we can safely compare columns.
        const nestedAfterBody = afterBody.filter(
          c => c.range.start.character > element.startCol
        );
        const dedentedAfterBody = afterBody.filter(
          c => c.range.start.character <= element.startCol
        );
        const attachedToLastStmt = this.attachToLastProcedureStatement(
          result.value,
          nestedAfterBody
        );
        remainingAfterBody = attachedToLastStmt ? [] : nestedAfterBody;
        if (dedentedAfterBody.length > 0) {
          dedentedComments.push(...dedentedAfterBody);
        }
      }
      attacher.consumeOnto(result.value as CommentTarget, [
        ...inlineComments,
        ...remainingAfterBody,
      ]);

      // Attach parse diagnostics to primitive field value nodes so that
      // collectDiagnostics (AST walk) can find them. Blocks handle this
      // in Block.fromParsedFields; primitives need it here.
      if (
        singularField.__fieldKind === 'Primitive' &&
        result.diagnostics.length > 0
      ) {
        const parsed = result.value as { __diagnostics?: Diagnostic[] };
        if (parsed.__diagnostics) {
          parsed.__diagnostics.push(...result.diagnostics);
        }
      }

      return {
        value: result.value,
        dedentedComments,
        diagnostics: result.diagnostics,
      };
    }

    if (singularField.__fieldKind === 'Block') {
      // Key-only block (e.g. "messages:" with no children) — create an
      // empty instance so downstream lint passes (required-fields) can
      // detect missing required fields inside the block.
      const blockType = singularField as unknown as {
        fromParsedFields: (
          fields: Record<string, never>,
          cstNode: SyntaxNode,
          diagnostics: Diagnostic[]
        ) => ParseResult<BlockCore>;
      };
      const result = blockType.fromParsedFields(
        {} as Record<string, never>,
        element,
        []
      );
      attacher.consumeOnto(result.value as CommentTarget);
      return { value: result.value, dedentedComments, diagnostics: [] };
    }

    if (singularField.__fieldKind === 'TypedMap') {
      // Key-only TypedMap (e.g. "inputs:" with no children) —
      // create an empty NamedMap so lint can detect empty blocks.
      const entries = NamedMap.forCollection<BlockCore>(typeId);
      entries.__cst = { node: element, range: toRange(element) };
      attacher.consumeOnto(entries);
      return { value: entries, dedentedComments, diagnostics: [] };
    }

    if (singularField.__fieldKind === 'Collection') {
      // Key-only Collection (e.g. "actions:" with no children) —
      // create an empty instance so lint can detect empty blocks.
      const result = singularField.parse(element, this);
      attacher.consumeOnto(result.value as CommentTarget);
      return { value: result.value, dedentedComments, diagnostics: [] };
    }

    return null;
  }

  /** Extract comments on the same line as an element (inline comments). */
  private parseInlineComments(element: SyntaxNode): Comment[] {
    return element.children
      .filter(c => c.type === 'comment' && c.startRow === element.startRow)
      .map(c => this.parseComment(c, 'inline'));
  }

  /** Extract all comment children from an element. */
  private parseElementComments(element: SyntaxNode): Comment[] {
    return element.children
      .filter(c => c.type === 'comment')
      .map(c => this.parseComment(c));
  }

  /**
   * Split comments into those before and after a value node's range.
   *
   * Comments without source range info (programmatic comments) are always
   * placed in `beforeBody`. The `afterBody` array is guaranteed to contain
   * only comments with range info, since only comments whose source line
   * falls after the value node can land there.
   */
  private splitContainerComments(
    comments: Comment[],
    valueNode: SyntaxNode | null
  ): { beforeBody: Comment[]; afterBody: RangedComment[] } {
    if (!valueNode) {
      return { beforeBody: comments, afterBody: [] };
    }

    const beforeBody: Comment[] = [];
    const afterBody: RangedComment[] = [];
    for (const c of comments) {
      const line = c.range?.start.line;
      if (line === undefined) {
        // No source location — treat as before-body (programmatic comment).
        beforeBody.push(c);
        continue;
      }
      if (line < valueNode.startRow) {
        beforeBody.push(c);
        continue;
      }
      if (line > valueNode.endRow) {
        const trailing = { ...c, attachment: 'trailing' as const };
        if (hasRange(trailing)) {
          afterBody.push(trailing);
        }
        continue;
      }
      // Comments inside the body range are treated as before-body container comments.
      beforeBody.push(c);
    }
    return { beforeBody, afterBody };
  }

  /** Attach comments to the first entry of a TypedMap-like value. */
  private attachToFirstTypedMapEntry(
    value: unknown,
    comments: Comment[]
  ): void {
    if (comments.length === 0) return;
    if (!isNamedMap(value)) return;

    const iterator = value.entries() as IterableIterator<
      [string, CommentTarget]
    >;
    const first = iterator.next();
    if (first.done) return;

    attach(first.value[1], comments);
  }

  /** Attach comments to the first statement in a procedure-like value. */
  private attachToFirstProcedureStatement(
    value: unknown,
    comments: Comment[]
  ): void {
    if (comments.length === 0) return;
    if (!hasProcedureStatements(value)) return;
    attach(value.statements[0], comments);
  }

  /** Attach comments as trailing to the last statement in a procedure-like value. */
  private attachToLastProcedureStatement(
    value: unknown,
    comments: Comment[]
  ): boolean {
    if (comments.length === 0) return false;
    if (!hasProcedureStatements(value)) return false;

    const lastStmt = value.statements[value.statements.length - 1];
    const tagged = comments.map(c => ({
      ...c,
      attachment: 'trailing' as CommentAttachment,
    }));
    attach(lastStmt, tagged);
    return true;
  }

  private parseNamedEntry(
    FieldType: CollectionFieldType['entryBlock'],
    element: SyntaxNode,
    nameId: string,
    inlineComments: Comment[],
    adoptedSiblings?: SyntaxNode[]
  ): { value: unknown; extraComments: Comment[]; diagnostics: Diagnostic[] } {
    const { blockValue, colinearValue, procedure } = getValueNodes(element);
    const valueNode = blockValue ?? colinearValue ?? procedure;
    const dc = new DiagnosticCollector();
    const nonInlineElementComments = element.children
      .filter(c => c.type === 'comment')
      .filter(c => c.startRow !== element.startRow)
      .map(c => this.parseComment(c, 'trailing'));

    let parsedValue: CommentTarget;
    if (valueNode) {
      const result = FieldType.parse(valueNode, nameId, this);
      parsedValue = result.value as CommentTarget;
      dc.merge(result);
    } else {
      const result = FieldType.parse(element, nameId, this, adoptedSiblings);
      parsedValue = result.value as CommentTarget;
      dc.merge(result);
    }

    return {
      value: parsedValue,
      extraComments: [...inlineComments, ...nonInlineElementComments],
      diagnostics: dc.all,
    };
  }

  /** Returns [typeId, nameId?] where nameId is present for 2-id keys. */
  getKeyIds(element: SyntaxNode): [string, string | undefined] {
    const keyNode = element.childForFieldName('key');
    if (!keyNode) return ['', undefined];

    const keyChildren = keyNode.namedChildren.filter(isKeyNode);
    if (keyChildren.length === 2) {
      return [getKeyText(keyChildren[0]), getKeyText(keyChildren[1])];
    }
    return [keyChildren[0] ? getKeyText(keyChildren[0]) : '', undefined];
  }

  /** Parse an expression from CST, dispatching by node type. */
  parseExpression(node: SyntaxNode): Expression {
    if (!node) {
      return new Identifier('');
    }
    if (node.isMissing) {
      // MISSING nodes are zero-width phantoms inserted by tree-sitter where
      // it expected a token. They must NOT emit any text — emitting the node
      // type name (e.g., "id") would inject phantom tokens that create a
      // different tree on re-parse, breaking round-trip stability.
      const expr = withCst(new ErrorValue(''), node);
      expr.__diagnostics.push(
        createParserDiagnostic(
          missingNodeRange(node),
          `Missing ${node.type}`,
          'missing-token'
        )
      );
      return expr;
    }

    if (node.isError) {
      const text = node.text?.trim();
      const expr = withCst(new Identifier(text || ''), node);
      expr.__diagnostics.push(
        createParserDiagnostic(
          node,
          text
            ? `Syntax error: unexpected \`${text.length > 40 ? text.slice(0, 40) + '…' : text}\``
            : 'Syntax error',
          'syntax-error'
        )
      );
      return expr;
    }

    if (node.type === 'atom' || node.type === 'expression') {
      return this.unwrapExpression(node);
    }

    if (node.type === 'expression_with_to') {
      const exprNode = node.childForFieldName('expression');
      if (exprNode) return this.parseExpression(exprNode);
    }

    if (node.type === 'parenthesized_expression') {
      if (node.namedChildren.length > 0) {
        return this.parseExpression(node.namedChildren[0]);
      }
    }

    const expressionParserMap: Record<
      string,
      | ((
          node: SyntaxNode,
          parseExpr: (n: SyntaxNode) => Expression
        ) => Expression)
      | undefined
    > = expressionParsers;
    const parser = expressionParserMap[node.type];
    if (parser) {
      const result = parser(node, (n: SyntaxNode) => this.parseExpression(n));
      // Parser diagnostics (ERROR/MISSING) are collected by the post-walk CST pass
      return result;
    }

    const fallback = withCst(new Identifier(node.text), node);
    return fallback;
  }

  /** Unwrap atom/expression wrapper nodes that delegate to children. */
  private unwrapExpression(node: SyntaxNode): Expression {
    if (node.namedChildren.length > 0) {
      return this.parseExpression(node.namedChildren[0]);
    }
    const text = node.text;
    if (text === 'True' || text === 'False') {
      return withCst(new BooleanLiteral(text === 'True'), node);
    }
    if (text === 'None') {
      return withCst(new NoneLiteral(), node);
    }
    if (text === '...') {
      return withCst(new Ellipsis(), node);
    }
    return this.parseExpression(node.children[0]);
  }

  parseProcedure(node: SyntaxNode): Statement[] {
    const children =
      node.type === 'procedure' || node.type === 'mapping'
        ? node.namedChildren
        : [node];
    return this.parseStatementNodes(children, true);
  }

  /**
   * Parse both mapping fields and statements from a block body node.
   * Works uniformly for procedure, mapping, or mixed block bodies.
   */
  parseBlockContent<T extends Schema>(
    node: SyntaxNode,
    blockSchema: T,
    options?: { discriminant?: DiscriminantConfig }
  ): {
    fields: InferFields<T>;
    statements: Statement[];
    diagnostics: Diagnostic[];
  } {
    // Don't preserve orphaned statements in mapping result since
    // parseStatementNodes handles them separately.
    const mappingResult = this.parseMapping(node, blockSchema, undefined, {
      preserveOrphanedStatements: false,
      discriminant: options?.discriminant,
    });
    const statements = this.parseStatementNodes(node.namedChildren);
    return {
      fields: mappingResult.value,
      statements,
      diagnostics: mappingResult.diagnostics,
    };
  }

  /**
   * Parse an array of CST nodes as statements.
   * @param procedureContext When true, mapping_element nodes are flagged as
   *   invalid (procedures should only contain statements). When false
   *   (default), mapping_element and comment nodes are silently skipped
   *   because they are handled by parseMapping in parseBlockContent.
   */
  parseStatementNodes(
    nodes: SyntaxNode[],
    procedureContext = false
  ): Statement[] {
    const statements: Statement[] = [];
    const attacher = new CommentAttacher();
    for (const node of nodes) {
      if (node.type === 'comment') {
        if (
          !attacher.tryAttachInline(node, statements[statements.length - 1])
        ) {
          attacher.pushLeadingNode(node);
        }
        continue;
      }

      if (node.isMissing) {
        const missing = withCst(new UnknownStatement(''), node);
        missing.__diagnostics.push(
          createParserDiagnostic(
            missingNodeRange(node),
            `Missing ${node.type}`,
            'missing-token'
          )
        );
        statements.push(missing);
        continue;
      }

      if (node.type === 'ERROR') {
        // Preserve full ERROR text as UnknownStatement for round-trip fidelity.
        const text = node.text.trim();
        if (text) {
          const unknown = withCst(new UnknownStatement(text), node);
          unknown.__diagnostics.push(
            createParserDiagnostic(
              node,
              `Unrecognized syntax${this.formatStatementContext(node)}: ${text.length > 40 ? text.slice(0, 40) + '…' : text}`,
              'syntax-error'
            )
          );
          statements.push(unknown);
        }
        continue;
      }

      const result = this.parseStatement(node, procedureContext);
      if (!result) continue;

      if (Array.isArray(result)) {
        attacher.consumeOntoFirst(result);
        statements.push(...result);
      } else {
        attacher.consumeOnto(result);
        statements.push(result);
      }
    }

    attacher.flush();

    return statements;
  }

  /**
   * Parse a single statement from CST.
   * May return an array for desugared nodes (e.g. comma-separated with clauses).
   * Returns an UnknownStatement with a diagnostic for unrecognized node types
   * in procedure context, so content is never silently dropped.
   */
  parseStatement(
    node: SyntaxNode,
    procedureContext = false
  ): Statement | Statement[] | null {
    const parser = statementParsers[node.type];
    if (!parser) {
      // Always skip comments in any context
      if (node.type === 'comment') {
        return null;
      }
      // In block content context, mapping_element is handled
      // by parseMapping — skip it here.
      if (!procedureContext && node.type === 'mapping_element') {
        return null;
      }
      const text = node.text.trim();
      if (!text) return null;
      const unknown = withCst(new UnknownStatement(text), node);
      unknown.__diagnostics.push(
        createParserDiagnostic(
          node,
          `Unrecognized syntax${this.formatStatementContext(node)}: ${text}`,
          'syntax-error'
        )
      );
      return unknown;
    }
    const parsed = parser(
      node,
      (n: SyntaxNode) => this.parseExpression(n),
      (n: SyntaxNode) => this.parseProcedure(n),
      (n: SyntaxNode) => this.parseStatement(n)
    );
    // Parser diagnostics (ERROR/MISSING) are collected by the post-walk CST pass
    const inlineComments = node.namedChildren
      .filter(c => c.type === 'comment' && c.startRow === node.startRow)
      .map(c => this.parseComment(c, 'inline'));
    if (inlineComments.length > 0) {
      if (Array.isArray(parsed)) {
        if (parsed.length > 0) {
          attach(parsed[parsed.length - 1], inlineComments);
        }
      } else {
        attach(parsed, inlineComments);
      }
    }
    return parsed;
  }

  parseVariableDeclaration(node: SyntaxNode): Parsed<VariableDeclarationNode> {
    let modifier: Identifier | undefined;
    let typeExpr: Expression;
    let defaultValue: Expression | undefined;

    if (node.type === 'variable_declaration') {
      const modifierNode = node.children.find(
        c => c.type === 'mutable' || c.type === 'linked'
      );
      if (modifierNode) {
        modifier = withCst(new Identifier(modifierNode.text), modifierNode);
      }

      const typeNode = node.childForFieldName('type');
      const defaultNode = node.childForFieldName('default');

      typeExpr = typeNode
        ? this.parseExpression(typeNode)
        : withCst(new Identifier('unknown'), node);
      defaultValue = defaultNode
        ? this.parseExpression(defaultNode)
        : undefined;
    } else if (node.type === 'assignment_expression') {
      const leftNode = node.childForFieldName('left');
      const rightNode = node.childForFieldName('right');

      typeExpr = leftNode
        ? this.parseExpression(leftNode)
        : withCst(new Identifier('unknown'), node);
      defaultValue = rightNode ? this.parseExpression(rightNode) : undefined;
    } else {
      typeExpr = this.parseExpression(node);
    }

    return withCst(
      new VariableDeclarationNode({
        type: typeExpr,
        defaultValue,
        modifier,
      }),
      node
    );
  }

  emit(value: unknown, indent: number = 0): string {
    const ctx: EmitContext = { indent };

    if (isEmittable(value)) {
      return value.__emit(ctx);
    }

    if (typeof value === 'string') {
      const escaped = value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\t/g, '\\t')
        .replace(/\r/g, '\\r');
      return `"${escaped}"`;
    }

    if (typeof value === 'number') {
      return String(value);
    }

    if (typeof value === 'boolean') {
      return value ? 'True' : 'False';
    }

    return String(value);
  }
}
