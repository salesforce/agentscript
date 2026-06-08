import { isNamedMap } from '@agentscript/language';
import {
  attachError,
  collectStatementKinds,
  extractStringValue,
  hasSingleFixedTransition,
  type AstLike,
} from './shared.js';

export function checkTriggerRules(root: Record<string, unknown>): void {
  const triggers = root.trigger;
  if (!isNamedMap(triggers)) return;

  const byKind = new Map<string, AstLike[]>();
  for (const [, entry] of triggers) {
    if (entry == null || typeof entry !== 'object') continue;
    const kind = extractStringValue((entry as Record<string, unknown>).kind);
    if (!kind) continue;
    const key = kind.toLowerCase();
    const list = byKind.get(key);
    if (list) list.push(entry as AstLike);
    else byKind.set(key, [entry as AstLike]);
  }

  for (const [kindKey, entries] of byKind) {
    if (entries.length <= 1) continue;
    for (const node of entries) {
      attachError(
        node,
        `Only one trigger is allowed per kind; multiple triggers use kind '${kindKey}'.`,
        'trigger-duplicate-kind'
      );
    }
  }

  for (const [, entry] of triggers) {
    if (entry == null || typeof entry !== 'object') continue;
    const trigger = entry as Record<string, unknown>;
    const onMessage = trigger.on_message;
    const kinds = collectStatementKinds(onMessage);
    if (
      kinds.includes('IfStatement') ||
      kinds.includes('RunStatement') ||
      !hasSingleFixedTransition(onMessage)
    ) {
      attachError(
        trigger as AstLike,
        "trigger.on_message must contain exactly one unconditional 'transition to ...' statement.",
        'trigger-on-message-transition'
      );
    }
  }
}
