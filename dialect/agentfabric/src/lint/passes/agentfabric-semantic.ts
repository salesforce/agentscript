/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { storeKey } from '@agentscript/language';
import type {
  LintPass,
  PassStore,
  AstNodeLike,
  ScopeContext,
} from '@agentscript/language';
import { checkActionBindingRules } from './rules/action-binding-rules.js';
import { checkAgenticLlmRules } from './rules/agentic-llm-rules.js';
import { checkConnectionUriRules } from './rules/connection-rules.js';
import { checkCycleRules } from './rules/cycle-rules.js';
import { checkEchoRules } from './rules/echo-rules.js';
import { checkExecuteRules } from './rules/execute-rules.js';
import { checkOnExitRules } from './rules/on-exit-rules.js';
import { checkOutputStructureRules } from './rules/output-structure-rules.js';
import { checkReasoningInstructionsRules } from './rules/reasoning-instructions-rules.js';
import { checkSwitchRules } from './rules/switch-rules.js';
import { checkTerminalStatusRules } from './rules/terminal-status-rules.js';
import { checkInterpolationInCallArgRules } from './rules/interpolation-rules.js';
import { checkTriggerRules } from './rules/trigger-rules.js';
import { checkVersionRules } from './rules/version-rules.js';

class AgentFabricSemanticPass implements LintPass {
  readonly id = storeKey('agentfabric-semantic');
  readonly description = 'AgentFabric-specific semantic lint validations';

  visitExpression(expr: AstNodeLike, _ctx: ScopeContext): void {
    checkInterpolationInCallArgRules(expr);
  }

  finalize(store: PassStore, root: Record<string, unknown>): void {
    checkVersionRules(root);
    checkTriggerRules(root);
    checkConnectionUriRules(root);
    checkOutputStructureRules(root);
    checkReasoningInstructionsRules(root);
    checkOnExitRules(root);
    checkSwitchRules(store, root);
    checkEchoRules(root);
    checkAgenticLlmRules(root);
    checkExecuteRules(root);
    checkActionBindingRules(root);
    checkCycleRules(root);
    checkTerminalStatusRules(root);
  }
}

export function agentFabricSemanticPass(): LintPass {
  return new AgentFabricSemanticPass();
}
