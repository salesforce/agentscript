/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Shared helpers for compiling `if [/ else if ...] [/ else]` chains.
 *
 * Both deterministic-directive compilation (compile-directives.ts) and
 * post-tool-call conditional compilation (compile-tool.ts) need to walk
 * the same chain shape and allocate the same per-link condition slot
 * variables. The two call sites diverge only in *how* they emit each
 * branch's body — they use different gate-tracking machinery — so the
 * walk + slot allocation lives here, and the emission stays inline at
 * each call site.
 */
import type { Statement } from '@agentscript/language';
import { IfStatement } from '@agentscript/language';
import type { CompilerContext } from '../compiler-context.js';
import { compileExpression } from '../expressions/compile-expression.js';
import { chainConditionVariableName } from '../constants.js';

/**
 * One link in a compiled chain. The `slotName` is the runtime state variable
 * (e.g. `AgentScriptInternal_condition_2`) holding this branch's truth value.
 */
export interface ChainBranch {
  /** Compiled boolean expression (e.g. `state.x == "a"`). */
  condition: string;
  /** Statements inside this branch's body. */
  body: Statement[];
  /** Runtime state variable name allocated for this branch's truth value. */
  slotName: string;
}

/** Result of walking an if/else-if chain. */
export interface ElseIfChainWalk {
  /** One entry per link in the chain (head + each `else if`). */
  branches: ChainBranch[];
  /** Statements in the trailing `else:` body, or null if no else clause. */
  elseBody: Statement[] | null;
}

/** True when this IfStatement starts an `else if` chain. */
export function isElseIfChainHead(stmt: IfStatement): boolean {
  return (
    stmt.orelse.length === 1 &&
    stmt.orelse[0] instanceof IfStatement &&
    (stmt.orelse[0] as IfStatement).__cst?.node?.type === 'else_if_clause'
  );
}

/**
 * Walk an `else if` chain starting at `head`, allocating a slot variable
 * for each branch. Slot indices start at 1 and increment per branch within
 * this chain — multiple chains in the same node reuse the same slots, which
 * is safe because chains execute sequentially. Updates
 * `ctx.maxChainConditionSlot` so the agent_version assembler can declare
 * exactly the slots used.
 *
 * The `expressionContext` string is forwarded to `compileExpression` so
 * diagnostics correctly attribute parse errors to the calling code path
 * (e.g. `'if' condition` vs. `'if' statement condition`).
 */
export function walkElseIfChain(
  head: IfStatement,
  ctx: CompilerContext,
  expressionContext: string
): ElseIfChainWalk {
  const branches: ChainBranch[] = [];
  let elseBody: Statement[] | null = null;
  let cursor: IfStatement | null = head;
  let slotCounter = 1;

  while (cursor) {
    const condition = compileExpression(cursor.condition, ctx, {
      expressionContext,
    });
    const slotIndex = slotCounter++;
    const slotName = chainConditionVariableName(slotIndex);
    ctx.maxChainConditionSlot = Math.max(
      ctx.maxChainConditionSlot ?? 0,
      slotIndex
    );
    branches.push({ condition, body: cursor.body, slotName });

    if (cursor.orelse.length === 0) {
      cursor = null;
    } else if (
      cursor.orelse.length === 1 &&
      cursor.orelse[0] instanceof IfStatement &&
      (cursor.orelse[0] as IfStatement).__cst?.node?.type === 'else_if_clause'
    ) {
      cursor = cursor.orelse[0] as IfStatement;
    } else {
      elseBody = cursor.orelse;
      cursor = null;
    }
  }

  return { branches, elseBody };
}

/**
 * Build the runtime `enabled` expression for the n-th chain branch:
 * every prior branch's slot negated AND this branch's slot positive.
 *
 * For a single-branch chain (length 1) the gate is just `state.<slot>`,
 * matching the simpler shape callers expect when there's no chain.
 */
export function buildChainBranchGate(
  branches: readonly { slotName: string }[],
  idx: number
): string {
  if (branches.length === 1) return `state.${branches[0].slotName}`;
  const parts: string[] = [];
  for (let j = 0; j < idx; j++) {
    parts.push(`not (state.${branches[j].slotName})`);
  }
  parts.push(`state.${branches[idx].slotName}`);
  return parts.map(p => `(${p})`).join(' and ');
}

/**
 * Build the runtime `enabled` expression for a trailing `else:` body —
 * every chain slot negated, joined with `and`.
 */
export function buildChainElseGate(
  branches: readonly { slotName: string }[]
): string {
  return branches.map(b => `not (state.${b.slotName})`).join(' and ');
}
