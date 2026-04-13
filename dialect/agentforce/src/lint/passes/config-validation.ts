/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Config block validation rules for Agentforce.
 *
 * Validates:
 * - developer_name / agent_name mutual exclusivity (must have exactly one)
 * - default_agent_user required for AgentforceServiceAgent
 * - default_agent_user ignored warning for AgentforceEmployeeAgent
 *
 * Diagnostics: config-missing-agent-name, config-duplicate-agent-name,
 *              config-missing-default-agent-user, config-ignored-default-agent-user
 */

import type { AstRoot, AstNodeLike } from '@agentscript/language';
import type { LintPass, PassStore } from '@agentscript/language';
import {
  storeKey,
  attachDiagnostic,
  lintDiagnostic,
} from '@agentscript/language';
import type { CstMeta } from '@agentscript/types';
import { DiagnosticSeverity } from '@agentscript/types';

/** Extract a string value from a StringLiteral AST node. */
function getStringValue(
  node: unknown
): { value: string; astNode: AstNodeLike } | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const obj = node as Record<string, unknown>;
  if (obj.__kind !== 'StringLiteral' && obj.__kind !== 'TemplateExpression')
    return undefined;
  if (typeof obj.value !== 'string' || obj.value.trim().length === 0)
    return undefined;
  return { value: obj.value, astNode: obj as AstNodeLike };
}

/** Get the CST range for a config block (the header/key). */
function getBlockRange(block: AstNodeLike) {
  const cst = block.__cst as CstMeta | undefined;
  return (
    cst?.range ?? {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    }
  );
}

class ConfigValidationPass implements LintPass {
  readonly id = storeKey('config-validation');
  readonly description =
    'Validates Agentforce config block constraints (agent name, default_agent_user)';

  run(_store: PassStore, root: AstRoot): void {
    const config = (root as Record<string, unknown>).config as
      | AstNodeLike
      | undefined;
    if (!config) return;

    const developerName = getStringValue(config.developer_name);
    const agentName = getStringValue(config.agent_name);

    // Must have exactly one of developer_name or agent_name
    if (!developerName && !agentName) {
      attachDiagnostic(
        config,
        lintDiagnostic(
          getBlockRange(config),
          "Config requires either 'developer_name' or 'agent_name'.",
          DiagnosticSeverity.Error,
          'config-missing-agent-name'
        )
      );
    } else if (developerName && agentName) {
      attachDiagnostic(
        config,
        lintDiagnostic(
          getBlockRange(config),
          "Only one of 'developer_name' or 'agent_name' can be provided, not both.",
          DiagnosticSeverity.Error,
          'config-duplicate-agent-name'
        )
      );
    }

    // Validate default_agent_user based on agent_type
    const agentTypeNode = config.agent_type as AstNodeLike | undefined;
    if (!agentTypeNode || typeof agentTypeNode !== 'object') return;
    const agentTypeValue =
      typeof (agentTypeNode as Record<string, unknown>).value === 'string'
        ? ((agentTypeNode as Record<string, unknown>).value as string)
        : undefined;
    if (!agentTypeValue) return;

    const agentTypeLower = agentTypeValue.toLowerCase();
    const defaultAgentUser = getStringValue(config.default_agent_user);

    if (
      agentTypeLower === 'agentforceserviceagent' ||
      agentTypeLower === 'agentforce service agent'
    ) {
      if (!defaultAgentUser) {
        attachDiagnostic(
          config,
          lintDiagnostic(
            getBlockRange(config),
            `'default_agent_user' is required for ${agentTypeValue} type agents.`,
            DiagnosticSeverity.Error,
            'config-missing-default-agent-user'
          )
        );
      }
    } else if (
      agentTypeLower === 'agentforceemployeeagent' ||
      agentTypeLower === 'agentforce employee agent'
    ) {
      if (defaultAgentUser) {
        const dauNode = config.default_agent_user as AstNodeLike;
        const dauCst = (dauNode as Record<string, unknown>).__cst as
          | CstMeta
          | undefined;
        const dauRange = dauCst?.range ?? getBlockRange(config);

        attachDiagnostic(
          dauNode,
          lintDiagnostic(
            dauRange,
            `'default_agent_user' is ignored for ${agentTypeValue} type agents.`,
            DiagnosticSeverity.Warning,
            'config-ignored-default-agent-user'
          )
        );
      }
    }
  }
}

export function configValidationRule(): LintPass {
  return new ConfigValidationPass();
}
