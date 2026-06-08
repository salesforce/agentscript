/**
 * Validates that system message templates only reference linked (context) variables.
 *
 * Mutable variables are not available at runtime in system messages — only linked
 * variables are projected into the $Context namespace.
 *
 * Diagnostics: system-message-mutable-variable
 */

import type { AstRoot, AstNodeLike } from '@agentscript/language';
import type { LintPass, PassStore } from '@agentscript/language';
import {
  storeKey,
  decomposeAtMemberExpression,
  attachDiagnostic,
  lintDiagnostic,
} from '@agentscript/language';
import type { CstMeta } from '@agentscript/types';
import { DiagnosticSeverity } from '@agentscript/types';
import { typeMapKey } from '@agentscript/agentscript-dialect';
import type { TypeMap } from '@agentscript/agentscript-dialect';

function extractVariableRefs(
  messageValue: unknown
): Array<{ name: string; node: AstNodeLike }> {
  const refs: Array<{ name: string; node: AstNodeLike }> = [];
  if (!messageValue || typeof messageValue !== 'object') return refs;

  const obj = messageValue as Record<string, unknown>;
  if (obj.__kind !== 'TemplateExpression' || !Array.isArray(obj.parts)) {
    return refs;
  }

  for (const part of obj.parts) {
    if (!part || typeof part !== 'object') continue;
    const p = part as Record<string, unknown>;
    if (p.__kind !== 'TemplateInterpolation') continue;

    const decomposed = decomposeAtMemberExpression(p.expression);
    if (decomposed?.namespace === 'variables') {
      refs.push({
        name: decomposed.property,
        node: p.expression as AstNodeLike,
      });
    }
  }

  return refs;
}

function checkMessage(
  messageValue: unknown,
  messageType: string,
  typeMap: TypeMap
): void {
  for (const { name, node } of extractVariableRefs(messageValue)) {
    const info = typeMap.variables.get(name);
    if (info && info.modifier !== 'linked') {
      const cst = (node as Record<string, unknown>).__cst as
        | CstMeta
        | undefined;
      if (!cst) continue;

      attachDiagnostic(
        node,
        lintDiagnostic(
          cst.range,
          `Variable '${name}' is ${info.modifier ?? 'unmodified'} and cannot be used in ${messageType} messages. Only linked variables are available as context variables at runtime.`,
          DiagnosticSeverity.Error,
          'system-message-mutable-variable'
        )
      );
    }
  }
}

class SystemMessageVariablesPass implements LintPass {
  readonly id = storeKey('system-message-variables');
  readonly description =
    'Validates that system message templates only reference linked variables';
  readonly requires = [typeMapKey];

  run(store: PassStore, root: AstRoot): void {
    const typeMap = store.get(typeMapKey);
    if (!typeMap) return;

    const system = (root as Record<string, unknown>).system as
      | AstNodeLike
      | undefined;
    if (!system) return;

    const messages = system.messages as AstNodeLike | undefined;
    if (!messages) return;

    checkMessage(messages.welcome, 'welcome', typeMap);
    checkMessage(messages.error, 'error', typeMap);
  }
}

export function systemMessageVariablesRule(): LintPass {
  return new SystemMessageVariablesPass();
}
