/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Hyperclassifier (router node) constraint validation.
 *
 * Hyperclassifier topics use `model://sfdc_ai__DefaultEinsteinHyperClassifier`
 * and have restricted capabilities vs regular subagent topics:
 *   - Only @utils.transition reasoning actions are allowed
 *   - before_reasoning directives are not allowed
 *   - after_reasoning directives are not allowed
 *
 * Diagnostics: hyperclassifier-non-transition, hyperclassifier-before-reasoning,
 *              hyperclassifier-after-reasoning
 */

import type { AstNodeLike, AstRoot, NamedMap } from '@agentscript/language';
import {
  storeKey,
  schemaContextKey,
  resolveNamespaceKeys,
  decomposeAtMemberExpression,
  isNamedMap,
  attachDiagnostic,
  lintDiagnostic,
  each,
  defineRule,
} from '@agentscript/language';
import type { LintPass, PassStore } from '@agentscript/language';
import type { CstMeta } from '@agentscript/types';
import { DiagnosticSeverity } from '@agentscript/types';

const HYPERCLASSIFIER_MODEL = 'model://sfdc_ai__DefaultEinsteinHyperClassifier';

export interface HyperclassifierTopic {
  topicName: string;
  block: AstNodeLike;
  model: string;
}

export const hyperclassifierTopicsKey = storeKey<HyperclassifierTopic[]>(
  'hyperclassifier-topics'
);

/** Extract the model string from a topic's model_config block. */
function getModelString(block: AstNodeLike): string | undefined {
  const modelConfig = block.model_config;
  if (!modelConfig || typeof modelConfig !== 'object') return undefined;
  const model = (modelConfig as Record<string, unknown>).model;
  if (!model) return undefined;
  if (typeof model === 'string') return model;
  if (typeof model === 'object' && 'value' in model) {
    const v = (model as { value: unknown }).value;
    if (typeof v === 'string') return v;
  }
  return undefined;
}

/** Check if a before_reasoning or after_reasoning block has statements. */
function hasStatements(value: unknown): boolean {
  if (!value) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object' && 'statements' in value) {
    const stmts = (value as { statements: unknown }).statements;
    return Array.isArray(stmts) && stmts.length > 0;
  }
  return true;
}

/**
 * Extractor pass — identifies hyperclassifier topics and stores them
 * for the validation rule to iterate.
 */
class HyperclassifierExtractor implements LintPass {
  readonly id = hyperclassifierTopicsKey;
  readonly description = 'Identifies hyperclassifier/router topics';

  finalize(store: PassStore, root: AstRoot): void {
    const ctx = store.get(schemaContextKey);
    if (!ctx) return;

    const results: HyperclassifierTopic[] = [];
    const rootObj = root as AstNodeLike;

    // Check all block types that could be hyperclassifiers: topic, subagent, start_agent
    const allKeys = new Set([
      ...resolveNamespaceKeys('topic', ctx),
      ...resolveNamespaceKeys('subagent', ctx),
    ]);

    for (const topicKey of allKeys) {
      const topicMap = rootObj[topicKey];
      if (!topicMap || !isNamedMap(topicMap)) continue;

      for (const [topicName, block] of topicMap as NamedMap<unknown>) {
        if (!block || typeof block !== 'object') continue;
        const topic = block as AstNodeLike;

        const modelStr = getModelString(topic);
        if (modelStr !== HYPERCLASSIFIER_MODEL) continue;

        results.push({ topicName, block: topic, model: modelStr });
      }
    }

    store.set(hyperclassifierTopicsKey, results);
  }
}

export function hyperclassifierExtractor(): LintPass {
  return new HyperclassifierExtractor();
}

/**
 * Validation rule — only runs on hyperclassifier topics.
 * Checks reasoning actions, before_reasoning, and after_reasoning.
 */
export function hyperclassifierConstraintsRule(): LintPass {
  return defineRule({
    id: 'hyperclassifier-constraints',
    description: 'Validates constraints on hyperclassifier/router nodes',
    deps: { topic: each(hyperclassifierTopicsKey) },

    run({ topic }) {
      const { block, model } = topic;

      // 1. Non-transition reasoning actions
      const reasoning = block.reasoning;
      if (reasoning && typeof reasoning === 'object') {
        const reasoningObj = reasoning as Record<string, unknown>;
        const raActions = reasoningObj.tools ?? reasoningObj.actions;
        if (raActions && isNamedMap(raActions)) {
          for (const [, raBlock] of raActions as NamedMap<unknown>) {
            if (!raBlock || typeof raBlock !== 'object') continue;
            const ra = raBlock as Record<string, unknown>;

            const decomposed = decomposeAtMemberExpression(ra.value);
            const isTransition =
              decomposed?.namespace === 'utils' &&
              decomposed?.property === 'transition';

            if (!isTransition) {
              const cst = ra.__cst as CstMeta | undefined;
              if (cst) {
                attachDiagnostic(
                  ra,
                  lintDiagnostic(
                    cst.range,
                    `Only @utils.transition reasoning actions are allowed when using model: ${model}`,
                    DiagnosticSeverity.Error,
                    'hyperclassifier-non-transition'
                  )
                );
              }
            }
          }
        }
      }

      // 2. before_reasoning directives
      if (hasStatements(block.before_reasoning)) {
        const br = block.before_reasoning as Record<string, unknown>;
        const cst =
          (br?.__cst as CstMeta | undefined) ??
          (block.__cst as CstMeta | undefined);
        if (cst) {
          attachDiagnostic(
            br ?? block,
            lintDiagnostic(
              cst.range,
              `before_reasoning directives are not allowed when using model: ${model}`,
              DiagnosticSeverity.Error,
              'hyperclassifier-before-reasoning'
            )
          );
        }
      }

      // 3. after_reasoning directives
      if (hasStatements(block.after_reasoning)) {
        const ar = block.after_reasoning as Record<string, unknown>;
        const cst =
          (ar?.__cst as CstMeta | undefined) ??
          (block.__cst as CstMeta | undefined);
        if (cst) {
          attachDiagnostic(
            ar ?? block,
            lintDiagnostic(
              cst.range,
              `after_reasoning directives are not allowed when using model: ${model}`,
              DiagnosticSeverity.Error,
              'hyperclassifier-after-reasoning'
            )
          );
        }
      }
    },
  });
}
