import { LintEngine } from '@agentscript/language';
import { defaultRules } from './passes/index.js';
import { AGENTFABRIC_LINT_SOURCE } from './passes/rules/shared.js';

export { defaultRules } from './passes/index.js';

/** Create a LintEngine pre-loaded with all default AgentFabric rules. */
export function createLintEngine(): LintEngine {
  return new LintEngine({
    passes: defaultRules(),
    source: AGENTFABRIC_LINT_SOURCE,
  });
}
