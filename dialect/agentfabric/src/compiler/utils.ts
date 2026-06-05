/**
 * Compiler utilities mirroring the Python adaptor helper methods.
 */

import { decomposeAtMemberExpression } from '@agentscript/language';

/**
 * Iterate key/value pairs from a dialect collection block.
 * Parsed collections are `NamedMap` (iterable, not `instanceof Map`) or native `Map`.
 */
export function iterateCollection(
  block: unknown
): [string, Record<string, unknown>][] {
  if (block == null) return [];
  if (block instanceof Map) {
    return [...block.entries()] as [string, Record<string, unknown>][];
  }
  if (typeof block === 'object' && Symbol.iterator in block) {
    return [...(block as Iterable<[string, unknown]>)] as [
      string,
      Record<string, unknown>,
    ][];
  }
  return [];
}

/**
 * Normalize a kebab-case identifier to snake_case (valid Python identifier).
 * Mirrors _normalize_id() in the Python adaptor.
 */
export function normalizeId(name: string): string {
  return name ? name.replace(/-/g, '_') : name;
}

/**
 * Resolve a handoff target: 'end' means graph-complete (null), otherwise normalize.
 * Mirrors _resolve_target() in the Python adaptor.
 */
export function resolveTarget(
  target: string | undefined | null
): string | null {
  if (!target || target.toLowerCase() === 'end') {
    return null;
  }
  return normalizeId(target);
}

/**
 * Replace hyphens between word characters inside Jinja2 {{ }} blocks with underscores.
 * Mirrors _normalize_template() in the Python adaptor.
 */
export function normalizeTemplate(value: string): string {
  // Convert AgentScript interpolation form `{!expr}` to `{{expr}}`.
  const withJinja = value.replace(
    /\{\!\s*([^}]+?)\s*\}/g,
    (_m, inner: string) => {
      return `{{${inner}}}`;
    }
  );

  return withJinja.replace(/\{\{(.*?)\}\}/g, (_match, inner: string) => {
    let normalized = inner.replace(/(\w)-(\w)/g, '$1_$2');
    // Runtime context stores mutable variables on state.<name>.
    normalized = normalized.replace(
      /@variables\.([A-Za-z0-9_-]+)/g,
      (_m, name: string) => `state.${name.replace(/-/g, '_')}`
    );
    // Runtime context uses state.request.*, so rewrite @request.* in templates.
    normalized = normalized.replace(/@request\./g, 'state.request.');
    // Canonical node output reference in templates:
    // - @executor.<node_name>.output[.attr...] -> state.outputs['<node_name>'][.attr...]
    // - @orchestrator/@subagent/@generator.<node_name>.output -> system.node_outputs['<node_name>']
    // - @orchestrator/@subagent/@generator.<node_name>.output.<attr...> -> parse_json(system.node_outputs['<node_name>']).<attr...>
    // node_outputs values are JSON strings; attribute access requires parse_json().
    normalized = normalized.replace(
      /@(orchestrator|subagent|generator|executor)\.([A-Za-z0-9_-]+)\.output\b((?:\.[A-Za-z_]\w*)*)/g,
      (_m, nodeType: string, nodeName: string, tail: string) => {
        const normalizedName = nodeName.replace(/-/g, '_');
        if (nodeType === 'executor') {
          return `state.outputs['${normalizedName}']${tail}`;
        }
        if (tail) {
          return `parse_json(system.node_outputs['${normalizedName}'])${tail}`;
        }
        return `system.node_outputs['${normalizedName}']`;
      }
    );
    // Node input reference in templates:
    // - @<any_node_type>.<node_name>.input -> state._node_input
    normalized = normalized.replace(
      /@(orchestrator|subagent|generator|executor|router|echo)\.([A-Za-z0-9_-]+)\.input\b/g,
      'state._node_input'
    );
    // Disallow deprecated alias in templates.
    normalized = normalized.replace(
      /@outputs\.([A-Za-z0-9_-]+)/g,
      (_m, nodeName: string) =>
        `__ERROR__outputs_alias_not_supported__use_@<node_type>.${nodeName}.output`
    );
    return '{{' + normalized + '}}';
  });
}

/**
 * Prefix Jinja2 template expressions with 'template::' for the runtime evaluator.
 * Only applies to strings that start with '{{'.
 * Mirrors _template_expr() in the Python adaptor.
 */
export function templateExpr(value: unknown): unknown {
  if (
    typeof value === 'string' &&
    value.trim().startsWith('{{') &&
    !value.startsWith('template::')
  ) {
    return `template::${normalizeTemplate(value)}`;
  }
  return value;
}

/**
 * Extract a plain string from a parsed AST field value.
 * Handles StringLiteral, TemplateExpression, and raw string values.
 */
export function extractString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null) {
    const v = value as Record<string, unknown>;
    if ('value' in v && typeof v.value === 'string') return v.value;
    if ('text' in v && typeof v.text === 'string') return v.text;
  }
  return String(value);
}

/**
 * Extract an LLM reference string from `config.default_llm` or a node's `llm` field.
 * Handles plain strings and `@namespace.member` member expressions from the dialect AST.
 */
export function extractLlmFieldReference(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;

  const ref = decomposeAtMemberExpression(value);
  if (ref) {
    return `@${ref.namespace}.${ref.property}`;
  }

  const s = extractString(value);
  if (s === undefined || s === '[object Object]') return undefined;
  return s;
}

/**
 * Resolve effective system instructions for compiled focus-prompt:
 * node-level instructions override document-level defaults when present.
 */
export function combineGlobalSystemInstructions(
  globalInstructions: string | undefined,
  nodeInstructions: string | undefined
): string {
  const g = globalInstructions?.trim() ?? '';
  const n = nodeInstructions?.trim() ?? '';
  if (n) return n;
  return g;
}

/**
 * Extract plain text from a procedure / template field (e.g. `instructions: -> ...`).
 * Falls back to {@link extractString} for simple string values.
 */
export function extractProcedureText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && value !== null) {
    const v = value as Record<string, unknown>;
    if (Array.isArray(v.statements)) {
      const stmts = v.statements as Array<{
        __emit?: (ctx: { indent: number }) => string;
      }>;
      const lines = stmts
        .map(s =>
          typeof s.__emit === 'function' ? s.__emit({ indent: 0 }) : ''
        )
        .filter(line => line.length > 0);
      return lines.join('\n');
    }
    if (Array.isArray(v.parts)) {
      const parts = v.parts as Array<Record<string, unknown>>;
      return parts
        .map(p => {
          if (typeof p.value === 'string') return p.value;
          if (typeof p.__emit === 'function')
            return (p.__emit as (ctx: { indent: number }) => string)({
              indent: 0,
            });
          return '';
        })
        .join('');
    }
  }
  const fallback = extractString(value);
  if (fallback === undefined || fallback === '[object Object]') return '';
  return fallback;
}

/**
 * Extract a transition target reference from a procedure-like value.
 * Returns canonical "@namespace.node" or empty string when unresolved.
 */
export function extractTransitionReference(value: unknown): string {
  const fromText = extractProcedureText(value);
  const extractFrom = (text: string): string => {
    const explicitTransition = text.match(
      /transition\s+to\s+@([A-Za-z_][\w]*\.[A-Za-z0-9_-]+)/i
    );
    if (explicitTransition) return `@${explicitTransition[1]}`;

    const anyReference = text.match(/@([A-Za-z_][\w]*\.[A-Za-z0-9_-]+)/);
    return anyReference ? `@${anyReference[1]}` : '';
  };

  const fromEmitted = extractFrom(fromText);
  if (fromEmitted) return fromEmitted;

  try {
    const plain = toPlainData(value);
    const serialized = JSON.stringify(plain);
    const fromSerialized = extractFrom(serialized);
    if (fromSerialized) return fromSerialized;
  } catch {
    // ignore and continue to structural walk
  }

  const seen = new Set<unknown>();
  const queue: unknown[] = [value];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current == null || seen.has(current)) continue;
    seen.add(current);

    const ref = decomposeAtMemberExpression(current);
    if (ref && ref.namespace && ref.property) {
      return `@${ref.namespace}.${ref.property}`;
    }

    if (typeof current === 'string') {
      const fromString = extractFrom(current);
      if (fromString) return fromString;
      continue;
    }
    if (Array.isArray(current)) {
      for (const item of current) queue.push(item);
      continue;
    }
    if (typeof current === 'object') {
      for (const child of Object.values(current as Record<string, unknown>)) {
        queue.push(child);
      }
    }
  }

  return '';
}

/**
 * Extract a number from a parsed AST field value.
 */
export function extractNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && value !== null) {
    const v = value as Record<string, unknown>;
    if ('value' in v && typeof v.value === 'number') return v.value;
  }
  const n = Number(value);
  return isNaN(n) ? undefined : n;
}

/**
 * Convert parsed AST/schema nodes into plain JSON-like values.
 * Strips internal metadata (`__*`), functions, and non-serializable objects.
 */
export function toPlainData(value: unknown, seen?: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value === 'function') return undefined;

  if (Array.isArray(value)) {
    return value
      .map(v => toPlainData(v, seen))
      .filter((v): v is unknown => v !== undefined);
  }

  if (value instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of value.entries()) {
      const plain = toPlainData(v, seen);
      if (plain !== undefined) out[String(k)] = plain;
    }
    return out;
  }

  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const tracker = seen ?? new WeakSet<object>();
    if (tracker.has(obj)) return undefined;
    tracker.add(obj);

    const kind = typeof obj.__kind === 'string' ? obj.__kind : undefined;
    if (kind) {
      if (
        kind === 'StringLiteral' ||
        kind === 'NumberLiteral' ||
        kind === 'BooleanLiteral'
      ) {
        return obj.value;
      }
      if (kind === 'NoneLiteral') return null;
      if (kind === 'Identifier' && typeof obj.name === 'string')
        return obj.name;
      if (
        (kind === 'TemplateExpression' ||
          kind === 'MemberExpression' ||
          kind === 'CallExpression' ||
          kind === 'SpreadExpression') &&
        typeof obj.__emit === 'function'
      ) {
        return (obj.__emit as (ctx: { indent: number }) => string)({
          indent: 0,
        });
      }
    }

    // NamedMap/TypedMap: iterate declared entries in source order.
    if (Symbol.iterator in obj) {
      const out: Record<string, unknown> = {};
      try {
        for (const item of obj as Iterable<unknown>) {
          if (
            Array.isArray(item) &&
            item.length >= 2 &&
            typeof item[0] === 'string'
          ) {
            const plain = toPlainData(item[1], tracker);
            if (plain !== undefined) out[item[0]] = plain;
          }
        }
        if (Object.keys(out).length > 0) return out;
      } catch {
        // Fall back to own-enumerable traversal below.
      }
    }

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith('__')) continue;
      const plain = toPlainData(v, tracker);
      if (plain !== undefined) out[k] = plain;
    }
    return out;
  }

  return undefined;
}
