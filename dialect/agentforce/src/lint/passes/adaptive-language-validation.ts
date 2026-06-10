/**
 * Lint pass that validates `language.adaptive: True` configurations.
 *
 * When adaptive language selection is enabled, the agent infers the locale
 * from the user. Two consequences:
 *
 *   1. Sibling fields on the language block — `default_locale`,
 *      `additional_locales`, `all_additional_locales` — become no-ops.
 *      Diagnostic: adaptive-language-overrides (one per ignored field).
 *
 *   2. The voice modality requires a deterministic locale + voice config
 *      up-front, so it cannot coexist with adaptive selection.
 *      Diagnostic: voice-adaptive-conflict.
 *
 * NOTE: Remove the voice branch when the Voice team adopts adaptive language.
 */

import type { AstNodeLike, AstRoot } from '@agentscript/language';
import type { LintPass, PassStore } from '@agentscript/language';
import {
  storeKey,
  attachDiagnostic,
  lintDiagnostic,
  isNamedMap,
} from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import { getBlockRange } from '../utils.js';

function extractBooleanValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value == null || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (
    (record.__kind === 'BooleanValue' || record.__kind === 'BooleanLiteral') &&
    typeof record.value === 'boolean'
  ) {
    return record.value;
  }
  return undefined;
}

const OVERRIDDEN_FIELDS = [
  'default_locale',
  'additional_locales',
  'all_additional_locales',
] as const;

class AdaptiveLanguageValidationPass implements LintPass {
  readonly id = storeKey('adaptive-language-validation');
  readonly description =
    'Validates configurations that conflict with language.adaptive=True';

  run(_store: PassStore, root: AstRoot): void {
    const language = (root as Record<string, unknown>).language as
      | AstNodeLike
      | undefined;
    if (!language || typeof language !== 'object') return;

    const lang = language as Record<string, unknown>;
    const adaptive = extractBooleanValue(lang.adaptive);
    if (adaptive !== true) return;

    // 1. Sibling fields on the language block are ignored when adaptive=True.
    for (const field of OVERRIDDEN_FIELDS) {
      const fieldNode = lang[field];
      if (fieldNode === undefined || fieldNode === null) continue;
      attachDiagnostic(
        language,
        lintDiagnostic(
          getBlockRange(fieldNode),
          `Field '${field}' will be ignored because language.adaptive is True.`,
          DiagnosticSeverity.Warning,
          'adaptive-language-overrides'
        )
      );
    }

    // 2. Voice modality cannot coexist with adaptive language.
    const modality = (root as Record<string, unknown>).modality;
    if (modality && isNamedMap(modality) && modality.has('voice')) {
      attachDiagnostic(
        language,
        lintDiagnostic(
          getBlockRange(lang.adaptive),
          'Adaptive mode cannot be used over voice modality. The adaptive language setting will be ignored if this agent is attached to a voice channel.',
          DiagnosticSeverity.Warning,
          'voice-adaptive-conflict'
        )
      );
    }
  }
}

export function adaptiveLanguageValidationRule(): LintPass {
  return new AdaptiveLanguageValidationPass();
}
