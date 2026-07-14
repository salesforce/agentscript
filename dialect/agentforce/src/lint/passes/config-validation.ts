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
 * - default_agent_user may be `None` only for AgentforceEmployeeAgent
 *
 * Diagnostics: config-missing-agent-name, config-duplicate-agent-name,
 *              config-missing-default-agent-user, config-invalid-default-agent-user-none
 */

import type {
  AstRoot,
  AstNodeLike,
  LintPass,
  PassStore,
} from '@agentscript/language';
import {
  storeKey,
  attachDiagnostic,
  lintDiagnostic,
  isNoneLiteral,
  isAstNodeLike,
} from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import { getBlockRange } from '../utils.js';
import { isAllowedAgentType } from '../agent-types.js';

/** Extract a non-empty string value from a StringLiteral/TemplateExpression node. */
function getStringValue(node: unknown): string | undefined {
  if (
    !isAstNodeLike(node) ||
    !node.__kind ||
    !['StringLiteral', 'TemplateExpression'].includes(node.__kind) ||
    typeof node.value !== 'string' ||
    node.value.trim().length === 0
  ) {
    return undefined;
  }
  return node.value;
}

class ConfigValidationPass implements LintPass {
  readonly id = storeKey('config-validation');
  readonly description =
    'Validates Agentforce config block constraints (agent name, default_agent_user)';

  run(_store: PassStore, root: AstRoot): void {
    const config = root.config;
    if (!isAstNodeLike(config)) return;

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

    // Validate default_agent_user. The user may set it under the legacy
    // `config.default_agent_user` (deprecated) or the new
    // `access.default_agent_user`. The field may also be explicitly `None`
    // for AgentforceEmployeeAgent.
    const access = isAstNodeLike(root.access) ? root.access : undefined;
    const configDauNode = config.default_agent_user;
    const accessDauNode = access?.default_agent_user;

    const accessDauString = getStringValue(accessDauNode);
    const configDauString = getStringValue(configDauNode);
    const accessDauIsNone = isNoneLiteral(accessDauNode);
    const configDauIsNone = isNoneLiteral(configDauNode);

    // Has a non-empty string user set (in either block).
    const hasStringDau = accessDauString || configDauString;

    // When both are set, access wins — flag the config one with a warning.
    if (
      (accessDauString || accessDauIsNone) &&
      (configDauString || configDauIsNone)
    ) {
      const dauNode = configDauNode as AstNodeLike;
      attachDiagnostic(
        dauNode,
        lintDiagnostic(
          getBlockRange(dauNode),
          "'default_agent_user' is set in both 'config' and 'access' — 'access.default_agent_user' takes precedence and 'config.default_agent_user' will be ignored.",
          DiagnosticSeverity.Warning,
          'config-default-agent-user-conflict'
        )
      );
    }

    const agentTypeValue = getStringValue(config.agent_type);
    const agentTypeLower = agentTypeValue?.toLowerCase();

    // agent_type must be a recognized agent type. An unknown value is rejected
    // so typos and unsupported types surface before deploy.
    if (agentTypeValue && !isAllowedAgentType(agentTypeValue)) {
      const agentTypeNode = config.agent_type as AstNodeLike;
      attachDiagnostic(
        agentTypeNode,
        lintDiagnostic(
          getBlockRange(agentTypeNode),
          `'${agentTypeValue}' is not a supported agent_type.`,
          DiagnosticSeverity.Error,
          'agent-type-not-allowed'
        )
      );
    }

    const isEmployeeAgent =
      agentTypeLower === 'agentforceemployeeagent' ||
      agentTypeLower === 'agentforce employee agent';

    // None is only valid for employee agents. Flag it everywhere else,
    // including when agent_type is unset (we can't infer the intent).
    if (!isEmployeeAgent) {
      const noneMessage = agentTypeValue
        ? `'default_agent_user' may only be 'None' for AgentforceEmployeeAgent (got ${agentTypeValue}).`
        : "'default_agent_user' may only be 'None' when 'agent_type' is 'AgentforceEmployeeAgent'.";

      if (configDauIsNone) {
        const dauNode = configDauNode as unknown as AstNodeLike;
        attachDiagnostic(
          dauNode,
          lintDiagnostic(
            getBlockRange(dauNode),
            noneMessage,
            DiagnosticSeverity.Error,
            'config-invalid-default-agent-user-none'
          )
        );
      }
      if (accessDauIsNone && access) {
        const dauNode = accessDauNode as unknown as AstNodeLike;
        attachDiagnostic(
          dauNode,
          lintDiagnostic(
            getBlockRange(dauNode),
            noneMessage,
            DiagnosticSeverity.Error,
            'config-invalid-default-agent-user-none'
          )
        );
      }
    }

    // recommended_prompts is only valid for employee agents.
    const system = isAstNodeLike(root.system) ? root.system : undefined;
    const recommendedPrompts = system?.recommended_prompts;
    if (isAstNodeLike(recommendedPrompts) && !isEmployeeAgent) {
      attachDiagnostic(
        recommendedPrompts,
        lintDiagnostic(
          getBlockRange(recommendedPrompts),
          `'recommended_prompts' is only supported for AgentforceEmployeeAgent${agentTypeValue ? ` (got ${agentTypeValue})` : ''}.`,
          DiagnosticSeverity.Error,
          'recommended-prompts-agent-type'
        )
      );
    }

    // Employee agents may not configure sharing_policy or
    // verified_customer_record_access — those entitlements only apply to
    // service agents.
    if (isEmployeeAgent && access) {
      const sharingPolicy = access.sharing_policy;
      if (isAstNodeLike(sharingPolicy)) {
        attachDiagnostic(
          sharingPolicy,
          lintDiagnostic(
            getBlockRange(sharingPolicy),
            "'sharing_policy' is not allowed for AgentforceEmployeeAgent.",
            DiagnosticSeverity.Error,
            'access-sharing-policy-not-allowed'
          )
        );
      }
      const vcra = access.verified_customer_record_access;
      if (isAstNodeLike(vcra)) {
        attachDiagnostic(
          vcra,
          lintDiagnostic(
            getBlockRange(vcra),
            "'verified_customer_record_access' is not allowed for AgentforceEmployeeAgent.",
            DiagnosticSeverity.Error,
            'access-verified-customer-record-access-not-allowed'
          )
        );
      }
    }

    if (!agentTypeValue) return;

    if (
      agentTypeLower === 'agentforceserviceagent' ||
      agentTypeLower === 'agentforce service agent'
    ) {
      // Service agents need a real user — neither absent nor None counts.
      if (!hasStringDau) {
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
    }
    // Employee agents can: omit the field, set it to None, or set a string.
    // No additional diagnostics needed here.
  }
}

export function configValidationRule(): LintPass {
  return new ConfigValidationPass();
}
