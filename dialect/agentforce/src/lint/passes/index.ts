/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { LintPass } from '@agentscript/language';
import { defaultRules as agentscriptRules } from '@agentscript/agentscript-dialect';

export { actionTargetSchemeRule } from './action-target.js';
export {
  hyperclassifierExtractor,
  hyperclassifierConstraintsRule,
} from './hyperclassifier.js';
export { connectionValidationRule } from './connection-validation.js';
export { systemMessageVariablesRule } from './system-message-variables.js';
export {
  boundInputsRule,
  isSimpleVariableReference,
  noTransitionRule,
  connectedAgentTargetPass,
  templateReferenceValidationPass,
} from './connected-agents/index.js';
export { configValidationRule } from './config-validation.js';
export { variableValidationRule } from './variable-validation.js';
export { complexDataTypeWarningRule } from './complex-data-type.js';

import { actionTargetSchemeRule } from './action-target.js';
import {
  hyperclassifierExtractor,
  hyperclassifierConstraintsRule,
} from './hyperclassifier.js';
import { connectionValidationRule } from './connection-validation.js';
import { systemMessageVariablesRule } from './system-message-variables.js';
import {
  boundInputsRule,
  noTransitionRule,
  connectedAgentTargetPass,
  templateReferenceValidationPass,
} from './connected-agents/index.js';
import { configValidationRule } from './config-validation.js';
import { variableValidationRule } from './variable-validation.js';
import { complexDataTypeWarningRule } from './complex-data-type.js';

/** All Agentforce lint rules — extends AgentScript rules with security checks. */
export function defaultRules(): LintPass[] {
  return [
    ...agentscriptRules(),
    actionTargetSchemeRule(),
    hyperclassifierExtractor(),
    hyperclassifierConstraintsRule(),
    connectionValidationRule(),
    systemMessageVariablesRule(),
    boundInputsRule(),
    noTransitionRule(),
    connectedAgentTargetPass(),
    templateReferenceValidationPass(),
    configValidationRule(),
    variableValidationRule(),
    complexDataTypeWarningRule(),
  ];
}
