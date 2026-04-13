/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Reasoning action analyzer — resolves all reasoning action references and
 * their action signatures for downstream validation passes.
 *
 * Currently handles @actions.X and @connected_subagent.X references explicitly.
 * TODO: Generalize to resolve any invocable namespace (based on schema
 * capabilities) instead of special-casing each namespace here.
 *
 * Store key: 'reasoning-actions'
 */

import type { AstNodeLike, AstRoot, NamedMap } from '@agentscript/language';
import {
  storeKey,
  schemaContextKey,
  resolveNamespaceKeys,
  resolveColinearAction,
  decomposeAtMemberExpression,
  isNamedMap,
  attachDiagnostic,
  lintDiagnostic,
} from '@agentscript/language';
import type { LintPass, PassStore } from '@agentscript/language';
import type { CstMeta, Range } from '@agentscript/types';
import { DiagnosticSeverity } from '@agentscript/types';
import { typeMapKey } from './type-map.js';
import type { ActionSignature, ConnectedAgentInfo } from './type-map.js';

export interface ReasoningActionEntry {
  topicName: string;
  /** Referenced action name (from @actions.X). */
  refActionName: string;
  sig: ActionSignature;
  /** The ReasoningActionBlock AST node. */
  ra: Record<string, unknown>;
  statements: Array<Record<string, unknown>> | undefined;
  /** Range of the @actions.X expression (for missing-input diagnostics). */
  actionRefRange: Range | undefined;
}

interface RawReasoningAction {
  topicName: string;
  refActionName: string;
  /** Which namespace the reference targets ('actions' or 'connected_subagent'). */
  namespace: 'actions' | 'connected_subagent';
  ra: Record<string, unknown>;
  statements: Array<Record<string, unknown>> | undefined;
  actionRefRange: Range | undefined;
}

export const reasoningActionsKey =
  storeKey<ReasoningActionEntry[]>('reasoning-actions');

class ReasoningActionsAnalyzer implements LintPass {
  readonly id = reasoningActionsKey;
  readonly description =
    'Pre-resolves reasoning action references and their action signatures';
  readonly finalizeAfter = [typeMapKey];

  finalize(store: PassStore, root: AstRoot): void {
    const typeMap = store.get(typeMapKey);
    if (!typeMap) return;

    const ctx = store.get(schemaContextKey);
    if (!ctx) return;

    const raw: RawReasoningAction[] = [];
    const rootObj = root as AstNodeLike;

    // Support both 'subagent' (base dialect) and 'topic' (agentforce dialect)
    const subagentKeys = new Set([
      ...resolveNamespaceKeys('subagent', ctx),
      ...resolveNamespaceKeys('topic', ctx),
    ]);
    for (const topicKey of subagentKeys) {
      const topicMap = rootObj[topicKey];
      if (!topicMap || !isNamedMap(topicMap)) continue;

      for (const [topicName, block] of topicMap as NamedMap<unknown>) {
        if (!block || typeof block !== 'object') continue;
        const topic = block as AstNodeLike;

        const reasoning = topic.reasoning;
        if (!reasoning || typeof reasoning !== 'object') continue;

        const reasoningObj = reasoning as Record<string, unknown>;
        const raActions = reasoningObj.actions;
        if (!raActions || !isNamedMap(raActions)) continue;

        for (const [, raBlock] of raActions as NamedMap<unknown>) {
          if (!raBlock || typeof raBlock !== 'object') continue;
          const ra = raBlock as Record<string, unknown>;
          if (ra.__kind !== 'ReasoningActionBlock') continue;

          // Check if the reasoning action has any colinear value at all.
          // A missing value means the author wrote something like:
          //   actions Find_Products:
          // without a target like @actions.X, @utils.transition, etc.
          if (!ra.value) {
            const raCst = ra.__cst as CstMeta | undefined;
            if (raCst) {
              attachDiagnostic(
                ra,
                lintDiagnostic(
                  raCst.range,
                  `Reasoning action is missing a target reference (e.g., @actions.Name, @utils.transition, @utils.setVariables)`,
                  DiagnosticSeverity.Error,
                  'missing-action-reference'
                )
              );
            }
            continue;
          }

          const statements = ra.statements as
            | Array<Record<string, unknown>>
            | undefined;

          const valueCst = (ra.value as Record<string, unknown> | undefined)
            ?.__cst as CstMeta | undefined;
          const actionRefRange =
            valueCst?.range ?? (ra.__cst as CstMeta | undefined)?.range;

          // Try @actions.X first
          const refActionName = resolveColinearAction(ra);
          if (refActionName) {
            raw.push({
              topicName,
              refActionName,
              namespace: 'actions',
              ra,
              statements,
              actionRefRange,
            });
            continue;
          }

          // Try @connected_subagent.X
          const decomposed = decomposeAtMemberExpression(ra.value);
          if (decomposed && decomposed.namespace === 'connected_subagent') {
            raw.push({
              topicName,
              refActionName: decomposed.property,
              namespace: 'connected_subagent',
              ra,
              statements,
              actionRefRange,
            });
          }
        }
      }
    }

    const entries: ReasoningActionEntry[] = [];
    for (const r of raw) {
      let sig: ActionSignature | undefined;

      if (r.namespace === 'actions') {
        sig = typeMap.actions.get(r.topicName)?.get(r.refActionName);
      } else if (r.namespace === 'connected_subagent') {
        const agentInfo = typeMap.connectedAgents.get(r.refActionName);
        if (agentInfo) {
          sig = connectedAgentSignature(agentInfo);
        }
      }

      if (!sig) continue;

      entries.push({
        topicName: r.topicName,
        refActionName: r.refActionName,
        sig,
        ra: r.ra,
        statements: r.statements,
        actionRefRange: r.actionRefRange,
      });
    }

    store.set(reasoningActionsKey, entries);
  }
}

export function reasoningActionsAnalyzer(): LintPass {
  return new ReasoningActionsAnalyzer();
}

/**
 * Build an ActionSignature from a connected agent's input declarations.
 * Definition-time defaults (e.g. `order_id: string = @variables.Order_Id`)
 * are treated as bound defaults — inputs with defaults are optional at invocation.
 *
 * TODO: When connected agents support outputs, include them here.
 */
function connectedAgentSignature(info: ConnectedAgentInfo): ActionSignature {
  const inputs = new Map<string, { type: string; hasDefault: boolean }>();
  for (const [name, inputInfo] of info.inputs) {
    inputs.set(name, {
      type: inputInfo.type,
      hasDefault: inputInfo.hasDefault,
    });
  }
  return { inputs, outputs: new Map() };
}
