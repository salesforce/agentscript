/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { Expression } from '@agentscript/language';
import { decomposeAtMemberExpression } from '@agentscript/language';
import type { CompilerContext } from '../compiler-context.js';

/**
 * Check if a transition target expression points to a connected agent
 * and emit a compiler warning if so.
 * Returns true if the target is a connected agent (caller should skip).
 */
export function warnIfConnectedAgentTransition(
  targetExpr: Expression,
  ctx: CompilerContext
): boolean {
  const decomposed = decomposeAtMemberExpression(targetExpr);
  if (decomposed && decomposed.namespace === 'connected_subagent') {
    ctx.warning(
      `Transition to connected agent "${decomposed.property}" is not supported. Use @connected_subagent.${decomposed.property} as a tool invocation instead.`,
      targetExpr.__cst?.range
    );
    return true;
  }
  return false;
}
