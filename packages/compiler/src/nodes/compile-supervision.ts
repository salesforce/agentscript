/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { Statement, Expression } from '@agentscript/language';
import {
  ToClause,
  TransitionStatement,
  AvailableWhen,
} from '@agentscript/language';
import type { CompilerContext } from '../compiler-context.js';
import type { SupervisionTool } from '../types.js';
import type { ParsedTool } from '../parsed-types.js';
import {
  extractSourcedString,
  extractSourcedDescription,
  resolveAtReference,
} from '../ast-helpers.js';
import type { Sourceable } from '../sourced.js';
import { TRANSITION_TARGET_NAMESPACES } from '../constants.js';
import { compileExpression } from '../expressions/compile-expression.js';
import { warnIfConnectedAgentTransition } from './compile-utils.js';

/**
 * Compile a @utils.supervise reasoning action.
 *
 * Supervision creates a tool with type: supervision that directly targets
 * a topic node, without a corresponding handoff action.
 */
export function compileSupervision(
  name: string,
  actionDef: ParsedTool,
  body: Statement[],
  topicDescriptions: Record<string, string>,
  ctx: CompilerContext
): { tool: SupervisionTool } {
  // Parse supervision target from body
  let targetName: string | undefined;
  let enabledCondition: string | undefined;

  for (const stmt of body) {
    if (stmt instanceof ToClause) {
      if (warnIfConnectedAgentTransition(stmt.target, ctx)) continue;
      const resolved = resolveAtReference(
        stmt.target,
        TRANSITION_TARGET_NAMESPACES,
        ctx,
        'transition target'
      );
      if (resolved) targetName = resolved;
    } else if (stmt instanceof TransitionStatement) {
      for (const clause of stmt.clauses) {
        if (clause instanceof ToClause) {
          if (warnIfConnectedAgentTransition(clause.target, ctx)) continue;
          const resolved = resolveAtReference(
            clause.target,
            TRANSITION_TARGET_NAMESPACES,
            ctx,
            'transition target'
          );
          if (resolved) targetName = resolved;
        }
      }
    } else if (stmt instanceof AvailableWhen) {
      enabledCondition = compileExpression(stmt.condition, ctx);
    }
  }

  // If no target parsed from body, check inline target
  if (!targetName) {
    const colinear = actionDef.value;
    if (colinear) {
      if (!warnIfConnectedAgentTransition(colinear as Expression, ctx)) {
        const resolved = resolveAtReference(
          colinear as Expression,
          TRANSITION_TARGET_NAMESPACES,
          ctx,
          'transition target'
        );
        if (resolved) targetName = resolved;
      }
    }
  }

  const resolvedTarget = targetName ?? name;
  const alias = extractSourcedString(actionDef.label);
  const description =
    extractSourcedDescription(actionDef.description) ??
    topicDescriptions[resolvedTarget] ??
    '';

  const tool: Sourceable<SupervisionTool> = {
    type: 'supervision',
    target: resolvedTarget,
    name: alias ?? name,
    description,
  };

  if (enabledCondition) {
    tool.enabled = enabledCondition;
  }

  return { tool: tool as SupervisionTool };
}
