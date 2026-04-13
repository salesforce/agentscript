/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * `parseComponent()` — parse a standalone block, statement, or expression.
 *
 * Returns the block/statement/expression instance directly.
 * The result is suitable for plugging into `Document.addEntry()` or `Document.setField()`.
 *
 * Never throws — returns `undefined` (or `[]` for statements) on failure.
 *
 */

import { parseAndLint, isNamedMap } from '@agentscript/language';
import type { Diagnostic, Range, SyntaxNode } from '@agentscript/types';
import type { Expression, Statement } from '@agentscript/language';
import { agentforceDialect } from '@agentscript/agentforce-dialect';
import type { AgentforceSchema as AgentforceSchemaType } from '@agentscript/agentforce-dialect';
import type {
  ComponentResultMap,
  SerializedCSTNode,
  ParseComponentDebugResult,
} from './types.js';
import { getParser } from './parser.js';
import { getComponentKindConfig } from './component-kind.js';

/** Compute the number of newlines in a prefix string. */
function countPrefixLines(prefix: string): number {
  return prefix.split('\n').length - 1;
}

/**
 * Core parse logic shared by `parseComponent` and `parseComponentDebug`.
 *
 * Wraps the source, runs the parser, and extracts the component from the AST.
 * Returns `undefined` if the kind is unknown.
 */
function parseComponentCore(source: string, kind: string) {
  const config = getComponentKindConfig(kind);
  if (!config) return undefined;

  const parser = getParser();
  const wrappedSource = config.wrap(source);
  const { rootNode: adaptedRoot } = parser.parse(wrappedSource);
  const { ast, diagnostics } = config.parse(adaptedRoot);
  const component = config.extract(ast) ?? null;
  return { config, parser, wrappedSource, component, diagnostics };
}

/** Subtract wrapper offsets from a range, clamping to zero. */
function adjustRange(
  range: Range,
  lineOffset: number,
  columnOffset: number
): void {
  range.start.line = Math.max(0, range.start.line - lineOffset);
  range.start.character = Math.max(0, range.start.character - columnOffset);
  range.end.line = Math.max(0, range.end.line - lineOffset);
  range.end.character = Math.max(0, range.end.character - columnOffset);
}

/**
 * Parse a standalone AgentScript component (block, statement, or expression).
 *
 * For block kinds (e.g. `'topic'`, `'config'`), the source should be a complete
 * block with header. Returns the block instance directly — it already has
 * `__emit()`, `__kind`, `__children`, `__name`, `__diagnostics`.
 *
 * For `'statement'`, the source should be one or more statements (e.g. `if`, `run`).
 * Returns an array of Statement objects.
 *
 * For `'expression'`, the source should be a single expression.
 * Returns the Expression object.
 *
 * Never throws — returns `undefined` (or `[]` for statements) on failure.
 *
 * @example
 * ```typescript
 * import { parseComponent } from '@agentscript/agentforce';
 *
 * // Parse a topic block — return type is inferred as ParsedTopic
 * const topic = parseComponent(
 *   'topic billing:\n  description: "Handle billing"',
 *   'topic'
 * );
 * doc.addEntry('topic', 'billing', topic);
 *
 * // Parse a statement
 * const stmts = parseComponent('run MyAction()', 'statement');
 *
 * // Parse an expression
 * const expr = parseComponent('"hello " + name', 'expression');
 * ```
 */
export function parseComponent(source: string, kind: 'statement'): Statement[];
export function parseComponent(
  source: string,
  kind: 'expression'
): Expression | undefined;
export function parseComponent(
  source: string,
  kind: 'action' | 'actions' | 'reasoning_actions'
): ComponentResultMap[keyof ComponentResultMap] | undefined;
export function parseComponent<K extends keyof AgentforceSchemaType>(
  source: string,
  kind: K
): ComponentResultMap[K] | undefined;
export function parseComponent(
  source: string,
  kind: string
):
  | Statement[]
  | Expression
  | ComponentResultMap[keyof ComponentResultMap]
  | undefined {
  try {
    if (kind === 'statement') {
      return parseStatementComponent(source);
    }
    if (kind === 'expression') {
      return parseExpressionComponent(source);
    }

    const parsed = parseComponentCore(source, kind);
    return (parsed?.component ?? undefined) as
      | ComponentResultMap[keyof ComponentResultMap]
      | undefined;
  } catch {
    return kind === 'statement' ? [] : undefined;
  }
}

// ---------------------------------------------------------------------------
// Statement kind
// ---------------------------------------------------------------------------

/** Wrapper template for parsing isolated statements. */
const STMT_PREFIX = `topic __agentforce_parse_wrapper__:
    reasoning:
        instructions: ->
`;
const STMT_PREFIX_LINES = countPrefixLines(STMT_PREFIX);
const STMT_INDENT = '            '; // 12 spaces

function parseStatementComponent(source: string): Statement[] {
  const parser = getParser();
  const indentedLines = source
    .split('\n')
    .map(line => STMT_INDENT + line)
    .join('\n');
  const wrappedSource = STMT_PREFIX + indentedLines;

  const tree = parser.parse(wrappedSource);
  const result = parseAndLint(tree.rootNode, agentforceDialect);
  const ast = result.ast;

  // Extract the topic → reasoning → instructions → statements
  const topicMap = ast['topic'];
  if (!isNamedMap(topicMap)) return [];

  const entries = [...topicMap.entries()];
  if (entries.length === 0) return [];
  const topic = entries[0][1] as Record<string, unknown>;

  const reasoning = topic['reasoning'] as Record<string, unknown> | undefined;
  if (!reasoning) return [];

  const instructionsNode = reasoning['instructions'];
  if (!instructionsNode) return [];
  const statements = (instructionsNode as Record<string, unknown>)[
    'statements'
  ];
  if (!Array.isArray(statements)) return [];

  // Adjust positions: subtract wrapper lines and indent
  return adjustStatementPositions(
    statements as Statement[],
    STMT_PREFIX_LINES,
    STMT_INDENT.length
  );
}

function adjustStatementPositions(
  statements: Statement[],
  lineOffset: number,
  columnOffset: number
): Statement[] {
  for (const stmt of statements) {
    if (stmt.__cst?.range) {
      adjustRange(stmt.__cst.range, lineOffset, columnOffset);
    }
    if (stmt.__diagnostics) {
      for (const d of stmt.__diagnostics) {
        adjustRange(d.range, lineOffset, columnOffset);
      }
    }
  }
  return statements;
}

// ---------------------------------------------------------------------------
// Expression kind
// ---------------------------------------------------------------------------

/** Wrapper template for parsing isolated expressions. */
const EXPR_PREFIX = 'variables:\n    __expr__: String = ';
const EXPR_PREFIX_LINE = countPrefixLines(EXPR_PREFIX);
const EXPR_PREFIX_COL = EXPR_PREFIX.length - EXPR_PREFIX.lastIndexOf('\n') - 1;

function parseExpressionComponent(source: string): Expression | undefined {
  const parser = getParser();
  const wrappedSource = EXPR_PREFIX + source;

  const tree = parser.parse(wrappedSource);
  const result = parseAndLint(tree.rootNode, agentforceDialect);
  const ast = result.ast;

  // Extract the variable declaration's default value
  const variables = ast['variables'] as Record<string, unknown> | undefined;
  if (!variables) return undefined;

  // Variables block has __children with declarations
  const children = (variables as Record<string, unknown>).__children as
    | Array<Record<string, unknown>>
    | undefined;
  if (!children || children.length === 0) return undefined;

  // Find the variable declaration node
  for (const child of children) {
    if (
      child.__type === 'variable_declaration' ||
      child.__type === 'declaration'
    ) {
      const decl = child as Record<string, unknown>;
      const defaultValue = decl.defaultValue as Expression | undefined;
      if (defaultValue) {
        adjustExpressionPositions(
          defaultValue,
          EXPR_PREFIX_LINE,
          EXPR_PREFIX_COL
        );
        return defaultValue;
      }
    }
  }

  // Try extracting from entries (NamedMap for variables)
  if (isNamedMap(variables)) {
    const entries = [...variables.entries()];
    if (entries.length > 0) {
      const varDecl = entries[0][1] as Record<string, unknown>;
      const defaultValue = varDecl.defaultValue as Expression | undefined;
      if (defaultValue) {
        adjustExpressionPositions(
          defaultValue,
          EXPR_PREFIX_LINE,
          EXPR_PREFIX_COL
        );
        return defaultValue;
      }
    }
  }

  return undefined;
}

/**
 * Unlike `adjustRange` (which subtracts columnOffset from every line uniformly),
 * expression column adjustment only applies to line 0 — because the wrapper
 * prefix (`variables:\n    __expr__: String = `) is on the same line as the
 * expression start, so only the first line has an artificial column offset.
 * Subsequent lines are not indented by the wrapper.
 */
function adjustExpressionPositions(
  expr: Expression,
  lineOffset: number,
  columnOffset: number
): void {
  const cst = expr.__cst;
  if (cst?.range) {
    cst.range.start.line -= lineOffset;
    if (cst.range.start.line === 0) {
      cst.range.start.character -= columnOffset;
    }
    cst.range.end.line -= lineOffset;
    if (cst.range.end.line === 0) {
      cst.range.end.character -= columnOffset;
    }
  }
}

// ---------------------------------------------------------------------------
// Generic recursive position adjustment
// ---------------------------------------------------------------------------

/**
 * Adjust all positions in a serialized CST node tree by subtracting the given
 * offsets. `columnOffset` is subtracted from every line (uniform indent).
 * Positions are clamped to zero to avoid negative values from wrapper nodes.
 */
function adjustCSTNodePositions(
  node: SerializedCSTNode,
  lineOffset: number,
  columnOffset: number
): void {
  adjustRange(node.range, lineOffset, columnOffset);
  if (node.children) {
    for (const child of node.children) {
      adjustCSTNodePositions(child, lineOffset, columnOffset);
    }
  }
}

/**
 * Recursively adjust all `__cst.range` positions in a parsed AST object.
 * `columnOffset` is subtracted from every line (uniform indent).
 */
function adjustASTPositionsInPlace(
  value: unknown,
  lineOffset: number,
  columnOffset: number,
  visited = new Set<unknown>()
): void {
  if (!value || typeof value !== 'object' || visited.has(value)) return;
  visited.add(value);

  const obj = value as Record<string, unknown>;
  const cst = obj.__cst as { range: Range } | undefined;
  if (cst?.range) {
    adjustRange(cst.range, lineOffset, columnOffset);
  }

  // Adjust __diagnostics ranges
  const diags = obj.__diagnostics as Diagnostic[] | undefined;
  if (Array.isArray(diags)) {
    for (const d of diags) {
      adjustRange(d.range, lineOffset, columnOffset);
    }
  }

  // Recurse into all properties
  for (const val of Object.values(obj)) {
    if (val && typeof val === 'object') {
      if (isNamedMap(val)) {
        val.forEach((v: unknown) =>
          adjustASTPositionsInPlace(v, lineOffset, columnOffset, visited)
        );
      } else if (Array.isArray(val)) {
        for (const item of val) {
          adjustASTPositionsInPlace(item, lineOffset, columnOffset, visited);
        }
      } else {
        adjustASTPositionsInPlace(val, lineOffset, columnOffset, visited);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// parseComponentDebug — returns component + CST + diagnostics
// ---------------------------------------------------------------------------

/**
 * Serialize a SyntaxNode tree into a plain JSON structure.
 */
function serializeSyntaxNode(node: SyntaxNode): SerializedCSTNode {
  const serialized: SerializedCSTNode = {
    type: node.type,
    text: node.children.length === 0 ? node.text : undefined,
    range: {
      start: {
        line: node.startRow,
        character: node.startCol,
      },
      end: {
        line: node.endRow,
        character: node.endCol,
      },
    },
    isNamed: node.isNamed ?? true,
    hasError: node.hasError ?? false,
    isMissing: node.isMissing ?? false,
  };

  if (node.children.length > 0) {
    const fieldNameForChild =
      'fieldNameForChild' in node &&
      typeof node.fieldNameForChild === 'function'
        ? (node.fieldNameForChild.bind(node) as (
            index: number
          ) => string | null)
        : null;

    serialized.children = node.children.map((child, i) => {
      const childSerialized = serializeSyntaxNode(child);
      const fieldName = fieldNameForChild?.(i) ?? null;
      if (fieldName) {
        childSerialized.fieldName = fieldName;
      }
      return childSerialized;
    });
  }

  return serialized;
}

/**
 * Parse a standalone component and return the full result including CST and diagnostics.
 *
 * Unlike `parseComponent()` which only returns the extracted component, this function
 * also returns the serialized CST tree and all diagnostics — useful for debug tooling.
 *
 * All positions in the returned CST and component are adjusted to be relative to the
 * user's original source (editor coordinates), even when wrapping was applied internally.
 */
export function parseComponentDebug(
  source: string,
  kind: 'action' | 'actions' | 'reasoning_actions'
): ParseComponentDebugResult<ComponentResultMap[keyof ComponentResultMap]>;
export function parseComponentDebug<K extends keyof AgentforceSchemaType>(
  source: string,
  kind: K
): ParseComponentDebugResult<ComponentResultMap[K]>;
export function parseComponentDebug(
  source: string,
  kind: string
): ParseComponentDebugResult {
  try {
    const parsed = parseComponentCore(source, kind);
    if (!parsed) {
      return { component: undefined, cst: null, diagnostics: [] };
    }

    const { config, parser, wrappedSource, component, diagnostics } = parsed;
    const { lines: lineOffset, columns: columnOffset } = config.wrapOffsets;

    const rootNode = parser.parse(wrappedSource).rootNode;
    const cst = serializeSyntaxNode(rootNode);

    // Adjust positions when wrapping was applied
    let adjustedCst = cst;
    if (lineOffset > 0 || columnOffset > 0) {
      if (adjustedCst) adjustedCst = config.stripWrapperCST(adjustedCst);
      if (adjustedCst)
        adjustCSTNodePositions(adjustedCst, lineOffset, columnOffset);
      if (component)
        adjustASTPositionsInPlace(component, lineOffset, columnOffset);
      for (const d of diagnostics) {
        adjustRange(d.range, lineOffset, columnOffset);
      }
    }

    return { component, cst: adjustedCst, diagnostics };
  } catch (_e) {
    return {
      component: undefined,
      cst: null,
      diagnostics: [],
    };
  }
}
