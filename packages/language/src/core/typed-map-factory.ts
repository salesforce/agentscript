import type {
  Schema,
  FieldType,
  SyntaxNode,
  EmitContext,
  ParseResult,
  Parsed,
  SymbolMeta,
  CommentTarget,
  Comment,
} from './types.js';
import {
  withCst,
  SymbolKind,
  getKeyText,
  isKeyNode,
  emitKeyName,
  quoteKeyName,
  emitIndent,
  emitCommentList,
  parseResult,
  isSingularFieldType,
  keywordNames,
  parseCommentNode as sharedParseCommentNode,
} from './types.js';
import type { Dialect } from './dialect.js';
import {
  createDiagnostic,
  DiagnosticSeverity,
  DiagnosticCollector,
} from './diagnostics.js';
import { ErrorValue, Identifier, SubscriptExpression } from './expressions.js';
import { addBuilderMethods } from './field-builder.js';
import { FieldChild, ErrorBlock, isEmittable } from './children.js';
import {
  detectSameRowSplit,
  detectInlineErrorSuffix,
  captureErrorPrefix,
  mergeProperties,
} from './error-recovery.js';
import { findSuggestion } from '../lint/lint-utils.js';
import { NamedMap } from './named-map.js';
import {
  TypedDeclarationBase,
  VariableDeclarationNode,
  ParameterDeclarationNode,
} from './typed-declarations.js';
import type { TypedMapFactory, TypedMapOptions } from './factory-types.js';
import { overrideFactoryBuilderMethods } from './factory-utils.js';

export function TypedMap<T extends TypedDeclarationBase = TypedDeclarationBase>(
  kind: string,
  propertiesBlock: FieldType,
  options: TypedMapOptions = {}
): TypedMapFactory<T> {
  const modifiers = options.modifiers ?? [];
  const primitiveTypes = options.primitiveTypes ?? [];
  const hasModifier = modifiers.length > 0;
  const blockLabel = kind.replace(/Block$/, '').toLowerCase();
  const symbol: SymbolMeta = options.symbol ?? { kind: SymbolKind.Namespace };

  class TypedMapNode extends NamedMap<T> {
    static readonly __fieldKind = 'TypedMap' as const;
    static readonly kind = kind;
    static readonly isNamed = false as const;
    static readonly __isTypedMap = true as const;
    static readonly propertiesSchema = propertiesBlock.schema;
    static readonly __modifiers = modifiers;
    static readonly __primitiveTypes = primitiveTypes;
    static readonly propertiesBlock = propertiesBlock;

    constructor(entries?: Iterable<[string, T]>) {
      super(kind, { symbol, entries });
    }

    static emit(value: NamedMap<T>, ctx: EmitContext): string {
      return value.__emit(ctx);
    }

    static emitField(
      key: string,
      value: NamedMap<T>,
      ctx: EmitContext
    ): string {
      const indent = emitIndent(ctx);
      const childCtx = { ...ctx, indent: ctx.indent + 1 };
      const body = value.__emit(childCtx);
      return body ? `${indent}${key}:\n${body}` : `${indent}${key}:`;
    }

    static withProperties(newPropsBlock: FieldType) {
      return TypedMap(kind, newPropsBlock, options);
    }

    static extendProperties(additionalFields: Schema) {
      if (
        'extend' in propertiesBlock &&
        typeof propertiesBlock.extend === 'function'
      ) {
        return TypedMap(
          kind,
          propertiesBlock.extend(additionalFields),
          options
        );
      }
      throw new Error(
        `Properties block for '${kind}' does not support extend(). ` +
          'Use withProperties() instead.'
      );
    }

    static withKeyPattern(pattern: string) {
      return TypedMap(kind, propertiesBlock, {
        ...options,
        keyPattern: pattern,
      });
    }

    static parse(
      node: SyntaxNode,
      dialect: Dialect
    ): ParseResult<TypedMapNode> {
      const instance = new TypedMapNode();
      const dc = new DiagnosticCollector();
      let pendingComments: Comment[] = [];
      let lastParsed: CommentTarget | undefined;
      const elements: Array<{
        node: SyntaxNode;
        leadingComments: Comment[];
      }> = [];
      for (const child of node.namedChildren) {
        if (child.type === 'comment') {
          pendingComments.push(sharedParseCommentNode(child, 'leading'));
          continue;
        }
        if (child.type === 'mapping_element') {
          elements.push({
            node: child,
            leadingComments: pendingComments,
          });
          pendingComments = [];
          continue;
        }
        pendingComments = [];
      }
      const elementNodes = elements.map(entry => entry.node);
      const skipIndices = new Set<number>();

      for (let i = 0; i < elements.length; i++) {
        if (skipIndices.has(i)) continue;
        const elementEntry = elements[i];
        const element = elementEntry.node;
        const leadingComments = elementEntry.leadingComments;

        const keyNode = element.childForFieldName('key');
        const keyChildren = keyNode?.namedChildren.filter(isKeyNode) ?? [];
        const name = keyChildren[0] ? getKeyText(keyChildren[0]) : '';
        const inlineComments = element.namedChildren
          .filter(c => c.type === 'comment')
          .map(c => sharedParseCommentNode(c, 'inline'));

        // Reject composite keys (e.g. "order_data asdf: string") —
        // only a single identifier is allowed.
        if (keyChildren.length > 1) {
          const keyRange = keyNode ?? element;
          dc.add(
            createDiagnostic(
              keyRange,
              `Composite key '${keyRange.text?.replace(/:$/, '') ?? name}' is not allowed; expected a single name`,
              DiagnosticSeverity.Error,
              'composite-key'
            )
          );
        }

        // Reject empty string keys (e.g. `"": string`) but continue
        // parsing with a placeholder name so the entry is still created.
        if (!name && keyChildren.length > 0) {
          const keyRange = keyNode ?? element;
          const emptyDiag = createDiagnostic(
            keyRange,
            'Empty field name is not allowed',
            DiagnosticSeverity.Error,
            'empty-field-name'
          );
          dc.add(emptyDiag);
        }

        // Validate key pattern if specified
        if (name && options.keyPattern) {
          try {
            const pattern = new RegExp(options.keyPattern);
            if (!pattern.test(name)) {
              const keyRange = keyChildren[0] ?? keyNode ?? element;
              dc.add(
                createDiagnostic(
                  keyRange,
                  `'${name}' does not match required pattern /${options.keyPattern}/`,
                  DiagnosticSeverity.Error,
                  'invalid-key-pattern'
                )
              );
            }
          } catch {
            // Invalid pattern - skip validation
          }
        }

        const colinearNode =
          element.childForFieldName('colinear_value') ??
          element.childForFieldName('expression');

        if (colinearNode) {
          const rawDecl = dialect.parseVariableDeclaration(colinearNode);

          // Check if variable name is a reserved type or modifier keyword.
          // Quoted keys (e.g. "date": object) are explicitly quoted and
          // should not be flagged as reserved.
          const reservedNames = [
            ...keywordNames(primitiveTypes),
            ...keywordNames(modifiers),
            'list',
          ];
          const isQuotedKey = keyChildren[0]?.type === 'string';
          if (name && !isQuotedKey && reservedNames.includes(name)) {
            const reservedDiag = createDiagnostic(
              keyChildren[0],
              `'${name}' is a reserved keyword and cannot be used as a variable name. Reserved: ${reservedNames.join(', ')}`,
              DiagnosticSeverity.Error,
              'reserved-name',
              {
                found: name,
                expected: reservedNames,
              }
            );
            dc.add(reservedDiag);
          }

          let declType = rawDecl.type;
          let errorPrefix: string | undefined;
          let errorPrefixNode: SyntaxNode | undefined;
          let mergedElement: SyntaxNode | undefined;
          let mergedKeyRemainder: string | undefined;

          // Capture ERROR nodes before colinear_value (e.g. "123" before "bad")
          const captured = captureErrorPrefix(element, colinearNode);

          // Capture ERROR nodes inside variable_declaration (e.g. extra
          // modifiers like "linked" in "mutable linked string")
          let innerErrorPrefix: string | undefined;
          if (colinearNode.type === 'variable_declaration') {
            const innerParts: string[] = [];
            for (const child of colinearNode.children) {
              if (child.type === 'ERROR') {
                const text = child.text?.trim();
                if (text) innerParts.push(text);
              }
            }
            if (innerParts.length > 0) {
              innerErrorPrefix = innerParts.join(' ');
            }
          }

          // Detect same-row split (e.g. "linkedd string" split across elements)
          const split = detectSameRowSplit(
            elementNodes,
            i,
            colinearNode,
            rawDecl.type
          );
          if (split) {
            // Combine ERROR prefix with split prefix (e.g. "123" + "bad" → "123bad")
            errorPrefix = captured
              ? `${captured.text}${split.errorPrefix}`
              : split.errorPrefix;
            if (captured) errorPrefixNode = captured.errorNode;
            declType = split.declType;
            mergedElement = split.mergedElement;
            mergedKeyRemainder = split.mergedKeyRemainder;
            skipIndices.add(i + 1);
          } else {
            // Detect inline ERROR suffix on same row (parser-javascript keeps
            // "linkedd string" in one element: colinear="linkedd", ERROR="string")
            const suffix = detectInlineErrorSuffix(
              element,
              colinearNode,
              rawDecl.type
            );
            if (suffix) {
              errorPrefix = captured
                ? `${captured.text}${suffix.errorPrefix}`
                : suffix.errorPrefix;
              errorPrefixNode = suffix.errorNode;
              declType = suffix.declType;
            } else if (captured) {
              errorPrefix = captured.text;
              errorPrefixNode = captured.errorNode;
            }
          }

          // Merge inner ERROR text (e.g. extra modifier "linked")
          if (innerErrorPrefix) {
            errorPrefix = errorPrefix
              ? `${errorPrefix} ${innerErrorPrefix}`
              : innerErrorPrefix;
          }

          if (hasModifier && rawDecl.modifier) {
            const modifierText = rawDecl.modifier.name;
            const modifierNames = keywordNames(modifiers);
            if (!modifierNames.includes(modifierText)) {
              const suggestion = findSuggestion(modifierText, modifierNames);
              const hint = suggestion
                ? `Did you mean '${suggestion}'?`
                : `Valid modifiers: ${modifierNames.join(', ')}`;
              const modDiag = createDiagnostic(
                colinearNode,
                `Unknown modifier '${modifierText}' for ${blockLabel} ${name}. ${hint}`,
                DiagnosticSeverity.Error,
                'invalid-modifier',
                {
                  found: modifierText,
                  expected: modifierNames,
                }
              );
              dc.add(modDiag);
            }
          }

          if (primitiveTypes.length > 0 && declType instanceof Identifier) {
            const typeName = declType.name;
            const typeNames = keywordNames(primitiveTypes);
            if (!typeNames.includes(typeName)) {
              const suggestion = findSuggestion(typeName, typeNames);
              const hint = suggestion
                ? `Did you mean '${suggestion}'?`
                : `Valid types: ${typeNames.join(', ')}`;
              const typeDiag = createDiagnostic(
                declType.__cst ? declType.__cst.range : colinearNode,
                `Unknown type '${typeName}' for ${blockLabel} ${name}. ${hint}`,
                DiagnosticSeverity.Error,
                'unknown-type',
                {
                  found: typeName,
                  expected: typeNames,
                }
              );
              dc.add(typeDiag);
            }
          } else if (
            primitiveTypes.length > 0 &&
            declType instanceof SubscriptExpression
          ) {
            const obj = declType.object;
            const idx = declType.index;

            // Only `list[T]` is a valid subscript type
            if (!(obj instanceof Identifier) || obj.name !== 'list') {
              const typeName =
                obj instanceof Identifier
                  ? obj.name
                  : obj.__emit({ indent: 0 });
              const paramDiag = createDiagnostic(
                obj as Parsed<object>,
                `'${typeName}' does not support type parameters. Only 'list' supports type parameters (e.g., list[string]).`,
                DiagnosticSeverity.Error,
                'invalid-type-parameter',
                { found: typeName }
              );
              dc.add(paramDiag);
            } else if (idx instanceof SubscriptExpression) {
              // Nested list: list[list[string]]
              const nestedDiag = createDiagnostic(
                idx as Parsed<object>,
                `Nested list types are not supported (e.g., list[list[string]]). Use a flat list type like list[string].`,
                DiagnosticSeverity.Error,
                'nested-list-type'
              );
              dc.add(nestedDiag);
            } else if (idx instanceof Identifier) {
              const elemType = idx.name;
              const elemTypeNames = keywordNames(primitiveTypes);
              if (!elemTypeNames.includes(elemType)) {
                const suggestion = findSuggestion(elemType, elemTypeNames);
                const hint = suggestion
                  ? `Did you mean '${suggestion}'?`
                  : `Valid element types: ${elemTypeNames.join(', ')}`;
                const elemDiag = createDiagnostic(
                  idx as Parsed<object>,
                  `Unknown list element type '${elemType}' for ${blockLabel} ${name}. ${hint}`,
                  DiagnosticSeverity.Error,
                  'unknown-type',
                  {
                    found: elemType,
                    expected: elemTypeNames,
                  }
                );
                dc.add(elemDiag);
              }
            }
          }

          const decl =
            hasModifier && rawDecl.modifier
              ? new VariableDeclarationNode({
                  type: declType,
                  defaultValue: rawDecl.defaultValue,
                  modifier: rawDecl.modifier,
                })
              : new ParameterDeclarationNode({
                  type: declType,
                  defaultValue: rawDecl.defaultValue,
                });

          // CST from full mapping_element so AST inspector highlights individual variables
          const parsed = withCst(decl, element);
          const declComments = [
            ...leadingComments.map(c => ({
              ...c,
              attachment: 'leading' as const,
            })),
            ...inlineComments.map(c => ({
              ...c,
              attachment: 'inline' as const,
            })),
          ];
          if (declComments.length > 0) {
            parsed.__comments = declComments;
          }

          // Collect properties from block_value of this element and/or a merged element
          if (mergedElement) {
            mergeProperties(
              parsed,
              element,
              mergedElement,
              mergedKeyRemainder,
              propertiesBlock,
              dialect,
              dc
            );
          } else {
            let blockNode = element.childForFieldName('block_value');
            if (!blockNode) {
              blockNode =
                element.namedChildren.find(c => c.type === 'mapping') ?? null;
            }
            if (blockNode && isSingularFieldType(propertiesBlock)) {
              const propResult = propertiesBlock.parse(blockNode, dialect);
              if (propResult.value && typeof propResult.value === 'object') {
                parsed.properties = propResult.value;
                parsed.__children.push(
                  new FieldChild(
                    'properties',
                    propResult.value,
                    propertiesBlock
                  )
                );
              }
              dc.merge(propResult);
            }
          }

          // Prepend an ErrorBlock to preserve error text (e.g. "123bad", "linkedd")
          // for round-trip emission. Stored in the declaration's own __children.
          if (errorPrefix) {
            const errorBlock = new ErrorBlock(
              errorPrefix,
              colinearNode.startCol
            );
            parsed.__children.unshift(errorBlock);

            // Emit diagnostic for invalid modifier text
            if (hasModifier) {
              const modNames = keywordNames(modifiers);
              const suggestion = findSuggestion(errorPrefix, modNames);
              const hint = suggestion
                ? `Did you mean '${suggestion}'?`
                : `Valid modifiers: ${modNames.join(', ')}`;
              const errModDiag = createDiagnostic(
                errorPrefixNode ?? colinearNode,
                `Unknown modifier '${errorPrefix}' for ${blockLabel} ${name}. ${hint}`,
                DiagnosticSeverity.Error,
                'invalid-modifier',
                {
                  found: errorPrefix,
                  expected: modNames,
                }
              );
              dc.add(errModDiag);
            }
          }

          // SAFETY: parsed is TypedDeclarationBase at runtime, matching T
          instance.set(name, parsed as Parsed<T>);
          lastParsed = parsed;
        } else if (name && element.children.some(c => c.type === 'ERROR')) {
          // No colinear_value but the element has ERROR children — the entire
          // value portion is broken. Use ErrorValue to preserve the raw text
          // so it survives round-trip emission.
          const rawElementText = element.text;
          const colonIdx = rawElementText.indexOf(':');
          const rawValueText =
            colonIdx >= 0
              ? rawElementText.substring(colonIdx + 1).trimStart()
              : '';

          if (rawValueText) {
            const errorType = withCst(new ErrorValue(rawValueText), element);
            const decl = hasModifier
              ? new VariableDeclarationNode({ type: errorType })
              : new ParameterDeclarationNode({ type: errorType });
            const parsed = withCst(decl, element);

            const declComments = [
              ...leadingComments.map(c => ({
                ...c,
                attachment: 'leading' as const,
              })),
              ...inlineComments.map(c => ({
                ...c,
                attachment: 'inline' as const,
              })),
            ];
            if (declComments.length > 0) {
              parsed.__comments = declComments;
            }

            instance.set(name, parsed as Parsed<T>);
            lastParsed = parsed;
          }
        } else if (name) {
          // Entry has a name but no value and no ERROR — type is missing.
          const typeNames = keywordNames(primitiveTypes);
          const hint =
            typeNames.length > 0
              ? `Expected a type after ':' (${typeNames.slice(0, 5).join(', ')}, ...)`
              : `Expected a type after ':'`;
          dc.add(
            createDiagnostic(
              element,
              `Missing type for ${blockLabel} '${name}'. ${hint}`,
              DiagnosticSeverity.Error,
              'missing-type',
              { expected: typeNames }
            )
          );
        }
      }

      // Flush any trailing comments after the last entry
      if (pendingComments.length > 0 && lastParsed) {
        const asTrailing = pendingComments.map(c => ({
          ...c,
          attachment: 'trailing' as const,
        }));
        lastParsed.__comments = [
          ...(lastParsed.__comments ?? []),
          ...asTrailing,
        ];
      }

      // Only attach own-level diagnostics to the node. Child diagnostics
      // are already on child nodes and will be found by collectDiagnostics.
      instance.__diagnostics = dc.own;
      // SAFETY: withCst returns Parsed<TypedMapNode> which satisfies the parse result type
      const parsed = withCst(instance, node) as Parsed<TypedMapNode>;
      return parseResult(parsed, dc.all);
    }

    __emit(ctx: EmitContext): string {
      const indent = emitIndent(ctx);
      const lines: string[] = [];
      const reservedEntryNames = new Set([
        ...keywordNames(primitiveTypes),
        ...keywordNames(modifiers),
        'list',
      ]);

      for (const [name, decl] of this.entries()) {
        if (!decl) continue;
        const allComments = decl.__comments ?? [];
        const leading = allComments.filter(c => c.attachment === 'leading');
        const inline = allComments.filter(c => c.attachment === 'inline');
        const trailing = allComments.filter(c => c.attachment === 'trailing');

        const leadingOutput = emitCommentList(leading, ctx);
        if (leadingOutput) {
          lines.push(leadingOutput);
        }

        // Preserve original quoting from source. If the key was written as
        // a quoted string (e.g. "date": object), emit it quoted. For
        // programmatically-created entries (no CST), quote reserved keywords
        // so re-parsing doesn't flag them as reserved-name errors.
        const keyChild = decl.__cst?.node
          ?.childForFieldName('key')
          ?.namedChildren.find(isKeyNode);
        const wasQuoted = keyChild
          ? keyChild.type === 'string'
          : reservedEntryNames.has(name);
        const emittedKey = wasQuoted ? quoteKeyName(name) : emitKeyName(name);
        let line = `${indent}${emittedKey}: `;

        if (
          hasModifier &&
          'modifier' in decl &&
          decl.modifier instanceof Identifier
        ) {
          line += `${decl.modifier.__emit(ctx)} `;
        }

        // Emit error prefix from ErrorBlock in declaration's __children
        for (const dc of decl.__children) {
          if (dc instanceof ErrorBlock) {
            line += `${dc.rawText} `;
            break;
          }
        }

        line += decl.type.__emit(ctx);

        if (decl.defaultValue) {
          line += ` = ${decl.defaultValue.__emit(ctx)}`;
        } else if (decl.__cst?.node?.text?.trimEnd().endsWith('=')) {
          // Preserve trailing `=` when CST had one but default value is missing.
          // Use endsWith (not includes) to avoid matching `= ""` or `= None`
          // where the `=` is mid-line with a parsed default value.
          line += ' =';
        }

        if (inline.length > 0) {
          const inlineText = inline
            .map(c => {
              if (c.value.trim().length === 0) return '#';
              const prefix = c.range ? '#' : '# ';
              return `${prefix}${c.value}`;
            })
            .join(' ');
          line += ` ${inlineText}`;
        }

        lines.push(line);

        const trailingOutput = emitCommentList(trailing, {
          ...ctx,
          indent: ctx.indent + 1,
        });
        if (trailingOutput) {
          lines.push(trailingOutput);
        }

        if (isEmittable(decl.properties)) {
          const propsOutput = decl.properties.__emit({
            ...ctx,
            indent: ctx.indent + 1,
          });
          if (propsOutput) {
            lines.push(propsOutput);
          }
        }
      }

      return lines.join('\n');
    }
  }

  const base = addBuilderMethods(TypedMapNode);
  if (options.description) {
    Object.defineProperty(base, '__metadata', {
      value: { description: options.description },
      writable: true,
      configurable: true,
      enumerable: true,
    });
  }
  Object.defineProperty(base, '__clone', {
    value: () => TypedMap(kind, propertiesBlock, options),
    writable: true,
    configurable: true,
    enumerable: true,
  });
  overrideFactoryBuilderMethods(base);
  // SAFETY: base is structurally TypedMapFactory<T> after method population
  return base as unknown as TypedMapFactory<T>;
}
