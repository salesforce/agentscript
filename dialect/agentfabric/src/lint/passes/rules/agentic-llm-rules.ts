import { isNamedMap } from '@agentscript/language';
import {
  attachError,
  configHasDefaultLlm,
  hasOwnNonNull,
  type AstLike,
} from './shared.js';

export function checkAgenticLlmRules(root: Record<string, unknown>): void {
  if (configHasDefaultLlm(root)) return;

  const groups = [root.orchestrator, root.subagent, root.generator] as const;
  for (const group of groups) {
    if (!isNamedMap(group)) continue;
    for (const [, entry] of group) {
      if (entry == null || typeof entry !== 'object') continue;
      const record = entry as Record<string, unknown>;
      if (hasOwnNonNull(record, 'llm')) continue;

      attachError(
        entry as AstLike,
        'Specify `llm` on this node or set `config.default_llm` for the agent.',
        'agentic-llm-required'
      );
    }
  }
}
