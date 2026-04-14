import type { CstMeta, Range } from '@agentscript/types';
import type { Expression, NamedMap } from '@agentscript/language';
import {
  decomposeAtMemberExpression,
  SubscriptExpression,
  AtIdentifier,
  Identifier,
  UnaryExpression,
  DictLiteral,
  StringLiteral,
} from '@agentscript/language';
import type { CompilerContext } from './compiler-context.js';
import { dedent } from './utils.js';
import { Sourced, sourced } from './sourced.js';

/**
 * Safely extract a string value from an AST node.
 * Handles StringLiteral, TemplateExpression (as plain text), and plain strings.
 */
export function extractStringValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  // StringLiteral or similar expression with a .value
  if (typeof value === 'object' && 'value' in value) {
    const v = (value as { value: unknown }).value;
    if (typeof v === 'string') return v;
  }
  // TemplateExpression with .content
  if (typeof value === 'object' && 'content' in value) {
    const c = (value as { content: unknown }).content;
    if (typeof c === 'string') return c;
  }
  return undefined;
}

/**
 * Extract a string value with its source range preserved.
 */
export function extractSourcedString(
  value: unknown
): Sourced<string> | undefined {
  const str = extractStringValue(value);
  if (str === undefined) return undefined;
  return sourced(str, getCstRange(value));
}

/**
 * Extract a description string value with multi-line dedent support.
 * Template values are already cleaned at parse time; only string
 * literals need dedent processing.
 */
export function extractDescriptionValue(value: unknown): string | undefined {
  const str = extractStringValue(value);
  if (str === undefined) return undefined;
  // TemplateExpression values are already dedented and cleaned at parse time
  if (isTemplateValue(value)) return str;
  return dedent(str);
}

/**
 * Extract a description string value with its source range preserved.
 */
export function extractSourcedDescription(
  value: unknown
): Sourced<string> | undefined {
  const str = extractStringValue(value);
  if (str === undefined) return undefined;
  // TemplateExpression values are already dedented and cleaned at parse time
  const processed = isTemplateValue(value) ? str : dedent(str);
  return sourced(processed, getCstRange(value));
}

function isTemplateValue(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'parts' in value &&
    'content' in value
  );
}

/**
 * Safely extract a boolean value from an AST node.
 */
export function extractBooleanValue(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'object' && 'value' in value) {
    const v = (value as { value: unknown }).value;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') {
      if (v.toUpperCase() === 'TRUE') return true;
      if (v.toUpperCase() === 'FALSE') return false;
    }
  }
  // Handle string "TRUE" / "FALSE"
  if (typeof value === 'string') {
    if (value.toUpperCase() === 'TRUE') return true;
    if (value.toUpperCase() === 'FALSE') return false;
  }
  return undefined;
}

/**
 * Extract a boolean value with its source range preserved.
 */
export function extractSourcedBoolean(
  value: unknown
): Sourced<boolean> | undefined {
  const b = extractBooleanValue(value);
  if (b === undefined) return undefined;
  return sourced(b, getCstRange(value));
}

/**
 * Safely extract a number value from an AST node.
 */
export function extractNumberValue(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && 'value' in value) {
    const v = (value as { value: unknown }).value;
    if (typeof v === 'number') return v;
  }
  // Handle unary minus: `= -1` parses as UnaryExpression('-', NumberLiteral(1))
  if (value instanceof UnaryExpression && value.operator === '-') {
    const inner = extractNumberValue(value.operand);
    if (inner !== undefined) return -inner;
  }
  return undefined;
}

/**
 * Extract a number value with its source range preserved.
 */
export function extractSourcedNumber(
  value: unknown
): Sourced<number> | undefined {
  const n = extractNumberValue(value);
  if (n === undefined) return undefined;
  return sourced(n, getCstRange(value));
}

/**
 * Get the CST range from an AST value, if available.
 */
export function getCstRange(value: unknown): Range | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const cst = (value as { __cst?: CstMeta }).__cst;
  return cst?.range;
}

/**
 * Check if a value has CST metadata attached.
 */
export function hasCst(value: unknown): value is { __cst: CstMeta } {
  return (
    !!value &&
    typeof value === 'object' &&
    '__cst' in value &&
    !!(value as { __cst?: CstMeta }).__cst
  );
}

/**
 * Iterate entries of a NamedMap (Map<string, T>).
 * Safely handles undefined/null.
 */
export function iterateNamedMap<T>(
  map: Map<string, T> | NamedMap<T> | undefined | null
): Array<[string, T]> {
  if (!map) return [];
  return Array.from(map.entries());
}

/**
 * Get a template's text content, joining all parts.
 * Handles TemplateExpression objects and plain strings.
 */
export function getTemplateContent(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return undefined;

  // TemplateExpression with .parts
  if ('parts' in value) {
    const parts = (value as { parts: unknown[] }).parts;
    return parts
      .map(p => {
        if (typeof p === 'string') return p;
        if (typeof p === 'object' && p && 'value' in p) {
          return String((p as { value: unknown }).value);
        }
        return '';
      })
      .join('');
  }

  // Has .content
  if ('content' in value) {
    const c = (value as { content: unknown }).content;
    if (typeof c === 'string') return c;
  }

  // Has .value
  if ('value' in value) {
    const v = (value as { value: unknown }).value;
    if (typeof v === 'string') return v;
  }

  return undefined;
}

/**
 * Extract the type name from a type Expression.
 * Handles Identifier (e.g. `string`) and SubscriptExpression (e.g. `string[]`).
 */
export function getExpressionName(expr: Expression): string | undefined {
  if (expr instanceof Identifier) return expr.name;
  if (expr instanceof SubscriptExpression) {
    // For list[type] syntax, the element type is in the index position
    if (expr.index instanceof Identifier) {
      return expr.index.name;
    }
    // Fallback to the object name
    if (expr.object instanceof Identifier) {
      return expr.object.name;
    }
  }
  return undefined;
}

/**
 * Check if a type Expression represents a list/array type (e.g. `string[]`).
 */
export function isListType(expr: Expression): boolean {
  return expr instanceof SubscriptExpression;
}

/**
 * Resolve an `@namespace.property` expression to the property name string.
 *
 * Handles:
 * - MemberExpression with AtIdentifier object matching one of `namespaces`
 * - Plain Identifier (bare name without namespace)
 * - Bare AtIdentifier (e.g. `@myAction`)
 *
 * @param namespaces - One or more accepted namespace strings (e.g. `'actions'`, `['variables', 'outputs']`)
 * @param errorLabel - Human-readable label for error messages (e.g. `'action target'`)
 */
export function resolveAtReference(
  expr: Expression,
  namespaces: string | string[],
  ctx: CompilerContext,
  errorLabel: string
): string | undefined {
  const nsList = Array.isArray(namespaces) ? namespaces : [namespaces];

  const decomposed = decomposeAtMemberExpression(expr);
  if (decomposed && nsList.includes(decomposed.namespace)) {
    return decomposed.property;
  }
  if (expr instanceof Identifier) {
    return expr.name;
  }
  if (expr instanceof AtIdentifier) {
    return expr.name;
  }
  ctx.error(`Cannot resolve ${errorLabel} from expression`, expr.__cst?.range);
  return undefined;
}

/**
 * Extract a dictionary expression to a plain Record object.
 * Handles nested dictionaries and various literal types.
 */
export function extractDictExpression(
  expr: Expression | undefined
): Record<string, unknown> | undefined {
  if (!expr || expr.__kind !== 'DictLiteral') return undefined;

  const dictExpr = expr as DictLiteral;
  const result: Record<string, unknown> = {};

  for (const entry of dictExpr.entries) {
    const key = extractStringOrIdentifierValue(entry.key);
    const value = extractExpressionValue(entry.value);
    if (key !== undefined && value !== undefined) {
      result[key] = value;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Extract a string key from an expression (handles string literals and identifiers).
 */
function extractStringOrIdentifierValue(expr: Expression): string | undefined {
  if (expr.__kind === 'StringLiteral') {
    return (expr as StringLiteral).value;
  }
  if (expr instanceof Identifier) {
    return expr.name;
  }
  return undefined;
}

/**
 * Extract any expression value to its JavaScript equivalent.
 * Uses the robust extractStringValue/extractNumberValue/extractBooleanValue
 * helpers which handle edge cases like TemplateExpression, UnaryExpression
 * for negative numbers, string "TRUE"/"FALSE" booleans, and plain JS values.
 */
export function extractExpressionValue(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;

  // Try primitive types via robust helpers
  const str = extractStringValue(value);
  if (str !== undefined) return str;

  const num = extractNumberValue(value);
  if (num !== undefined) return num;

  const bool = extractBooleanValue(value);
  if (bool !== undefined) return bool;

  if (typeof value === 'object') {
    const obj = value as { __kind?: string; elements?: unknown[] };

    if (obj.__kind === 'DictLiteral') {
      return extractDictExpression(value as Expression);
    }

    if (obj.__kind === 'ListLiteral' && Array.isArray(obj.elements)) {
      return obj.elements
        .map(extractExpressionValue)
        .filter(v => v !== undefined);
    }

    // Plain array (e.g., ExpressionSequence)
    if (Array.isArray(value)) {
      return (value as unknown[])
        .map(extractExpressionValue)
        .filter(v => v !== undefined);
    }
  }

  return undefined;
}
