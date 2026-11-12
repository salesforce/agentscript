/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type {
  AstNodeLike,
  AstRoot,
  LintPass,
  NamedMap,
  PassStore,
} from '@agentscript/language';
import {
  attachDiagnostic,
  decomposeAtMemberExpression,
  isAstNodeLike,
  isNamedMap,
  lintDiagnostic,
  recurseAstChildren,
  resolveNamespaceKeys,
  schemaContextKey,
  storeKey,
} from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';

export const RUN_UTILS_CODE = 'run-utils-unsupported';
export const SUBAGENT_UNKNOWN_ACTION_CODE = 'subagent-unknown-action';

/** The statement that replaces `run @utils.<member>`. */
const UTILS_STATEMENTS: Record<string, string> = {
  escalate: 'escalate',
  transition: 'transition to @subagent.<name>',
  setVariables: 'set @variables.<name> = <value>',
  end_session: 'end_session',
};

/**
 * Message for `run @utils.X`. `@utils` members are reasoning-action targets;
 * deterministic logic uses their statement forms instead. The compiler uses
 * the same message, so the lint and compile diagnostics merge.
 */
export function runUtilsMessage(member: string): string {
  const statement = UTILS_STATEMENTS[member];
  return statement
    ? `'run' cannot target '@utils.${member}'. Use '${statement}' instead.`
    : `'run' cannot target '@utils.${member}'. Only '@actions' can be run.`;
}

/**
 * Message for a subagent `run @actions.X` whose target is a reasoning action
 * rather than an action definition. The compiler uses the same message, so the
 * lint and compile diagnostics merge.
 */
export function subagentUnknownActionMessage(name: string): string {
  return `'run' target '${name}' is not an action defined in this subagent's 'actions'. Subagents can only run their own actions, or the agent-level actions they inherit.`;
}

/**
 * Keys of a subagent's `reasoning.actions` that name no action definition:
 * neither the subagent's own `actions` nor an inherited agent-level action.
 *
 * `reasoning.actions` binds LLM-callable tools (`@utils.escalate`,
 * `@utils.transition`, `@utils.setVariables`, `@actions.X` aliases), not
 * action definitions, so a deterministic `run` may not target them. For
 * `@utils.escalate` this matters most: its `__human__` handoff only fires after
 * an LLM tool call, so a `run` on it never escalates.
 */
export function reasoningOnlyActionNames(
  subagent: AstNodeLike,
  topLevelActions: { has(name: string): boolean } | undefined
): Set<string> {
  const names = new Set<string>();
  const reasoning = subagent.reasoning;
  if (!isAstNodeLike(reasoning) || !isNamedMap(reasoning.actions)) {
    return names;
  }
  const ownActions = isNamedMap(subagent.actions)
    ? subagent.actions
    : undefined;
  for (const [key] of reasoning.actions as NamedMap<unknown>) {
    if (!ownActions?.has(key) && !topLevelActions?.has(key)) names.add(key);
  }
  return names;
}

/** Call `visit` on every `run` statement under `value`. */
function forEachRun(value: unknown, visit: (run: AstNodeLike) => void): void {
  if (isAstNodeLike(value) && value.__kind === 'RunStatement') visit(value);
  recurseAstChildren(value, (_key, child) => forEachRun(child, visit));
}

function report(run: AstNodeLike, message: string, code: string): void {
  const target = isAstNodeLike(run.target) ? run.target : undefined;
  const range = target?.__cst?.range ?? run.__cst?.range;
  if (!range) return;
  attachDiagnostic(
    run,
    lintDiagnostic(range, message, DiagnosticSeverity.Error, code)
  );
}

class RunTargetPass implements LintPass {
  readonly id = storeKey<void>('run-target');
  readonly description =
    "Rejects `run` on an `@utils` member, and a subagent's `run @actions.X` when X is a reasoning action rather than an action definition.";

  run(store: PassStore, root: AstRoot): void {
    const rootObj = root as AstNodeLike;

    forEachRun(rootObj, run => {
      const ref = decomposeAtMemberExpression(run.target);
      if (ref?.namespace === 'utils') {
        report(run, runUtilsMessage(ref.property), RUN_UTILS_CODE);
      }
    });

    const ctx = store.get(schemaContextKey);
    if (!ctx) return;
    // 'subagent' (base dialect) and 'topic' (agentforce dialect).
    const keys = new Set([
      ...resolveNamespaceKeys('subagent', ctx),
      ...resolveNamespaceKeys('topic', ctx),
    ]);
    const topLevelActions = isNamedMap(rootObj.actions)
      ? rootObj.actions
      : undefined;

    for (const key of keys) {
      const blocks = rootObj[key];
      if (!isNamedMap(blocks)) continue;
      for (const [, block] of blocks as NamedMap<unknown>) {
        if (!isAstNodeLike(block)) continue;
        const names = reasoningOnlyActionNames(block, topLevelActions);
        if (names.size === 0) continue;
        forEachRun(block, run => {
          const ref = decomposeAtMemberExpression(run.target);
          if (ref?.namespace === 'actions' && names.has(ref.property)) {
            report(
              run,
              subagentUnknownActionMessage(ref.property),
              SUBAGENT_UNKNOWN_ACTION_CODE
            );
          }
        });
      }
    }
  }
}

export function runTargetPass(): LintPass {
  return new RunTargetPass();
}
