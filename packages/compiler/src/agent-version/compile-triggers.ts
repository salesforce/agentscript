/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { CompilerContext } from '../compiler-context.js';
import type { Trigger } from '../types.js';
import type { NamedMap, Expression } from '@agentscript/language';
import { decomposeAtMemberChain } from '@agentscript/language';
import {
  extractStringValue,
  iterateNamedMap,
  getCstRange,
} from '../ast-helpers.js';

/**
 * Compile trigger declarations to AgentJSON Trigger objects.
 *
 * Each trigger entry maps a schedule and target reference to a scheduled invocation.
 * Supported target shapes:
 * - `@workflows.X` → workflow target
 * - `@bundles.P.workflows.W` → bundle workflow target
 * - `@subagent.X` or `@connected_subagent.X` → agent target
 */
export function compileTriggers(
  triggers: NamedMap<Record<string, unknown>> | undefined,
  ctx: CompilerContext
): Trigger[] {
  if (!triggers) return [];

  const result: Trigger[] = [];

  for (const [id, block] of iterateNamedMap(triggers)) {
    const schedule = extractStringValue(block.schedule);

    if (!schedule || schedule.trim() === '') {
      ctx.error(
        `Trigger '${id}' requires a schedule`,
        getCstRange(block.schedule)
      );
      continue;
    }

    const classified = classifyTriggerTarget(
      block.target as Expression,
      ctx,
      id
    );

    if (classified === undefined) {
      continue;
    }

    result.push({
      id,
      schedule,
      invocation_target_type: classified.targetType,
      invocation_target_name: classified.target,
    });
  }

  return result;
}

/**
 * Classify a trigger target expression into a target type and target string.
 *
 * Handles:
 * - `@workflows.X` → { targetType: 'workflow', target: 'X' }
 * - `@bundles.P.workflows.W` → { targetType: 'workflow', target: 'bundles.P.workflows.W' }
 * - `@subagent.X` or `@connected_subagent.X` → { targetType: 'agent', target: 'X' }
 */
function classifyTriggerTarget(
  expr: Expression,
  ctx: CompilerContext,
  triggerId: string
): { targetType: 'workflow' | 'agent'; target: string } | undefined {
  const decomposed = decomposeAtMemberChain(expr);

  if (decomposed === null) {
    ctx.error(
      `Trigger '${triggerId}' has an unresolvable target`,
      getCstRange(expr)
    );
    return undefined;
  }

  const { namespace, path } = decomposed;

  // @workflows.X → workflow
  if (namespace === 'workflows' && path.length === 1) {
    return {
      targetType: 'workflow',
      target: path[0],
    };
  }

  // @bundles.P.workflows.W → bundle workflow (full dotted path)
  if (namespace === 'bundles' && path.length === 3 && path[1] === 'workflows') {
    return {
      targetType: 'workflow',
      target: `${namespace}.${path.join('.')}`,
    };
  }

  // @subagent.X or @connected_subagent.X → agent
  if (
    (namespace === 'subagent' || namespace === 'connected_subagent') &&
    path.length === 1
  ) {
    return {
      targetType: 'agent',
      target: path[0],
    };
  }

  // Unsupported shape
  ctx.error(
    `Trigger '${triggerId}' has an unsupported target shape`,
    getCstRange(expr)
  );
  return undefined;
}
