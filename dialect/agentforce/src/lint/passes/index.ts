/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { AstNodeLike, LintPass } from '@agentscript/language';
import {
  unusedVariablePass,
  decomposeAtMemberExpression,
} from '@agentscript/language';
import { defaultRules as agentscriptRules } from '@agentscript/agentscript-dialect';

/**
 * Variables the Agentforce runtime reads by name from the messaging session,
 * even when the script never references them. Each entry pins the name to its
 * required `source:` binding so a custom variable that happens to share a name
 * (e.g. a `mutable` `ContactId`) does not get the runtime-required message.
 */
const REQUIRED_PLATFORM_VARIABLE_SOURCES: ReadonlyMap<string, string> = new Map(
  [
    ['EndUserId', '@MessagingSession.MessagingEndUserId'],
    ['ChannelType', '@MessagingSession.ChannelType'],
    ['RoutableId', '@MessagingSession.Id'],
    ['EndUserLanguage', '@MessagingSession.EndUserLanguage'],
    ['ContactId', '@MessagingEndUser.ContactId'],
  ]
);

/** Returns `@Namespace.Property` for a variable's `source:`, or undefined. */
function readSourceBinding(decl: AstNodeLike): string | undefined {
  const properties = decl.properties as Record<string, unknown> | undefined;
  const source = properties?.['source'];
  if (!source) return undefined;
  const decomposed = decomposeAtMemberExpression(source);
  if (!decomposed) return undefined;
  return `@${decomposed.namespace}.${decomposed.property}`;
}

export { actionTargetSchemeRule } from './action-target.js';
export { skillTargetSchemeRule } from './skill-target.js';
export {
  hyperclassifierExtractor,
  hyperclassifierConstraintsRule,
} from './hyperclassifier.js';
export { connectionValidationRule } from './connection-validation.js';
export { systemMessageVariablesRule } from './system-message-variables.js';
export {
  boundInputsRule,
  isSimpleVariableReference,
  connectedAgentTargetPass,
  templateReferenceValidationPass,
} from './connected-agents/index.js';
export { configValidationRule } from './config-validation.js';
export { variableValidationRule } from './variable-validation.js';
export { complexDataTypeWarningRule } from './complex-data-type.js';
export { customSubagentValidationRule } from './custom-subagent-validation.js';
export { adaptiveLanguageValidationRule } from './adaptive-language-validation.js';
export { disabledAdditionalParametersRule } from './disabled-additional-parameters.js';

import { actionTargetSchemeRule } from './action-target.js';
import { skillTargetSchemeRule } from './skill-target.js';
import {
  hyperclassifierExtractor,
  hyperclassifierConstraintsRule,
} from './hyperclassifier.js';
import { connectionValidationRule } from './connection-validation.js';
import { systemMessageVariablesRule } from './system-message-variables.js';
import {
  boundInputsRule,
  connectedAgentTargetPass,
  templateReferenceValidationPass,
} from './connected-agents/index.js';
import { configValidationRule } from './config-validation.js';
import { variableValidationRule } from './variable-validation.js';
import { complexDataTypeWarningRule } from './complex-data-type.js';
import { customSubagentValidationRule } from './custom-subagent-validation.js';
import { adaptiveLanguageValidationRule } from './adaptive-language-validation.js';
import { disabledAdditionalParametersRule } from './disabled-additional-parameters.js';

/** All Agentforce lint rules — extends AgentScript rules with security checks. */
export function defaultRules(): LintPass[] {
  const baseRules = agentscriptRules().map(rule =>
    rule.id === 'unused-variable'
      ? unusedVariablePass({
          overrideMessageForVariable: (name, decl) => {
            const expectedSource = REQUIRED_PLATFORM_VARIABLE_SOURCES.get(name);
            if (!expectedSource) return undefined;
            if (readSourceBinding(decl) !== expectedSource) return undefined;
            return `Variable '${name}' is not used but is required by Agentforce. Removing this variable can cause issues when running the agent.`;
          },
        })
      : rule
  );
  return [
    ...baseRules,
    actionTargetSchemeRule(),
    skillTargetSchemeRule(),
    hyperclassifierExtractor(),
    hyperclassifierConstraintsRule(),
    connectionValidationRule(),
    systemMessageVariablesRule(),
    boundInputsRule(),
    connectedAgentTargetPass(),
    templateReferenceValidationPass(),
    configValidationRule(),
    variableValidationRule(),
    complexDataTypeWarningRule(),
    customSubagentValidationRule(),
    adaptiveLanguageValidationRule(),
    disabledAdditionalParametersRule(),
  ];
}
