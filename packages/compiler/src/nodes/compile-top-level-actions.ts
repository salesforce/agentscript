/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { NamedMap } from '@agentscript/language';
import type { CompilerContext } from '../compiler-context.js';
import type { ActionDefinition, Tool } from '../types.js';
import { compileActionDefinitions } from './compile-actions.js';
import { setDefaultLlmInputs } from './compile-tool.js';
import { extractStringValue, iterateNamedMap } from '../ast-helpers.js';
import { normalizeDeveloperName } from '../utils.js';

/**
 * Result of compiling top-level actions — action definitions + tool references
 * to be injected into every subagent node.
 */
export interface TopLevelActions {
  actionDefinitions: ActionDefinition[];
  tools: Tool[];
}

/**
 * Compile the top-level `actions` block into action definitions and
 * corresponding tool references. These are injected into every subagent node so
 * that global actions are available everywhere.
 *
 * IMPORTANT: `compileActionDefinitions` calls `ctx.actionInputSignatures.clear()`
 * at its start (Risk R5), so it must be called ONCE before the node loop. The
 * caller handles ordering; this function just calls it.
 */
export function compileTopLevelActions(
  actions: NamedMap<Record<string, unknown>> | undefined,
  ctx: CompilerContext
): TopLevelActions {
  if (!actions) {
    return { actionDefinitions: [], tools: [] };
  }

  // Compile action definitions (includes clearing + repopulating
  // ctx.actionInputSignatures for these actions).
  const actionDefinitions = compileActionDefinitions(actions, ctx);

  // Snapshot the just-populated signatures into the persistent top-level map.
  // Per-node `compileActionDefinitions` clears `actionInputSignatures`, so a
  // node whose reasoning references an inherited `@actions.X` action relies on
  // this preserved copy to seed its required `llm_inputs` (see
  // `setDefaultLlmInputs`).
  ctx.topLevelActionSignatures.clear();
  for (const [name, sig] of ctx.actionInputSignatures) {
    ctx.topLevelActionSignatures.set(name, sig);
  }

  // Generate tool references for each action. We read the action input
  // signatures that `compileActionDefinitions` just populated to seed
  // `llm_inputs` with each action's required, unbound inputs — mirroring the
  // ordinary reasoning-tool path (`setDefaultLlmInputs` in compile-tool.ts).
  // This must happen HERE, before the node loop's per-node
  // `compileActionDefinitions` calls clear the signatures again.
  const tools: Tool[] = [];
  for (const [name, block] of iterateNamedMap(actions)) {
    const description =
      extractStringValue(block.description) ?? normalizeDeveloperName(name);
    const boundInputs: Record<string, string> = {};
    const llmInputs: string[] = [];
    setDefaultLlmInputs(name, boundInputs, llmInputs, ctx);
    const tool: Tool = {
      type: 'action',
      target: name,
      name,
      description,
      bound_inputs: boundInputs,
      llm_inputs: llmInputs,
      state_updates: [],
    } as Tool;
    tools.push(tool);
  }

  return { actionDefinitions, tools };
}

/**
 * Merge top-level actions into a subagent node. Prepends the top-level action
 * definitions and tools to the node's existing arrays (top-level first, then
 * the node's own). Mutates the node in place.
 *
 * Deduplicates by target: if the node already defines an action / tool for the
 * same target (e.g. its `reasoning.actions` references an inherited
 * `@actions.X`), the node's own, more-specific entry wins and the inherited one
 * is skipped. This avoids emitting two tools for the same action target.
 *
 * Only mutates when there is something to prepend.
 */
export function mergeTopLevelActionsIntoSubagent(
  node: {
    action_definitions?: unknown[] | null;
    tools?: unknown[] | null;
  },
  topLevel: TopLevelActions
): void {
  if (topLevel.actionDefinitions.length > 0) {
    const existing = node.action_definitions ?? [];
    const existingNames = new Set(
      existing
        .map(d => (d as { developer_name?: string }).developer_name)
        .filter((n): n is string => typeof n === 'string')
    );
    const inherited = topLevel.actionDefinitions.filter(
      d => !existingNames.has(d.developer_name)
    );
    if (inherited.length > 0) {
      node.action_definitions = [...inherited, ...existing];
    }
  }
  if (topLevel.tools.length > 0) {
    const existing = node.tools ?? [];
    const existingTargets = new Set(
      existing
        .map(t => t as { type?: string; target?: string })
        .filter(t => t.type === 'action' && typeof t.target === 'string')
        .map(t => t.target as string)
    );
    const inherited = topLevel.tools.filter(
      t => !existingTargets.has(t.target)
    );
    if (inherited.length > 0) {
      node.tools = [...inherited, ...existing];
    }
  }
}
