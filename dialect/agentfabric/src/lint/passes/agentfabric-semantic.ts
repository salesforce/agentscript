import { storeKey } from '@agentscript/language';
import type { LintPass, PassStore } from '@agentscript/language';
import { checkAgenticLlmRules } from './rules/agentic-llm-rules.js';
import { checkConnectionUriRules } from './rules/connection-rules.js';
import { checkEchoRules } from './rules/echo-rules.js';
import { checkOnExitRules } from './rules/on-exit-rules.js';
import { checkOutputStructureRules } from './rules/output-structure-rules.js';
import { checkReasoningInstructionsRules } from './rules/reasoning-instructions-rules.js';
import { checkSwitchRules } from './rules/switch-rules.js';
import { checkTriggerRules } from './rules/trigger-rules.js';

class AgentFabricSemanticPass implements LintPass {
  readonly id = storeKey('agentfabric-semantic');
  readonly description = 'AgentFabric-specific semantic lint validations';

  finalize(store: PassStore, root: Record<string, unknown>): void {
    checkTriggerRules(root);
    checkConnectionUriRules(root);
    checkOutputStructureRules(root);
    checkReasoningInstructionsRules(root);
    checkOnExitRules(root);
    checkSwitchRules(store, root);
    checkEchoRules(root);
    checkAgenticLlmRules(root);
  }
}

export function agentFabricSemanticPass(): LintPass {
  return new AgentFabricSemanticPass();
}
