/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Lint rules for the `ask for` statement.
 *
 * `ask for @variables.X` only fires while `state.X is None` — that condition
 * gates both the gather instruction and the auto-resume handoff. Two authoring
 * mistakes silently defeat it, so the user is never asked and nothing is
 * captured:
 *
 * 1. collect-target-already-set — the target variable already holds a literal
 *    (`""`, `0`, `False`, `[]`, ...) when the `ask for` is reached, so the
 *    step counts as answered. That happens through a literal default, or a
 *    `set @variables.X = <literal>` that definitely runs earlier in the same
 *    procedure (see {@link walk}). `= None`, no default, and linked variables
 *    are fine and never flagged.
 *
 * 2. collect-condition-contradicts — the `ask for` sits inside an `if` whose
 *    condition can never be true while the target is None. The condition is
 *    evaluated with the target = None using three-valued logic (see
 *    {@link evalCondition}); only a provable `false` is flagged.
 *
 * One pass emits both codes. Both are Warning severity and keep the internal
 * `collect-*` code spelling.
 */

import type {
  AstRoot,
  AstNodeLike,
  LintPass,
  NamedMap,
  PassStore,
} from '@agentscript/language';
import type { CstMeta } from '@agentscript/types';
import {
  isNamedMap,
  isAstNodeLike,
  isNoneLiteral,
  storeKey,
  attachDiagnostic,
  diagnosticTarget,
  extractVariableRef,
  lintDiagnostic,
  DiagnosticSeverity,
} from '@agentscript/language';
import { inferDefaultValueType } from './variable-default-type-check.js';
import { typeMapKey } from './type-map.js';
import type { TypeMap } from './type-map.js';

type Node = Record<string, unknown>;

function asNode(value: unknown): Node | null {
  return value && typeof value === 'object' ? (value as Node) : null;
}

function cstRange(value: unknown): CstMeta['range'] | undefined {
  const cst = asNode(value)?.__cst as CstMeta | undefined;
  return cst?.range;
}

function cstText(value: unknown): string | undefined {
  const cst = asNode(value)?.__cst as CstMeta | undefined;
  return cst?.node?.text?.trim();
}

/**
 * A concrete value (string, number, boolean, list, dict) — not `None`. Signed
 * numbers such as `-1` are handled by {@link inferDefaultValueType}.
 */
function isLiteral(value: unknown): boolean {
  return inferDefaultValueType(value) !== null;
}

/** A single `ask for` with the chain of `if` conditions that gate it. */
interface CollectSite {
  clause: AstNodeLike;
  /** The `@variables.X` target property name, or null if not a variable ref. */
  target: string | null;
  /** Conditions of every enclosing `if` whose body contains this `ask for`. */
  conditions: unknown[];
  /**
   * What gave the target the literal it still holds when the `ask for` is
   * reached: a `set @variables.X = <literal>` that definitely ran earlier, or
   * the variable's declaration (literal default). Null if it has none.
   */
  assignment: Node | null;
}

/**
 * Walk a statement list in execution order, collecting every `ask for` with
 * the `if` conditions that must hold for it to run, and the literal assignment
 * (if any) that is known to have set its target beforehand. Only an `if` body
 * (consequence) contributes a governing condition; `else`/`else if` bodies do
 * not add the parent condition (an `else if` link, itself an IfStatement,
 * still contributes its own condition when recursed into). RunStatement bodies
 * are nested procedures.
 *
 * `assigned` maps a variable to the `set` (or, seeded at the start, the
 * declaration) that definitely gave it a literal value at this point. It is
 * conservative: a nested `if`/`run` body starts from a copy of it, and
 * afterwards every variable the body wrote is forgotten, since the body may or
 * may not have run.
 *
 * Returns the names of the variables written (`set` or `ask for`) in `stmts`.
 */
function walk(
  stmts: unknown,
  conditions: unknown[],
  assigned: Map<string, Node>,
  sites: CollectSite[]
): Set<string> {
  const written = new Set<string>();
  if (!Array.isArray(stmts)) return written;

  const forget = (names: Set<string>): void => {
    for (const name of names) {
      assigned.delete(name);
      written.add(name);
    }
  };

  for (const raw of stmts) {
    const stmt = asNode(raw);
    if (!stmt) continue;
    switch (stmt.__kind) {
      case 'CollectClause': {
        const target = extractVariableRef(stmt.target);
        sites.push({
          clause: raw as AstNodeLike,
          target,
          conditions: [...conditions],
          assignment: target ? (assigned.get(target) ?? null) : null,
        });
        // The user's answer replaces whatever the variable held.
        if (target) forget(new Set([target]));
        break;
      }
      case 'SetClause': {
        const target = extractVariableRef(stmt.target);
        if (!target) break;
        if (isLiteral(stmt.value)) assigned.set(target, stmt);
        else assigned.delete(target);
        written.add(target);
        break;
      }
      case 'IfStatement': {
        // Both branches start from the state before the `if`.
        const inBody = walk(
          stmt.body,
          [...conditions, stmt.condition],
          new Map(assigned),
          sites
        );
        const inElse = walk(stmt.orelse, conditions, new Map(assigned), sites);
        forget(inBody);
        forget(inElse);
        break;
      }
      case 'RunStatement':
        forget(walk(stmt.body, conditions, new Map(assigned), sites));
        break;
      default:
        break;
    }
  }
  return written;
}

type Tri = 'true' | 'false' | 'unknown';

function flip(t: Tri): Tri {
  if (t === 'true') return 'false';
  if (t === 'false') return 'true';
  return 'unknown';
}

/** True if the expression is a reference to the target `@variables.X`. */
function isTargetRef(expr: unknown, target: string): boolean {
  return extractVariableRef(expr) === target;
}

/**
 * Evaluate a comparison with the target treated as None. Determinate only when
 * one side is the target and the other is a literal or None; otherwise unknown.
 */
function evalComparison(expr: Node, target: string): Tri {
  let other: unknown;
  if (isTargetRef(expr.left, target)) other = expr.right;
  else if (isTargetRef(expr.right, target)) other = expr.left;
  else return 'unknown';

  const otherIsNone = isNoneLiteral(other);
  if (!otherIsNone && !isLiteral(other)) return 'unknown';

  switch (expr.operator) {
    case '==':
      return otherIsNone ? 'true' : 'false';
    case '!=':
      return otherIsNone ? 'false' : 'true';
    case 'is':
      return otherIsNone ? 'true' : 'unknown';
    case 'is not':
      return otherIsNone ? 'false' : 'unknown';
    default:
      // <, >, <=, >= against None/literal is not meaningfully determinate here.
      return 'unknown';
  }
}

/**
 * Three-valued evaluation of an `if` condition with the `ask for` target = None:
 * - `and` is false if any part is false; `or` is false only if every part is
 *   false; `not` flips true/false and leaves unknown unchanged.
 * - `X == literal`, `X is not None`, bare `X` are false; `X != literal`,
 *   `X is None`, `not X` are true.
 * - Other variables, `<`/`>`, `in`, calls, ternaries are unknown.
 */
function evalCondition(expr: unknown, target: string): Tri {
  const node = asNode(expr);
  if (!node) return 'unknown';

  // Bare `@variables.X` (truthiness): None is falsy.
  if (isTargetRef(expr, target)) return 'false';

  switch (node.__kind) {
    case 'UnaryExpression':
      return node.operator === 'not'
        ? flip(evalCondition(node.operand, target))
        : 'unknown';
    case 'BinaryExpression': {
      if (node.operator !== 'and' && node.operator !== 'or') return 'unknown';
      const l = evalCondition(node.left, target);
      const r = evalCondition(node.right, target);
      if (node.operator === 'and') {
        if (l === 'false' || r === 'false') return 'false';
        if (l === 'unknown' || r === 'unknown') return 'unknown';
        return 'true';
      }
      if (l === 'true' || r === 'true') return 'true';
      if (l === 'false' && r === 'false') return 'false';
      return 'unknown';
    }
    case 'ComparisonExpression':
      return evalComparison(node, target);
    default:
      return 'unknown';
  }
}

/**
 * Variables declared with a literal default, mapped to their declaration.
 * Linked variables draw their value externally, so their default never applies.
 */
function literalDefaults(root: AstRoot, typeMap: TypeMap): Map<string, Node> {
  const defaults = new Map<string, Node>();
  const varsMap = (root as Node).variables;
  if (!isNamedMap(varsMap)) return defaults;

  for (const [name, raw] of varsMap as NamedMap<unknown>) {
    const decl = asNode(raw);
    if (!decl || typeMap.variables.get(name)?.modifier === 'linked') continue;
    // No default and `= None` are not literals, so they are skipped here.
    if (isLiteral(decl.defaultValue)) defaults.set(name, decl);
  }
  return defaults;
}

function reportAlreadySet(site: CollectSite, target: string): void {
  const assignment = site.assignment;
  if (!assignment) return;

  const range = cstRange((site.clause as Node).target) ?? cstRange(site.clause);
  if (!range) return;

  const isSet = assignment.__kind === 'SetClause';
  const literal = cstText(isSet ? assignment.value : assignment.defaultValue);
  const literalHint = literal ? ` (\`${literal}\`)` : '';
  const reason = isSet
    ? `'${target}' is set to a literal${literalHint} earlier in this procedure, so it is already set when the \`ask for\` is reached and the user is never asked. Remove the assignment or set it to None.`
    : `'${target}' has a literal default${literalHint}, so it is already set on the first turn and the user is never asked. Remove the default or set it to None.`;
  attachDiagnostic(
    site.clause,
    lintDiagnostic(
      range,
      `\`ask for @variables.${target}\` never runs: ${reason}`,
      DiagnosticSeverity.Warning,
      'collect-target-already-set',
      { target: diagnosticTarget('variable', target) }
    )
  );
}

function reportConditionContradicts(site: CollectSite, target: string): void {
  // The `ask for` only runs when every enclosing condition holds. If any is
  // provably false while the target is None, it can never fire.
  const contradicting = site.conditions.find(
    cond => evalCondition(cond, target) === 'false'
  );
  if (contradicting === undefined) return;

  const range = cstRange(contradicting) ?? cstRange(site.clause);
  if (!range) return;

  attachDiagnostic(
    site.clause,
    lintDiagnostic(
      range,
      `\`ask for @variables.${target}\` never runs: this \`if\` condition is always false while '${target}' is None, which is the only time an \`ask for\` fires, so the user is never asked.`,
      DiagnosticSeverity.Warning,
      'collect-condition-contradicts',
      { target: diagnosticTarget('variable', target) }
    )
  );
}

class AskForPass implements LintPass {
  readonly id = storeKey<void>('ask-for');
  readonly description =
    'Warns when an `ask for` never fires: its target already holds a literal, or an enclosing `if` is always false while the target is None.';
  readonly requires = [typeMapKey];

  private procedures: AstNodeLike[] = [];

  init(): void {
    this.procedures = [];
  }

  enterNode(_key: string, value: unknown): void {
    if (isAstNodeLike(value) && value.__kind === 'ProcedureValue') {
      this.procedures.push(value);
    }
  }

  run(store: PassStore, root: AstRoot): void {
    if (this.procedures.length === 0) return;
    const typeMap = store.get(typeMapKey);
    if (!typeMap) return;

    // Every procedure starts with the declared literal defaults already
    // assigned, so a later `set` overrides them like any other assignment.
    const defaults = literalDefaults(root, typeMap);
    const sites: CollectSite[] = [];
    for (const proc of this.procedures) {
      walk((proc as Node).statements, [], new Map(defaults), sites);
    }

    for (const site of sites) {
      if (!site.target) continue;
      reportAlreadySet(site, site.target);
      reportConditionContradicts(site, site.target);
    }
  }
}

export function askForRule(): LintPass {
  return new AskForPass();
}
