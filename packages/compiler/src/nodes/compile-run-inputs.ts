/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import {
  WithClause,
  SetClause,
  Ellipsis,
  decomposeAtMemberExpression,
  forEachExpressionChild,
  isAstNodeLike,
} from '@agentscript/language';
import {
  RUN_UTILS_CODE,
  SUBAGENT_UNKNOWN_ACTION_CODE,
  runUtilsMessage,
  subagentUnknownActionMessage,
} from '@agentscript/agentscript-dialect';
import type { RunStatement } from '@agentscript/language';
import { toRange } from '@agentscript/types';
import type { Range } from '@agentscript/types';
import type { CompilerContext } from '../compiler-context.js';
import type { StateUpdate } from '../types.js';
import { compileExpression } from '../expressions/compile-expression.js';
import { resolveAtReference } from '../ast-helpers.js';

/**
 * Resolve a subagent `run` target to the action it runs, or report why it
 * can't be run and return undefined: `@utils` members are invoked through
 * their statement forms, and the subagent's reasoning actions are tools, not
 * actions. Same checks and messages as the run-target lint pass.
 */
export function resolveRunTarget(
  stmt: RunStatement,
  ctx: CompilerContext
): string | undefined {
  const range = stmt.target?.__cst?.range ?? stmt.__cst?.range;
  const ref = decomposeAtMemberExpression(stmt.target);
  if (ref?.namespace === 'utils') {
    ctx.error(runUtilsMessage(ref.property), range, RUN_UTILS_CODE);
    return undefined;
  }
  const target = resolveAtReference(
    stmt.target,
    'actions',
    ctx,
    'action target'
  );
  if (target && ctx.reasoningOnlyActionNames.has(target)) {
    ctx.error(
      subagentUnknownActionMessage(target),
      range,
      SUBAGENT_UNKNOWN_ACTION_CODE
    );
    return undefined;
  }
  return target;
}

export interface DeterministicRunInputs {
  boundInputs: Record<string, string>;
  stateUpdates: StateUpdate[];
}

/**
 * Compile the `with` / `set` clauses of a DETERMINISTIC `run` — a run executed
 * from a hook context: `before_reasoning`, `after_reasoning`,
 * `reasoning.instructions` (lowered into `before_reasoning_iteration`), or
 * nested under a reasoning action (lowered into `post_tool_call`).
 *
 * These runs fire with no LLM call, so LLM-filled inputs (`with param = ...`,
 * the bare `with param` shorthand that desugars to the same ellipsis, or a
 * `...` nested anywhere in the value, e.g. `... if cond else x`) are
 * NOT supported: the LLM only fills inputs while tools are surfaced to it, i.e.
 * on actions declared directly under `reasoning.actions`. Each such clause gets
 * a compile error and is dropped — this prevents the literal `...` expression
 * from reaching `bound_inputs`, where the runtime would raise a SecurityError.
 *
 * As a safety net, any REQUIRED declared input that is left unprovided gets a
 * warning: deterministic runs can't fill it, so it is silently missing at
 * runtime otherwise.
 *
 * `llm_inputs` is always empty for deterministic runs — the caller emits `[]`.
 *
 * @param setTargetNamespaces namespaces a `set` clause target may resolve
 *   against (before/after_reasoning allow `variables`; post-tool additionally
 *   allows `outputs`).
 */
export function compileDeterministicRunInputs(
  stmt: RunStatement,
  target: string,
  ctx: CompilerContext,
  setTargetNamespaces: string | string[]
): DeterministicRunInputs {
  const boundInputs: Record<string, string> = {};
  const stateUpdates: StateUpdate[] = [];
  // Params whose `with` clause was rejected for being LLM-filled. They already
  // carry an error (with a concrete-value fix), so the missing-required-input
  // warning below must not also fire for them — that would double-report an
  // input the author clearly meant to provide.
  const erroredParams = new Set<string>();

  for (const child of stmt.body) {
    if (child instanceof WithClause) {
      const ellipsis = findEllipsis(child.value);
      if (ellipsis) {
        ctx.error(
          `LLM-filled inputs ("..." or a bare "with ${child.param}") are only supported on reasoning actions (reasoning.actions). ` +
            `This "run" executes deterministically with no LLM call, so provide a value, e.g. "with ${child.param} = @variables.X".`,
          ellipsisRange(child, ellipsis)
        );
        erroredParams.add(child.param);
        continue;
      }
      boundInputs[child.param] = compileExpression(child.value, ctx, {
        expressionContext: "'with' clause",
      });
    } else if (child instanceof SetClause) {
      const varName = resolveAtReference(
        child.target,
        setTargetNamespaces,
        ctx,
        'variable name'
      );
      if (varName) {
        stateUpdates.push({
          [varName]: compileExpression(child.value, ctx, {
            expressionContext: "'set' clause",
          }),
        });
      }
    }
  }

  warnMissingRequiredInputs(stmt, target, boundInputs, erroredParams, ctx);

  return { boundInputs, stateUpdates };
}

/** The first `...` in `expr`, whether it is `expr` itself or nested inside it. */
function findEllipsis(expr: unknown): Ellipsis | undefined {
  if (expr instanceof Ellipsis) return expr;
  if (!isAstNodeLike(expr)) return undefined;
  let found: Ellipsis | undefined;
  forEachExpressionChild(expr, child => {
    found ??= findEllipsis(child);
  });
  return found;
}

/**
 * Precise range for the LLM-filled-input error: the `...` token when written
 * explicitly, else the `param` key for the bare `with param` shorthand (whose
 * ellipsis is synthesized and has no CST), falling back to the whole clause.
 */
function ellipsisRange(
  clause: WithClause,
  ellipsis: Ellipsis
): Range | undefined {
  if (ellipsis.__cst) return ellipsis.__cst.range;
  if (clause.__paramCstNode) return toRange(clause.__paramCstNode);
  return clause.__cst?.range;
}

/**
 * Warn about required declared inputs that this deterministic run leaves
 * unprovided. Mirrors the signature lookup in `setDefaultLlmInputs` (per-topic
 * signatures, falling back to the preserved top-level action signatures), but
 * instead of defaulting the input to LLM-filled (impossible here) it flags that
 * the value will be missing at runtime.
 */
function warnMissingRequiredInputs(
  stmt: RunStatement,
  target: string,
  boundInputs: Record<string, string>,
  erroredParams: Set<string>,
  ctx: CompilerContext
): void {
  const sig =
    ctx.actionInputSignatures.get(target) ??
    ctx.topLevelActionSignatures.get(target);
  if (!sig) return;

  const range = stmt.target.__cst?.range ?? stmt.__cst?.range;
  for (const name of sig.requiredInputs) {
    if (Object.prototype.hasOwnProperty.call(boundInputs, name)) continue;
    if (erroredParams.has(name)) continue;
    ctx.warning(
      `Required input "${name}" is not provided on this "run". ` +
        `Deterministic runs do not call the LLM, so an unprovided input is missing at runtime — ` +
        `provide a value with "with ${name} = <value>".`,
      range
    );
  }
}
