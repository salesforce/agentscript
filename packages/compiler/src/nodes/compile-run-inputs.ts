/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { WithClause, SetClause, Ellipsis } from '@agentscript/language';
import type { RunStatement } from '@agentscript/language';
import { toRange } from '@agentscript/types';
import type { Range } from '@agentscript/types';
import type { CompilerContext } from '../compiler-context.js';
import type { StateUpdate } from '../types.js';
import { compileExpression } from '../expressions/compile-expression.js';
import { resolveAtReference } from '../ast-helpers.js';

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
 * or the bare `with param` shorthand that desugars to the same ellipsis) are
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
      if (child.value instanceof Ellipsis) {
        ctx.error(
          `LLM-filled inputs ("..." or a bare "with ${child.param}") are only supported on reasoning actions (reasoning.actions). ` +
            `This "run" executes deterministically with no LLM call, so provide a value, e.g. "with ${child.param} = @variables.X".`,
          ellipsisRange(child)
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

/**
 * Precise range for the LLM-filled-input error: the `...` token when written
 * explicitly, else the `param` key for the bare `with param` shorthand (whose
 * ellipsis is synthesized and has no CST), falling back to the whole clause.
 */
function ellipsisRange(clause: WithClause): Range | undefined {
  if (clause.value.__cst) return clause.value.__cst.range;
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
