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
  PassStore,
} from '@agentscript/language';
import {
  attachDiagnostic,
  isAstNodeLike,
  isNamedMap,
  lintDiagnostic,
  schemaContextKey,
  storeKey,
} from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';

function rangeOf(node: AstNodeLike) {
  return (
    node.__cst?.range ?? {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    }
  );
}

function getStringValue(node: unknown): string | undefined {
  if (
    !isAstNodeLike(node) ||
    !node.__kind ||
    !['StringLiteral', 'TemplateExpression'].includes(node.__kind) ||
    typeof node.value !== 'string' ||
    node.value.trim().length === 0
  ) {
    return undefined;
  }
  return node.value;
}

function attachError(node: AstNodeLike, block: string): void {
  attachDiagnostic(
    node,
    lintDiagnostic(
      rangeOf(node),
      `'${block}' is only allowed for GoalBasedAgent. Set 'agent_type: "GoalBasedAgent"' in the config block.`,
      DiagnosticSeverity.Error,
      `gba-only-${block}`
    )
  );
}

const GBA_AGENT_TYPE = 'GoalBasedAgent';

const NODE_BLOCK_KEYS = ['subagent', 'start_agent'] as const;

class GbaOnlyBlocksPass implements LintPass {
  readonly id = storeKey('gba-only-blocks');
  readonly description =
    'Validates that GBA-exclusive blocks are only used when agent_type is GoalBasedAgent';
  readonly requires = [schemaContextKey];

  run(store: PassStore, root: AstRoot): void {
    // Skip for plugin dialects: they intentionally allow workflows/actions without a config block.
    const ctx = store.get(schemaContextKey);
    if (!ctx?.schemaNamespaces.has('config')) return;

    const rootFields = root as Record<string, unknown>;

    const configNode = isAstNodeLike(rootFields.config)
      ? (rootFields.config as AstNodeLike & Record<string, unknown>)
      : undefined;

    const agentType = getStringValue(configNode?.agent_type);
    const isGba =
      agentType?.trim().toLowerCase() === GBA_AGENT_TYPE.toLowerCase();

    if (isGba) {
      // orchestrator is only valid for GBA — already passed that check.
      // subagent and start_agent are forbidden inside GBA scripts.
      for (const block of ['subagent', 'start_agent'] as const) {
        const value = rootFields[block];
        if (isNamedMap(value)) {
          attachDiagnostic(
            value as unknown as AstNodeLike,
            lintDiagnostic(
              rangeOf(value as unknown as AstNodeLike),
              `'${block}' is not allowed in a GoalBasedAgent script. Use 'orchestrator' as the entry point.`,
              DiagnosticSeverity.Error,
              `gba-forbidden-${block}`
            )
          );
        }
      }
      return;
    }

    // Top-level blocks forbidden outside GBA
    for (const block of [
      'bundles',
      'workflows',
      'trigger',
      'actions',
      'orchestrator',
    ] as const) {
      const value = rootFields[block];
      if (isNamedMap(value)) {
        attachError(value as unknown as AstNodeLike, block);
      }
    }

    // Node-level bundles under subagent / start_agent
    for (const key of NODE_BLOCK_KEYS) {
      const nodes = rootFields[key];
      if (!isNamedMap(nodes)) continue;
      for (const [, rawNode] of nodes) {
        const node = rawNode as AstNodeLike & Record<string, unknown>;
        const bundles = node.bundles;
        if (
          isAstNodeLike(bundles) &&
          bundles.__kind === 'Sequence' &&
          Array.isArray((bundles as unknown as { items: unknown[] }).items) &&
          (bundles as unknown as { items: unknown[] }).items.length > 0
        ) {
          attachError(bundles, 'bundles');
        }
      }
    }

    // context.salesforce and context.data_cloud are GBA-only
    const contextNode = isAstNodeLike(rootFields.context)
      ? (rootFields.context as AstNodeLike & Record<string, unknown>)
      : undefined;
    if (contextNode) {
      for (const key of ['salesforce', 'data_cloud'] as const) {
        const value = contextNode[key];
        if (isAstNodeLike(value)) {
          attachError(value, `context-${key}`);
        }
      }
    }
  }
}

export function gbaOnlyBlocksPass(): LintPass {
  return new GbaOnlyBlocksPass();
}
