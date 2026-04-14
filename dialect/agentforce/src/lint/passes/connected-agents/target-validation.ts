/**
 * Connected agent target validation.
 *
 * Enforces validation rules for `connected_subagent` target URIs:
 * 1. Scheme must be `agentforce://` (platform restriction)
 * 2. Target name must follow naming rules:
 *    - Start with a letter (a-z, A-Z)
 *    - Contain only alphanumeric characters and underscores
 *    - Cannot end with an underscore
 *    - Cannot contain consecutive underscores
 *
 * Diagnostics:
 * - connected-agent-unsupported-scheme
 * - invalid-connected-subagent-target-name
 */

import type { LintPass, PassStore } from '@agentscript/language';
import {
  storeKey,
  attachDiagnostic,
  lintDiagnostic,
} from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import { typeMapKey } from '@agentscript/agentscript-dialect';

const ALLOWED_SCHEMES = ['agentforce'];

// Validation pattern for target names
function validateTargetName(targetName: string): string | null {
  if (!/^[a-zA-Z]/.test(targetName)) {
    return `Target name '${targetName}' must start with a letter (a-z, A-Z).`;
  }

  if (!/^[a-zA-Z0-9_]+$/.test(targetName)) {
    return `Target name '${targetName}' can only contain letters, numbers, and underscores.`;
  }

  if (targetName.endsWith('_')) {
    return `Target name '${targetName}' cannot end with an underscore.`;
  }

  if (targetName.includes('__')) {
    return `Target name '${targetName}' cannot contain consecutive underscores.`;
  }

  return null;
}

function extractTargetName(targetUri: string): string | null {
  const match = targetUri.match(/^[a-zA-Z][a-zA-Z0-9_]*:\/\/(.+)$/);
  return match ? match[1] : null;
}

export const connectedAgentTargetKey = storeKey<void>('connected-agent-target');

class ConnectedAgentTargetPass implements LintPass {
  readonly id = connectedAgentTargetKey;
  readonly description =
    'Validates connected agent target URIs (scheme and name)';
  readonly requires = [typeMapKey];

  run(store: PassStore): void {
    const typeMap = store.get(typeMapKey);
    if (!typeMap) return;

    for (const [, agentInfo] of typeMap.connectedAgents) {
      const { target, targetNode } = agentInfo;
      if (!target || !targetNode) continue;

      const range = targetNode.__cst?.range ?? {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      };

      const schemeMatch = target.match(/^([a-zA-Z][a-zA-Z0-9_]*):\/\//);
      if (!schemeMatch) continue;

      const scheme = schemeMatch[1];
      if (!ALLOWED_SCHEMES.includes(scheme)) {
        const allowed = ALLOWED_SCHEMES.map(s => `${s}://`).join(', ');
        attachDiagnostic(
          targetNode,
          lintDiagnostic(
            range,
            `Unsupported connected agent target scheme '${scheme}://'. Only ${allowed} is currently supported.`,
            DiagnosticSeverity.Error,
            'connected-agent-unsupported-scheme'
          )
        );
        continue;
      }

      const targetName = extractTargetName(target);
      if (!targetName) continue;
      const nameError = validateTargetName(targetName);
      if (nameError) {
        attachDiagnostic(
          targetNode,
          lintDiagnostic(
            range,
            nameError,
            DiagnosticSeverity.Error,
            'invalid-connected-subagent-target-name'
          )
        );
      }
    }
  }
}

export function connectedAgentTargetPass(): LintPass {
  return new ConnectedAgentTargetPass();
}
