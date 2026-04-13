/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { Statement } from '@agentscript/language';
import { AvailableWhen } from '@agentscript/language';
import type { CompilerContext } from '../compiler-context.js';
import type { Tool, HandOffAction } from '../types.js';
import type { ParsedTool } from '../parsed-types.js';
import {
  STATE_UPDATE_ACTION,
  NEXT_TOPIC_VARIABLE,
  EMPTY_TOPIC_VALUE,
  EMPTY_ESCALATION_NODE_VALUE,
  ESCALATION_TARGET,
} from '../constants.js';
import {
  extractSourcedString,
  extractSourcedDescription,
} from '../ast-helpers.js';
import type { Sourceable } from '../sourced.js';
import { compileExpression } from '../expressions/compile-expression.js';

/**
 * Compile a @utils.escalate reasoning action.
 *
 * Creates a state-update tool + handoff that transfers to a human agent.
 * The LLM selects the tool to trigger escalation.
 *
 * When `available when` is present, the tool gets an `enabled` condition
 * so the LLM can only select it when the condition is met — same as how
 * regular tools handle `available when`.
 */
export function compileEscalate(
  name: string,
  actionDef: ParsedTool,
  body: Statement[],
  ctx: CompilerContext
): { tool: Tool; handOffAction: HandOffAction } {
  const alias = extractSourcedString(actionDef.label);
  const description =
    extractSourcedDescription(actionDef.description) ??
    'Escalate to human agent';

  // Check for available when condition
  let enabledCondition: string | undefined;
  for (const stmt of body) {
    if (stmt instanceof AvailableWhen) {
      enabledCondition = compileExpression(stmt.condition, ctx, {
        expressionContext: "'available when' clause",
      });
    }
  }

  const tool: Sourceable<Tool> = {
    type: 'action',
    target: STATE_UPDATE_ACTION,
    state_updates: [{ [NEXT_TOPIC_VARIABLE]: EMPTY_ESCALATION_NODE_VALUE }],
    name: alias ?? name,
    description,
  };

  if (enabledCondition) {
    tool.enabled = enabledCondition;
  }

  const handoff: HandOffAction = {
    type: 'handoff',
    target: ESCALATION_TARGET,
    enabled: `state.${NEXT_TOPIC_VARIABLE} == ${EMPTY_ESCALATION_NODE_VALUE}`,
    state_updates: [{ [NEXT_TOPIC_VARIABLE]: EMPTY_TOPIC_VALUE }],
  };

  return { tool: tool as Tool, handOffAction: handoff };
}
