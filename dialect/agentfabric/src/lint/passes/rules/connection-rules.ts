import { isNamedMap } from '@agentscript/language';
import { attachError, extractStringValue, type AstLike } from './shared.js';

export function checkConnectionUriRules(root: Record<string, unknown>): void {
  const llmEntries = root.llm;
  if (isNamedMap(llmEntries)) {
    for (const [, entry] of llmEntries) {
      if (entry == null || typeof entry !== 'object') continue;
      const target = extractStringValue(
        (entry as Record<string, unknown>).target
      );
      if (target && !target.startsWith('llm://')) {
        attachError(
          entry as AstLike,
          "llm.target must use the 'llm://' URI scheme.",
          'connection-uri'
        );
      }
    }
  }

  const actionDefs = root.actions;
  if (isNamedMap(actionDefs)) {
    for (const [, entry] of actionDefs) {
      if (entry == null || typeof entry !== 'object') continue;
      const kind = extractStringValue((entry as Record<string, unknown>).kind);
      const target = extractStringValue(
        (entry as Record<string, unknown>).target
      );
      const expectedScheme =
        kind === 'mcp:tool'
          ? 'mcp://'
          : kind === 'a2a:send_message'
            ? 'a2a://'
            : undefined;
      if (target && expectedScheme && !target.startsWith(expectedScheme)) {
        attachError(
          entry as AstLike,
          `actions.target must use the '${expectedScheme}' URI scheme for kind '${kind}'.`,
          'connection-uri'
        );
      }
    }
  }
}
