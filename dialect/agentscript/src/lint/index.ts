import { LintEngine } from '@agentscript/language';
import { defaultRules } from './passes/index.js';

export { defaultRules } from './passes/index.js';

const AGENTSCRIPT_LINT_SOURCE = 'agentscript-lint';

/** Create a LintEngine pre-loaded with all default AgentScript rules. */
export function createLintEngine(): LintEngine {
  return new LintEngine({
    passes: defaultRules(),
    source: AGENTSCRIPT_LINT_SOURCE,
  });
}
