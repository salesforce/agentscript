/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Lint pass: check the `with <input> = <value>` bindings under a connection
 * `render:` block against the response format's declared inputs.
 *
 * A render body this pass validates:
 *
 *     when @connection.messaging
 *         render: @connection.messaging.response_formats.rich
 *             with title = @outputs.a_title
 *             with block = {version: @outputs.n, label: "Summary"}
 *             with rows  = [{cell: "x"}]
 *             show_and_return: True
 *
 * Diagnostics emitted:
 *   - render-with-unknown-input                 (Error)   param is not a declared input
 *   - render-with-missing-required-input        (Error)   required top-level inputs are unbound;
 *                                                          one consolidated lint lists them all
 *   - render-with-required-none                 (Error)   a required input/field is bound to None
 *   - render-with-type-mismatch                 (Warning) wrong type, or a scalar/object/list
 *                                                          clash (also used for nested fields)
 *   - render-with-constraint-violation          (Warning) literal breaks enum / min / max / count
 *   - render-with-nested-unknown-field          (Error)   inline dict key not in the object's declared `fields`
 *   - render-with-nested-missing-required-field (Error)   an inline dict omits required fields; one
 *                                                          consolidated lint per object level
 *   - render-with-duplicate-input               (Warning) same input, or same nested dict key,
 *                                                          bound twice in one block (only the
 *                                                          winning value is otherwise validated)
 *   - render-with-ellipsis                      (Error)   a value is left as `...` (LLM-fill);
 *                                                          bindings are all-or-nothing
 *   - render-with-primitive-no-fields           (Error)   a `with` binding on a built-in
 *                                                          primitive format (e.g. `json`),
 *                                                          which has no fields to fill in
 *   - render-with-unknown-connection-input      (Error)   a short `@inputs.Y` value names an
 *                                                          input the active connection lacks
 *   - render-with-input-connection-mismatch     (Error)   a long `@connection.C.inputs.Y` value
 *                                                          names a connection other than the
 *                                                          active one
 *
 * Only declared inputs are accepted: you can bind an input or object field only
 * if the script spells it out — any name that isn't declared under a format is
 * reported as unknown, and pointing at a `schema:` URI does not quietly add
 * more allowed names. A messaging component is bound through its wrapper input
 * (its nested `fields:` are the sub-keys); when it declares no fields there is
 * nothing to bind, so any binding on it is an unknown input — exactly like
 * binding to any input-less format (see `hasBindableInputs`).
 *
 * Typing follows the action type check: a scalar value binds only to its own
 * type, except the numeric and string families stay interchangeable because
 * literals force it (a numeric literal always infers as `number`, a string
 * literal as `string`). An `object` input is a loose passthrough, and only
 * statically-knowable values are type-checked at all.
 *
 * Consolidated diagnostics: a single root cause surfaces only the most critical
 * lint, so fixing it clears the ones it caused.
 *
 * (The code documents the exact rules per case.)
 */

import type { LintPass } from '@agentscript/language';
import {
  defineRule,
  each,
  attachDiagnostic,
  findSuggestion,
  lintDiagnostic,
  isAstNodeLike,
  decomposeAtMemberChain,
  inferExpressionType,
  RESERVED_BUILT_IN_RESPONSE_FORMATS,
} from '@agentscript/language';
import type { AstNodeLike } from '@agentscript/language';
import {
  reasoningActionsKey,
  typeMapKey,
  parseFormatRef,
} from '@agentscript/agentscript-dialect';
import type {
  ReasoningActionEntry,
  TypeMap,
} from '@agentscript/agentscript-dialect';
import type { CstMeta, Range, SyntaxNode } from '@agentscript/types';
import { DiagnosticSeverity, toRange } from '@agentscript/types';
import {
  responseFormatShapeIndexKey,
  connectionInputsIndexKey,
  signedNumberValue,
  type RenderInputInfo,
  type RenderInputConstraints,
  type ResponseFormatShapeIndex,
  type ConnectionInputsIndex,
} from './response-format-shape.js';

// ---------------------------------------------------------------------------
// Type-family compatibility
//
// Checks that a `with` binding's value (a literal, `@variables.X`, or
// `@outputs.X`) has the same type family as the input it binds to.
// ---------------------------------------------------------------------------

/** Numeric scalar types; kept mutually bindable so `integer`/`long`/`currency`/`timestamp` targets accept a numeric literal (which infers as `number`). */
const NUMERIC_FAMILY: ReadonlySet<string> = new Set([
  'number',
  'integer',
  'long',
  'currency',
  'timestamp',
]);

/** Scalar types written as string literals; kept mutually bindable so `id`/`date`/`datetime`/`time` targets accept a string literal (which infers as `string`). */
const STRING_FAMILY: ReadonlySet<string> = new Set([
  'string',
  'id',
  'date',
  'datetime',
  'time',
  'currency',
  'timestamp',
]);

/** All primitive scalar types (boolean plus the numeric and string families). */
const SCALAR_FAMILY: ReadonlySet<string> = new Set([
  'boolean',
  ...NUMERIC_FAMILY,
  ...STRING_FAMILY,
]);

/**
 * True when an inferred source scalar type may bind to a declared scalar target
 * type: exact match, shared family (numeric / string / boolean), or either side
 * unclassifiable (unrecognized types pass, never flagged).
 *
 * Both families exist because literals force them — numeric literals infer as
 * `number`, string literals as `string`. Whether a string target accepts a
 * non-string *value* (e.g. a number) is decided separately in
 * {@link validateScalar}.
 */
function scalarTypesCompatible(inferred: string, target: string): boolean {
  const src = inferred.toLowerCase();
  const dst = target.toLowerCase();
  if (src === dst) return true;
  if (!SCALAR_FAMILY.has(src) || !SCALAR_FAMILY.has(dst)) return true;

  // Bind when the two types share a family.
  return (
    (NUMERIC_FAMILY.has(src) && NUMERIC_FAMILY.has(dst)) ||
    (STRING_FAMILY.has(src) && STRING_FAMILY.has(dst)) ||
    (src === 'boolean' && dst === 'boolean')
  );
}

/** Formats a target type as an article + name, e.g. "an integer". */
function typeLabel(type: string): string {
  return /^[aeiou]/i.test(type) ? `an ${type}` : `a ${type}`;
}

// ---------------------------------------------------------------------------
// Value-node inspection
//
// Reads the raw value node on the right of a `with <input> = <value>` binding:
// its structural kind, its source range, and its static literal value (if any).
// ---------------------------------------------------------------------------

type ValueKind = 'ellipsis' | 'none' | 'dict' | 'list' | 'scalar' | 'other';

function valueKind(node: unknown): ValueKind {
  if (!isAstNodeLike(node)) return 'other';
  switch (node.__kind) {
    case 'Ellipsis':
      return 'ellipsis';
    case 'NoneLiteral':
      return 'none';
    case 'DictLiteral':
      return 'dict';
    case 'ListLiteral':
      return 'list';
    case 'StringLiteral':
    case 'NumberLiteral':
    case 'BooleanLiteral':
      return 'scalar';
    default:
      return 'other';
  }
}

/**
 * True when a render body holds at least one real `with <param> =` binding.
 *
 * A paramless clause (`with = 5`, a truncated `with`) only exists under
 * parse-error recovery and binds nothing, so it doesn't count.
 */
function hasBinding(body: Array<Record<string, unknown>>): boolean {
  return body.some(stmt => stmt.__kind === 'WithClause' && !!stmt.param);
}

/**
 * Reads an AST node's CST source range.
 *
 * Returns undefined when the node isn't AST-like or has no recorded range.
 */
function rangeOf(node: unknown): Range | undefined {
  if (!isAstNodeLike(node)) return undefined;
  return (node.__cst as CstMeta | undefined)?.range;
}

/**
 * Extracts a compile-time primitive literal (with its kind) from a value node.
 *
 * Returns undefined for any dynamic value (a reference, call, list/dict, None,
 * `...`). Folds signed unary numbers (`-5`, `+5`) into a plain number literal.
 */
function staticLiteral(
  node: unknown
):
  | { kind: 'string' | 'number' | 'boolean'; raw: string | number | boolean }
  | undefined {
  if (!isAstNodeLike(node)) return undefined;
  const v = node.value;
  switch (node.__kind) {
    case 'StringLiteral':
      return typeof v === 'string' ? { kind: 'string', raw: v } : undefined;
    case 'NumberLiteral':
      return typeof v === 'number' ? { kind: 'number', raw: v } : undefined;
    case 'BooleanLiteral':
      return typeof v === 'boolean' ? { kind: 'boolean', raw: v } : undefined;
    case 'UnaryExpression': {
      // `-5` / `+5` parse as a UnaryExpression, not a NumberLiteral — fold to
      // the signed value so fractional and constraint checks see it.
      const n = signedNumberValue(node);
      return n === undefined ? undefined : { kind: 'number', raw: n };
    }
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Shape satisfiability
//
// Decides whether the format definition alone already supplies an input/field's
// value, so a missing `with` binding for it is not an error.
// ---------------------------------------------------------------------------

/**
 * True when the format definition alone supplies this input/field's value, so
 * it needs no `with` binding. Satisfied when any of these hold, to any depth:
 *
 * - it declares a default;
 * - it is an object whose every field is itself satisfied by definition;
 * - it is a list whose element is itself satisfied by definition.
 *
 * A list with a `min_items` floor is the exception: the floor demands real
 * elements, and an element default only describes an element that is not there.
 * Such a list is never satisfied by definition.
 */
function isSatisfiedByDefinition(info: RenderInputInfo): boolean {
  if (info.hasDefault) return true;
  if (info.kind === 'object') return allFieldsSatisfied(info.fields);
  if (info.kind === 'list' && info.element) {
    const minItems = info.constraints?.minItems;
    if (minItems !== undefined && minItems > 0) return false;
    return isSatisfiedByDefinition(info.element);
  }
  return false;
}

/**
 * True when an object needs no binding because every field is already covered —
 * each field is either optional or itself satisfied by definition.
 *
 * A fields-less object (`undefined`/empty) is never satisfied this way; only a
 * direct default can supply its value.
 */
function allFieldsSatisfied(
  fields: Map<string, RenderInputInfo> | undefined
): boolean {
  if (!fields || fields.size === 0) return false;
  for (const field of fields.values()) {
    if (field.isRequired === false) continue;
    if (!isSatisfiedByDefinition(field)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// The lint pass
// ---------------------------------------------------------------------------

export function renderWithBindingsRule(): LintPass {
  return defineRule({
    id: 'render-with-bindings',
    description:
      'Validates render: `with` bindings against the response format input signature',
    deps: {
      entry: each(reasoningActionsKey),
      shapeIndex: responseFormatShapeIndexKey,
      connInputs: connectionInputsIndexKey,
      typeMap: typeMapKey,
    },

    run({ entry, shapeIndex, connInputs, typeMap }) {
      new BindingValidator(entry, shapeIndex, connInputs, typeMap).validate();
    },
  });
}

class BindingValidator {
  /**
   * The connection named by the enclosing `when @connection.X`, set per render.
   * Short-form `@inputs.Y` binding values resolve against it.
   */
  private currentConnection: string | undefined;

  constructor(
    private readonly entry: ReasoningActionEntry,
    private readonly shapeIndex: ResponseFormatShapeIndex,
    private readonly connInputs: ConnectionInputsIndex,
    private readonly typeMap: TypeMap
  ) {}

  /** Resolve `@variables.X` to its declared type, for `inferExpressionType`. */
  private resolveVariable = (name: string): string | null => {
    return this.typeMap.variables.get(name)?.type ?? null;
  };

  /**
   * Resolve a global-scope member value to its declared type, for
   * `inferExpressionType`. Handles the three value namespaces a `with` binding
   * may reference besides `@variables`:
   *   - `@outputs.X`                 — the action's output `X`
   *   - `@inputs.Y`                  — input `Y` of the active (when) connection
   *   - `@connection.C.inputs.Y`     — input `Y` of connection `C`
   *
   * Single level only — the output/input schema is flat, so a drilled path
   * (e.g. `@outputs.obj.field`) is left unresolved.
   */
  private resolveGlobalMember = (
    namespace: string,
    path: readonly string[]
  ): string | null => {
    if (namespace === 'outputs' && path.length === 1) {
      return this.entry.sig.outputs.get(path[0])?.type ?? null;
    }
    if (namespace === 'inputs' && path.length === 1) {
      return this.connectionInputType(this.currentConnection, path[0]);
    }
    if (
      namespace === 'connection' &&
      path.length === 3 &&
      path[1] === 'inputs'
    ) {
      return this.connectionInputType(path[0], path[2]);
    }
    return null;
  };

  /** Look up a connection input's declared type keyword, or null. */
  private connectionInputType(
    connection: string | undefined,
    inputName: string
  ): string | null {
    if (!connection) return null;
    return this.connInputs.get(connection)?.get(inputName)?.typeName ?? null;
  }

  /**
   * Validate a connection-input reference used as a binding value, mirroring how
   * `render:` resolves a format ref long vs short:
   *   - short `@inputs.Y` resolves against the active `when` connection; a name
   *     it doesn't declare is an unknown connection input.
   *   - long `@connection.C.inputs.Y` naming a connection other than the active
   *     one is a mismatch.
   * Existence of `C`/`Y` for the long form is left to the base
   * undefined-reference pass (which already resolves that chain); only the
   * mismatch is added here.
   *
   * Returns true when the reference itself was flagged (wrong connection or
   * unknown input): the value is already the wrong thing to bind, so the caller
   * skips the target type-check that would just pile a second, less-actionable
   * diagnostic on the same value.
   */
  private checkConnectionInputRef(value: unknown): boolean {
    if (!isAstNodeLike(value)) return false;
    const chain = decomposeAtMemberChain(value);
    if (!chain) return false;

    if (
      chain.namespace === 'connection' &&
      chain.path.length === 3 &&
      chain.path[1] === 'inputs'
    ) {
      const refConn = chain.path[0];
      if (refConn !== this.currentConnection && this.connInputs.has(refConn)) {
        this.reportInputConnectionMismatch(value, chain.path[2], refConn);
        return true;
      }
      return false;
    }

    if (chain.namespace === 'inputs' && chain.path.length === 1) {
      const conn = this.currentConnection;
      const inputs = conn ? this.connInputs.get(conn) : undefined;
      if (conn && inputs && !inputs.has(chain.path[0])) {
        this.reportUnknownConnectionInput(value, chain.path[0], conn, inputs);
        return true;
      }
    }
    return false;
  }

  validate(): void {
    const { statements } = this.entry;
    if (!statements) return;

    for (const stmt of statements) {
      if (stmt.__kind !== 'WhenStatement') continue;
      const subjectChain = stmt.subject
        ? decomposeAtMemberChain(stmt.subject)
        : null;
      const connection =
        subjectChain?.namespace === 'connection' &&
        subjectChain.path.length === 1
          ? subjectChain.path[0]
          : undefined;
      if (!connection) continue; // malformed when — render-rules reports it

      const body = (stmt.body as Array<Record<string, unknown>>) ?? [];
      for (const child of body) {
        if (child.__kind !== 'RenderStatement') continue;
        this.validateRender(child, connection);
      }
    }
  }

  private validateRender(
    render: Record<string, unknown>,
    whenConnection: string
  ): void {
    // Short-form `@inputs.Y` binding values resolve against the enclosing
    // `when` connection — record it for the resolver and ref checks.
    this.currentConnection = whenConnection;

    const parsed = parseFormatRef(render.value);
    if (!parsed) return; // bad ref — render-rules reports it

    // Longform ref may name a different connection than the enclosing `when`
    // (render-rules flags that mismatch); resolve against the ref's own
    // connection when present, else the `when` connection.
    const connection = parsed.connection ?? whenConnection;
    const body = (render.body as Array<Record<string, unknown>>) ?? [];

    // Missing-required errors anchor to the render line (the format ref), not
    // the action — the render is where the author declares the binding intent.
    const renderRange = rangeOf(render.value) ?? rangeOf(render);

    const formatInfo = this.shapeIndex.get(connection)?.get(parsed.name);
    if (!formatInfo) {
      // A reserved built-in (e.g. `json`) has no author-defined shape, so field
      // mapping does not apply to it at all. If the author wrote any `with`
      // clause, fail fast with one explicit "does not support field mapping"
      // error — never a pile of per-clause "unknown input" errors, which would
      // wrongly imply the format *has* fields they just got wrong. Any other
      // missing format is an unknown reference render-rules reports.
      if (
        RESERVED_BUILT_IN_RESPONSE_FORMATS.includes(parsed.name) &&
        hasBinding(body)
      ) {
        this.reportPrimitiveNoFields(render, parsed.name, renderRange);
      }
      return;
    }

    // A format with no bindable inputs validates against an empty set, so every
    // `with` reports as a regular `render-with-unknown-input`.
    const bindableInputs = formatInfo.hasBindableInputs
      ? formatInfo.inputs
      : new Map<string, RenderInputInfo>();
    this.validateAllBindings(body, bindableInputs, renderRange);
  }

  /**
   * Validate the `with` clauses of a render body against the declared format's inputs.
   *
   * Flat scan — the render-rules pass guarantees a render body holds only `with`
   * bindings and `show_and_return:`.
   */
  private validateAllBindings(
    statements: Array<Record<string, unknown>>,
    inputs: Map<string, RenderInputInfo>,
    renderRange: Range | undefined
  ): void {
    const bound = new Set<string>();
    // Holds the real input names that unknown-input typos most-likely meant.
    // When a typo's closest match is a still-unbound required input, that
    // missing-required is the same root cause as the typo — suppress it so
    // fixing the typo clears both. (We trust `findSuggestion`'s closest match;
    // on an ambiguous near-tie it could suppress the wrong name, but the
    // unknown-input error still points the author at the fix.)
    const suggestedTargets = new Set<string>();

    // The last binding for a param wins at runtime, so only its value is
    // type/constraint-checked; each earlier (overridden) occurrence is flagged
    // as a duplicate and its discarded value is not re-validated — otherwise one
    // bad losing value would stack N identical mismatches.
    const lastByParam = new Map<string, Record<string, unknown>>();
    for (const stmt of statements) {
      if (stmt.__kind !== 'WithClause') continue;
      const param = stmt.param as string | undefined;
      if (param) lastByParam.set(param, stmt);
    }

    for (const stmt of statements) {
      if (stmt.__kind !== 'WithClause') continue;
      const param = stmt.param as string | undefined;
      // A paramless clause (`with = 5`, a truncated `with`) only exists under
      // parse-error recovery and binds nothing — it must not count as opting in,
      // or a syntax error would trigger an avalanche of missing-required errors.
      if (!param) continue;
      bound.add(param);

      // An earlier, overridden occurrence: flag it as the redundant binding and
      // skip validating its discarded value.
      if (lastByParam.get(param) !== stmt) {
        this.reportDuplicate(stmt, param);
        continue;
      }

      const info = inputs.get(param);
      // Unknown input: the param isn't one of the format's declared inputs, so
      // it can't be bound — an Error.
      if (!info) {
        const suggestion = this.reportUnknownInput(stmt, param, inputs);
        if (suggestion !== undefined) suggestedTargets.add(suggestion);
        continue;
      }
      this.validateValue(stmt.value, info, `format input '${param}'`);
    }

    // Binding is all-or-nothing, but only once the author has opted in: a render
    // with no `with` clauses leaves every input to the LLM and is allowed. As
    // soon as one input is bound, the rest of the required inputs must be too.
    if (bound.size > 0) {
      this.reportMissingRequired(inputs, bound, suggestedTargets, renderRange);
    }
  }

  /**
   * Validate a value expression against an expected input shape.
   *
   * Recurses for inline dict/list literals (nested field checks); self-skips
   * for anything unintrospectable.
   */
  private validateValue(
    value: unknown,
    info: RenderInputInfo,
    label: string
  ): void {
    const kind = valueKind(value);

    // A connection-input reference value (`@inputs.Y` / `@connection.C.inputs.Y`)
    // carries its own resolution rules. When the reference itself is wrong, that
    // is the single root cause — skip the target type-check so we don't stack a
    // second diagnostic on the same value.
    if (this.checkConnectionInputRef(value)) return;

    // `...` (LLM-fill) is unsupported — binding is all-or-nothing, so every
    // value must be given explicitly.
    if (kind === 'ellipsis') {
      this.reportEllipsis(value, label);
      return;
    }
    // None (explicit null) clears a value. That's only meaningful for an
    // optional target; a required input/field cannot be nulled out — doing so
    // leaves a required value unsatisfied, same as never binding it.
    if (kind === 'none') {
      if (info.isRequired !== false) {
        this.reportRequiredNone(value, label);
      }
      return;
    }

    if (info.kind === 'object') {
      if (kind === 'dict') {
        // Inline dict literal — the only introspectable object value.
        this.validateDict(value as AstNodeLike, info, label);
        return;
      }
      // An `object` input accepts any value — we just can't drill into it for a
      // non-dict, so no type mismatch is raised. If the object declares required
      // fields and the value clearly isn't an object (a scalar/list), those
      // fields are unbound: report them. This is the actionable, higher-priority
      // diagnostic — it tells the author to expand the value into an object with
      // the required fields, rather than a vague "expected an object". An
      // object-typed or unresolvable value is a loose passthrough — accepted.
      if (info.fields && this.valueIsDefinitelyNotObject(value, kind)) {
        this.reportNestedMissingRequired(
          value as AstNodeLike,
          info.fields,
          new Set(),
          label
        );
      }
      return;
    }

    if (info.kind === 'list') {
      if (kind === 'list') {
        this.validateList(value as AstNodeLike, info, label);
        return;
      }
      if (kind === 'scalar' || kind === 'dict') {
        this.reportTypeMismatch(
          value,
          `${label} expects a list, but got ${
            kind === 'dict' ? 'an object' : 'a single value'
          }`
        );
        return;
      }
      // A list-typed value (e.g. `@outputs.items`) is accepted without element
      // introspection; an object- or scalar-typed value can never be a list.
      const vt = this.staticValueKind(value);
      if (vt && vt.kind !== 'list') {
        this.reportTypeMismatch(
          value,
          `${label} expects a list, but got ${
            vt.kind === 'object' ? 'an object' : typeLabel(vt.typeName)
          }`
        );
      }
      return;
    }

    // Scalar target — type family + constraints.
    this.validateScalar(value, info, label);
  }

  /** Validate an inline dict literal against an object input's `fields:`. */
  private validateDict(
    dict: AstNodeLike,
    info: RenderInputInfo,
    label: string
  ): void {
    const fields = info.fields;
    const entries =
      (dict as { entries?: Array<{ key: unknown; value: unknown }> }).entries ??
      [];

    const seenKeys = new Set<string>();
    // A typo'd field whose closest match is a real required field is the same
    // root cause as that field being missing — suppress its missing-required at
    // this level so fixing the typo clears both.
    const suggestedTargets = new Set<string>();

    // The last binding for a repeated key wins at runtime (mirrors the
    // top-level rule); only the winner's value is validated, and each earlier
    // occurrence is flagged as a duplicate rather than re-checked.
    const lastByKey = new Map<string, { key: unknown; value: unknown }>();
    for (const entry of entries) {
      const k = dictKeyName(entry.key);
      if (k !== undefined) lastByKey.set(k, entry);
    }

    for (const entry of entries) {
      const keyName = dictKeyName(entry.key);
      if (keyName === undefined) continue; // computed/dynamic key — skip
      seenKeys.add(keyName); // present, so it satisfies a required field

      // An earlier, overridden occurrence of a repeated key.
      if (lastByKey.get(keyName) !== entry) {
        this.reportDuplicate(
          entry.key as Record<string, unknown>,
          keyName,
          'key'
        );
        continue;
      }

      // Only keys the object declares under `fields:` can be bound — a key
      // that isn't declared is unknown, and an object with no `fields:` at all
      // accepts no keys.
      const fieldInfo = fields?.get(keyName);
      if (!fieldInfo) {
        const suggestion = this.reportNestedUnknownField(
          entry.key,
          keyName,
          fields,
          label
        );
        if (suggestion !== undefined) suggestedTargets.add(suggestion);
        continue;
      }

      this.validateValue(
        entry.value,
        fieldInfo,
        `field '${keyName}' of ${label}`
      );
    }

    // Required fields omitted from the inline literal.
    if (fields) {
      this.reportNestedMissingRequired(
        dict,
        fields,
        seenKeys,
        label,
        suggestedTargets
      );
    }
  }

  /** Validate an inline list literal against a list input's element shape. */
  private validateList(
    list: AstNodeLike,
    info: RenderInputInfo,
    label: string
  ): void {
    const elements = (list as { elements?: unknown[] }).elements ?? [];

    // Item-count check (min_items/max_items). An inline `...` is unsupported
    // (each element flags via validateValue below) and makes the count
    // unknowable, so skip the count check rather than pile on a second report.
    const hasEllipsis = elements.some(el => valueKind(el) === 'ellipsis');
    if (!hasEllipsis) {
      this.checkItemCount(list, elements.length, info.constraints, label);
    }

    const element = info.element;
    elements.forEach((el, i) => {
      const elLabel = `item ${i + 1} of ${label}`;
      if (element) {
        this.validateValue(el, element, elLabel);
      } else if (valueKind(el) === 'ellipsis') {
        // Untyped element — shape unchecked, but an inline `...` (LLM-fill) is
        // still unsupported and must be flagged.
        this.reportEllipsis(el, elLabel);
      }
    });
  }

  /** Check an inline list's length against `min_items` / `max_items`. */
  private checkItemCount(
    list: AstNodeLike,
    count: number,
    constraints: RenderInputConstraints | undefined,
    label: string
  ): void {
    if (!constraints) return;
    if (constraints.minItems !== undefined && count < constraints.minItems) {
      this.reportConstraint(
        list,
        `${label} must have at least ${constraints.minItems} item(s)`
      );
    }
    if (constraints.maxItems !== undefined && count > constraints.maxItems) {
      this.reportConstraint(
        list,
        `${label} must have at most ${constraints.maxItems} item(s)`
      );
    }
  }

  /**
   * Resolves a value's static structural kind + type (from typed `@variables`,
   * arithmetic, single-level `@outputs.X`, and connection-input references —
   * see `resolveGlobalMember` for the full set of namespaces resolved).
   *
   * Returns undefined when the value can't be introspected. `object`/`list`
   * report only their kind, not their inner shape (a "loose" container);
   * scalars report a type only for a recognized primitive family.
   */
  private staticValueKind(
    value: unknown
  ): { kind: 'scalar' | 'object' | 'list'; typeName: string } | undefined {
    const inferred = inferExpressionType(
      value,
      this.resolveVariable,
      this.resolveGlobalMember
    );
    if (!inferred) return undefined;
    const t = inferred.toLowerCase();
    if (t === 'object') return { kind: 'object', typeName: 'object' };
    if (t === 'list' || t.startsWith('list[')) {
      return { kind: 'list', typeName: 'list' };
    }
    if (SCALAR_FAMILY.has(t)) return { kind: 'scalar', typeName: inferred };
    return undefined; // unrecognized type — leave alone
  }

  /**
   * True when a non-dict value cannot possibly be an object — an inline
   * scalar/list literal, or a value whose static type resolves to scalar/list.
   * An object-typed value (loose passthrough) or an unresolvable one returns
   * false: we can't prove its fields are absent, so we leave it alone.
   */
  private valueIsDefinitelyNotObject(value: unknown, kind: ValueKind): boolean {
    if (kind === 'scalar' || kind === 'list') return true;
    const vt = this.staticValueKind(value);
    return vt !== undefined && vt.kind !== 'object';
  }

  /** Validate a scalar target — type-family then constraints. */
  private validateScalar(
    value: unknown,
    info: RenderInputInfo,
    label: string
  ): void {
    // A dict/list literal bound to a scalar is a kind clash.
    const kind = valueKind(value);
    if (kind === 'dict' || kind === 'list') {
      this.reportTypeMismatch(
        value,
        `${label} expects ${typeLabel(info.typeName)}, but got ${
          kind === 'dict' ? 'an object' : 'a list'
        }`
      );
      return;
    }

    // For a statically-resolvable value, a container type is a kind clash;
    // a scalar is checked against the target's type family.
    const vt = this.staticValueKind(value);
    if (vt) {
      if (vt.kind !== 'scalar') {
        this.reportTypeMismatch(
          value,
          `${label} expects ${typeLabel(info.typeName)}, but got ${
            vt.kind === 'object' ? 'an object' : 'a list'
          }`
        );
        return;
      }
      if (!scalarTypesCompatible(vt.typeName, info.typeName)) {
        this.reportTypeMismatch(
          value,
          `${label} expects ${typeLabel(info.typeName)}, but got ${typeLabel(
            vt.typeName
          )}`
        );
        return; // don't also constraint-check a wrong-typed value
      }
    }

    // Fractional literal bound to an integer/long is a value-level mismatch
    // even though 'number' is family-compatible.
    const intLiteral = staticLiteral(value);
    if (
      intLiteral?.kind === 'number' &&
      (info.typeName === 'integer' || info.typeName === 'long') &&
      !Number.isInteger(intLiteral.raw as number)
    ) {
      this.reportTypeMismatch(
        value,
        `${label} expects ${typeLabel(info.typeName)}, but got a decimal number`
      );
      return;
    }

    // Static-literal constraint violations (all scalar targets, string included).
    const literal = staticLiteral(value);
    if (info.constraints && literal) {
      this.checkConstraints(value, literal, info.constraints, label);
    }
  }

  /** Check a static literal against declared value constraints. */
  private checkConstraints(
    value: unknown,
    literal: { kind: string; raw: string | number | boolean },
    constraints: RenderInputConstraints,
    label: string
  ): void {
    if (constraints.enum && constraints.enum.length > 0) {
      if (!constraints.enum.includes(literal.raw)) {
        const allowed = constraints.enum.map(v => JSON.stringify(v)).join(', ');
        this.reportConstraint(value, `${label} must be one of: ${allowed}`);
      }
    }

    if (literal.kind === 'number') {
      const n = literal.raw as number;
      if (constraints.minimum !== undefined && n < constraints.minimum) {
        this.reportConstraint(
          value,
          `${label} must be at least ${constraints.minimum}`
        );
      }
      if (constraints.maximum !== undefined && n > constraints.maximum) {
        this.reportConstraint(
          value,
          `${label} must be at most ${constraints.maximum}`
        );
      }
    }

    if (literal.kind === 'string') {
      const len = (literal.raw as string).length;
      if (constraints.minLength !== undefined && len < constraints.minLength) {
        this.reportConstraint(
          value,
          `${label} must be at least ${constraints.minLength} characters`
        );
      }
      if (constraints.maxLength !== undefined && len > constraints.maxLength) {
        this.reportConstraint(
          value,
          `${label} must be at most ${constraints.maxLength} characters`
        );
      }
    }
  }

  // ------------------------------------------------------------------
  // Diagnostic emitters
  // ------------------------------------------------------------------

  /** Returns the suggested (closest-matching) real input name, if any. */
  private reportUnknownInput(
    stmt: Record<string, unknown>,
    param: string,
    inputs: Map<string, RenderInputInfo>
  ): string | undefined {
    const range = paramCstRange(stmt) ?? rangeOf(stmt);
    if (!range) return undefined;
    const suggestion = findSuggestion(param, [...inputs.keys()]);
    attachDiagnostic(
      stmt,
      lintDiagnostic(
        range,
        `'${param}' is not a declared input of this response format`,
        DiagnosticSeverity.Error,
        'render-with-unknown-input',
        { suggestion }
      )
    );
    return suggestion;
  }

  private reportUnknownConnectionInput(
    value: unknown,
    inputName: string,
    connection: string,
    inputs: Map<string, RenderInputInfo>
  ): void {
    const range = rangeOf(value);
    if (!range) return;
    const suggestion = findSuggestion(inputName, [...inputs.keys()]);
    attachDiagnostic(
      value as AstNodeLike,
      lintDiagnostic(
        range,
        `'${inputName}' is not a declared input of connection '${connection}'`,
        DiagnosticSeverity.Error,
        'render-with-unknown-connection-input',
        { suggestion }
      )
    );
  }

  private reportInputConnectionMismatch(
    value: unknown,
    inputName: string,
    refConnection: string
  ): void {
    const range = rangeOf(value);
    if (!range) return;
    attachDiagnostic(
      value as AstNodeLike,
      lintDiagnostic(
        range,
        `Connection input '${inputName}' belongs to '${refConnection}', not the active connection '${this.currentConnection}'`,
        DiagnosticSeverity.Error,
        'render-with-input-connection-mismatch'
      )
    );
  }

  private reportPrimitiveNoFields(
    render: Record<string, unknown>,
    formatName: string,
    renderRange: Range | undefined
  ): void {
    if (!renderRange) return;
    attachDiagnostic(
      render as AstNodeLike,
      lintDiagnostic(
        renderRange,
        `The built-in '${formatName}' response format has no fields to fill in — remove the \`with\` bindings`,
        DiagnosticSeverity.Error,
        'render-with-primitive-no-fields'
      )
    );
  }

  /**
   * One consolidated lint per level: "are all the required top-level inputs
   * bound?". It lists every missing top-level input in a single diagnostic and
   * does not recurse — a partially-bound object value reports its own missing
   * sub-fields at its own level (via {@link reportNestedMissingRequired}), so
   * each nesting level owns exactly one missing-required lint.
   */
  private reportMissingRequired(
    inputs: Map<string, RenderInputInfo>,
    bound: Set<string>,
    suggestedTargets: Set<string>,
    renderRange: Range | undefined
  ): void {
    if (!renderRange) return;
    const missing: string[] = [];
    for (const [name, info] of inputs) {
      if (info.isRequired === false) continue;
      if (bound.has(name)) continue;
      if (suggestedTargets.has(name)) continue;
      if (isSatisfiedByDefinition(info)) continue;
      missing.push(name);
    }
    if (missing.length === 0) return;
    attachDiagnostic(
      this.entry.ra,
      lintDiagnostic(
        renderRange,
        missing.length === 1
          ? `Required input '${missing[0]}' is not bound by a \`with\` clause`
          : `Required inputs are not bound by \`with\` clauses: ${missing.join(
              ', '
            )}`,
        DiagnosticSeverity.Error,
        'render-with-missing-required-input'
      )
    );
  }

  private reportRequiredNone(value: unknown, label: string): void {
    const range = rangeOf(value);
    if (!range) return;
    attachDiagnostic(
      value as AstNodeLike,
      lintDiagnostic(
        range,
        `${label} is required and cannot be None`,
        DiagnosticSeverity.Error,
        'render-with-required-none'
      )
    );
  }

  private reportTypeMismatch(value: unknown, message: string): void {
    const range = rangeOf(value);
    if (!range) return;
    attachDiagnostic(
      value as AstNodeLike,
      lintDiagnostic(
        range,
        message,
        DiagnosticSeverity.Warning,
        'render-with-type-mismatch'
      )
    );
  }

  private reportEllipsis(value: unknown, label: string): void {
    const range = rangeOf(value);
    if (!range) return;
    attachDiagnostic(
      value as AstNodeLike,
      lintDiagnostic(
        range,
        `${label} cannot be left as \`...\` — give it a fixed value, @variables, or @outputs`,
        DiagnosticSeverity.Error,
        'render-with-ellipsis'
      )
    );
  }

  private reportConstraint(value: unknown, message: string): void {
    const range = rangeOf(value);
    if (!range) return;
    attachDiagnostic(
      value as AstNodeLike,
      lintDiagnostic(
        range,
        message,
        DiagnosticSeverity.Warning,
        'render-with-constraint-violation'
      )
    );
  }

  /** Returns the suggested (closest-matching) real field name, if any. */
  private reportNestedUnknownField(
    keyNode: unknown,
    keyName: string,
    fields: Map<string, RenderInputInfo> | undefined,
    label: string
  ): string | undefined {
    const range = rangeOf(keyNode);
    if (!range) return undefined;
    const suggestion = findSuggestion(
      keyName,
      fields ? [...fields.keys()] : []
    );
    attachDiagnostic(
      keyNode as AstNodeLike,
      lintDiagnostic(
        range,
        `'${keyName}' is not a declared field of ${label}`,
        DiagnosticSeverity.Error,
        'render-with-nested-unknown-field',
        { suggestion }
      )
    );
    return suggestion;
  }

  /**
   * One consolidated lint per object level: "are all the required fields at
   * THIS level bound?". Lists every missing required field of this object in a
   * single diagnostic, one layer deep — a nested object's own missing fields
   * report at that nested level, not here.
   */
  private reportNestedMissingRequired(
    dict: AstNodeLike,
    fields: Map<string, RenderInputInfo>,
    seenKeys: Set<string>,
    label: string,
    suggestedTargets: Set<string> = new Set()
  ): void {
    const range = rangeOf(dict);
    if (!range) return;
    const missing: string[] = [];
    for (const [name, info] of fields) {
      if (info.isRequired === false) continue;
      if (seenKeys.has(name)) continue;
      if (suggestedTargets.has(name)) continue;
      if (isSatisfiedByDefinition(info)) continue;
      missing.push(name);
    }
    if (missing.length === 0) return;
    attachDiagnostic(
      dict,
      lintDiagnostic(
        range,
        missing.length === 1
          ? `${label} is missing a binding for required field '${missing[0]}'`
          : `${label} is missing bindings for required fields: ${missing.join(
              ', '
            )}`,
        DiagnosticSeverity.Error,
        'render-with-nested-missing-required-field'
      )
    );
  }

  private reportDuplicate(
    node: Record<string, unknown>,
    name: string,
    what: 'input' | 'key' = 'input'
  ): void {
    const range = paramCstRange(node) ?? rangeOf(node);
    if (!range) return;
    const noun = what === 'key' ? 'field' : 'input';
    attachDiagnostic(
      node as AstNodeLike,
      lintDiagnostic(
        range,
        `Duplicate binding for ${noun} '${name}' — the last value wins`,
        DiagnosticSeverity.Warning,
        'render-with-duplicate-input'
      )
    );
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/**
 * Reads a WithClause's param-token source range.
 *
 * Returns undefined when the parser recorded none. The param CST is a
 * tree-sitter `SyntaxNode` (as in action-io.ts), so it's converted with
 * `toRange` rather than reading a `.range` field.
 */
function paramCstRange(stmt: Record<string, unknown>): Range | undefined {
  const node = (stmt as { __paramCstNode?: SyntaxNode }).__paramCstNode;
  return node ? toRange(node) : undefined;
}

/**
 * Static name of an inline dict entry's key (an identifier or string literal).
 *
 * Returns undefined for a computed/dynamic key, which has no static name to
 * validate against the object's `fields:`.
 */
function dictKeyName(keyNode: unknown): string | undefined {
  if (!isAstNodeLike(keyNode)) return undefined;
  if (keyNode.__kind === 'Identifier' && typeof keyNode.name === 'string') {
    return keyNode.name;
  }
  if (keyNode.__kind === 'StringLiteral' && typeof keyNode.value === 'string') {
    return keyNode.value;
  }
  return undefined;
}
