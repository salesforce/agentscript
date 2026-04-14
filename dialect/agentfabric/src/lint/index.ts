import { LintEngine } from '@agentscript/language';
import { defaultRules } from './passes/index.js';

export { defaultRules } from './passes/index.js';

const AGENTFABRIC_LINT_SOURCE = 'agentfabric-lint';

/** Create a LintEngine pre-loaded with all default AgentFabric rules. */
export function createLintEngine(): LintEngine {
  return new LintEngine({
    passes: defaultRules(),
    source: AGENTFABRIC_LINT_SOURCE,
  });
}
