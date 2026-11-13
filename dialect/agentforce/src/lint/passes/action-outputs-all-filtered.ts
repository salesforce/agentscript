/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Warns when every output of an Agentforce action is hidden from the agent.
 *
 * Only actions the planner can actually invoke as a tool are checked — i.e.
 * actions bound via `@actions.<name>` in some block's `reasoning.actions`, or
 * workflow actions referenced as `{!@actions.<name>}` in a workflow's `|`
 * directive lines (each such reference compiles to an LLM tool).
 * Actions that are only run deterministically (e.g. `run @actions.X ... set
 * @variables.Y = @outputs.Z` in `before_reasoning`/`after_reasoning`) filter
 * every output on purpose: their values reach the LLM through variables, not
 * through the planner, so flagging them would wrongly suggest exposing
 * hidden content (guardrails, brand rules, etc.) to the planner context. If
 * an action is both run deterministically and exposed as a tool, it still
 * warns, since the planner path still gets an empty result.
 *
 * When a planner-exposed action has every output hidden, the LLM sees that it
 * called the action but gets an empty result, so it may fall back to a
 * generic reply instead of reflecting what the action did. Keeping at least one readable output (e.g.
 * a status or confirmation string) with `filter_from_agent: False` avoids
 * this.
 *
 * Hidden-output semantics mirror the compiler's `filter_from_agent` /
 * `is_used_by_planner` precedence in `compileOutputParameter`
 * (packages/compiler/src/nodes/compile-actions.ts): `filter_from_agent: True`
 * always hides an output from the planner regardless of `is_used_by_planner`;
 * otherwise an explicit `is_used_by_planner: False` also hides it. Omitting
 * both flags leaves the output visible — the default is not filtered.
 * `is_displayable: True` does not count as visible to the planner: it only
 * controls whether a human sees the output via a custom renderer, so an
 * output can be user-visible and still invisible to the LLM.
 *
 * Diagnostics: action-outputs-all-filtered
 */

import type { AstNodeLike, AstRoot } from '@agentscript/language';
import type { LintPass, PassStore } from '@agentscript/language';
import {
  attachDiagnostic,
  decomposeAtMemberExpression,
  isAstNodeLike,
  isNamedMap,
  isTemplateInterpolation,
  lintDiagnostic,
  recurseAstChildren,
  resolveColinearAction,
  schemaContextKey,
  storeKey,
} from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import { getBlockRange, iterateActionsWithOwner } from '../utils.js';

/** Read a `BooleanValue` property's literal value, or undefined when absent/non-boolean. */
function readBooleanProp(
  properties: Record<string, unknown> | undefined,
  fieldName: string
): boolean | undefined {
  if (!properties) return undefined;
  const field = properties[fieldName];
  if (!isAstNodeLike(field) || field.__kind !== 'BooleanValue') {
    return undefined;
  }
  return typeof field.value === 'boolean' ? field.value : undefined;
}

/**
 * Whether an output declaration ends up hidden from the agent/planner at
 * compile time. See the module doc comment for the precedence this mirrors.
 */
function isOutputHiddenFromAgent(decl: AstNodeLike): boolean {
  const props = decl.properties as Record<string, unknown> | undefined;
  if (readBooleanProp(props, 'filter_from_agent') === true) return true;
  return readBooleanProp(props, 'is_used_by_planner') === false;
}

/**
 * Whether `ownerBlock` exposes `actionName` to the planner, either through its
 * own `reasoning.actions` or, for a workflow, as a tool in a `|` directive.
 */
function isExposedToPlanner(
  ownerBlock: AstNodeLike,
  actionName: string
): boolean {
  return (
    isBoundInReasoningActions(ownerBlock, actionName) ||
    isWorkflowDirectiveTool(ownerBlock, actionName)
  );
}

/**
 * Whether some entry in `ownerBlock`'s own `reasoning.actions` binds a handle
 * to `@actions.<actionName>`.
 * This mirrors the resolution `reasoningActionsAnalyzer`
 * (dialect/agentscript/src/lint/passes/reasoning-actions.ts) uses for
 * `@actions.X` references — scoped to the single block instance that
 * declares both the action and the binding, with no cross-block resolution.
 */
function isBoundInReasoningActions(
  ownerBlock: AstNodeLike,
  actionName: string
): boolean {
  const reasoning = ownerBlock.reasoning;
  if (!isAstNodeLike(reasoning)) return false;

  const raActions = reasoning.actions;
  if (!isNamedMap(raActions)) return false;

  for (const [, raBlock] of raActions) {
    if (!isAstNodeLike(raBlock)) continue;
    // resolveColinearAction expects a plain `{ value?: unknown }` shape;
    // AstNodeLike's named optional properties defeat TS's structural match
    // against that minimal type, so go through Record<string, unknown> (same
    // workaround reasoningActionsAnalyzer uses for the identical call).
    const ra = raBlock as Record<string, unknown>;
    if (resolveColinearAction(ra) === actionName) return true;
  }
  return false;
}

/**
 * Whether a workflow's `steps`/`step` bodies reference `{!@actions.<actionName>}`
 * in a `|` directive line. The compiler (`compileDo` in
 * packages/compiler/src/nodes/compile-workflow-node.ts) turns each such
 * reference into a tool the LLM can call. Only `steps`/`step` are searched:
 * outside a workflow, `{!@actions.X}` in `reasoning.instructions` names a
 * `reasoning.actions` handle, not an action definition.
 */
function isWorkflowDirectiveTool(
  ownerBlock: AstNodeLike,
  actionName: string
): boolean {
  let found = false;
  const visit = (node: unknown): void => {
    if (found) return;
    if (isTemplateInterpolation(node)) {
      const ref = decomposeAtMemberExpression(node.expression);
      if (ref?.namespace === 'actions' && ref.property === actionName) {
        found = true;
      }
      return;
    }
    recurseAstChildren(node, (_key, child) => visit(child));
  };
  visit(ownerBlock.steps);
  visit(ownerBlock.step);
  return found;
}

class ActionOutputsAllFilteredPass implements LintPass {
  readonly id = storeKey('action-outputs-all-filtered');
  readonly description =
    'Warns when every output of a planner-exposed action is hidden from the agent (filter_from_agent / is_used_by_planner), leaving the LLM with an empty result';
  readonly requires = [schemaContextKey];

  run(store: PassStore, root: AstRoot): void {
    const ctx = store.get(schemaContextKey);
    if (!ctx) return;

    for (const { actionName, actBlock, ownerBlock } of iterateActionsWithOwner(
      root,
      ctx
    )) {
      if (!isExposedToPlanner(ownerBlock, actionName)) continue;
      this.checkAction(actionName, actBlock);
    }
  }

  private checkAction(actionName: string, actBlock: AstNodeLike): void {
    const outputsMap = actBlock.outputs;
    if (!isNamedMap(outputsMap) || outputsMap.size === 0) return;

    for (const [, decl] of outputsMap) {
      if (!isAstNodeLike(decl)) continue;
      // At least one visible output means the agent still gets a signal.
      if (!isOutputHiddenFromAgent(decl)) return;
    }

    attachDiagnostic(
      actBlock,
      lintDiagnostic(
        getBlockRange(outputsMap),
        `Action '${actionName}' filters every output from the agent, so the LLM sees the call but gets an empty result and may fall back to a generic reply. If the planner needs to know the outcome, set 'filter_from_agent: False' on at least one output (for example, a status or confirmation string).`,
        DiagnosticSeverity.Warning,
        'action-outputs-all-filtered'
      )
    );
  }
}

/** Build the "all action outputs filtered from agent" lint rule. */
export function actionOutputsAllFilteredRule(): LintPass {
  return new ActionOutputsAllFilteredPass();
}
