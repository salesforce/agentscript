/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { LintPass } from '@agentscript/language';
import {
  symbolTableAnalyzer,
  undefinedReferencePass,
  duplicateKeyPass,
  requiredFieldPass,
  singularCollectionPass,
  constraintValidationPass,
  positionIndexPass,
  unreachableCodePass,
  unsupportedConditionalsPass,
  transitionTargetPass,
  emptyBlockPass,
  unusedVariablePass,
  expressionValidationPass,
  spreadContextPass,
  identifierValidationPass,
} from '@agentscript/language';
import { typeMapAnalyzer } from './type-map.js';
import { reasoningActionsAnalyzer } from './reasoning-actions.js';
import { actionIoRule } from './action-io.js';
import { actionTypeCheckRule } from './action-type-check.js';
import { availableWhenTypeCheckRule } from './available-when-type-check.js';
import { functionArgumentTypeCheckRule } from './function-argument-type-check.js';
import { variableDefaultTypeCheckRule } from './variable-default-type-check.js';
import {
  setVariablesIoRule,
  collectSetVariablesTargets,
} from './set-variables-io.js';
import { instructionTemplateSyntaxPass } from './instruction-template-syntax.js';
import {
  renderRulesRule,
  renderRuleScopePass,
  renderTargetExemptionPass,
  connectionFormatsAnalyzer,
} from './render-rules.js';
import { agentIqValidationPass } from './agentiq-validation.js';
import { gbaOnlyBlocksPass } from './gba-only-blocks.js';

export { typeMapAnalyzer, typeMapKey } from './type-map.js';
export type {
  TypeMap,
  VariableTypeInfo,
  ParamInfo,
  OutputParamInfo,
  BooleanField,
  StringField,
  ActionSignature,
  ConnectedAgentInfo,
  ConnectedAgentInputInfo,
  TransitionTarget,
} from './type-map.js';
export {
  reasoningActionsAnalyzer,
  reasoningActionsKey,
} from './reasoning-actions.js';
export type {
  ReasoningActionEntry,
  SetVariablesEntry,
} from './reasoning-actions.js';
export { setVariablesEntriesKey } from './reasoning-actions.js';
export {
  connectionFormatsAnalyzer,
  connectionFormatsIndexKey,
} from './render-rules.js';
export { actionIoRule } from './action-io.js';
export { actionTypeCheckRule } from './action-type-check.js';
export { availableWhenTypeCheckRule } from './available-when-type-check.js';
export {
  functionArgumentTypeCheckRule,
  functionArgumentTypeCheckKey,
} from './function-argument-type-check.js';
export { variableDefaultTypeCheckRule } from './variable-default-type-check.js';
export { setVariablesIoRule } from './set-variables-io.js';
export {
  renderRulesRule,
  renderRuleScopePass,
  renderTargetExemptionPass,
} from './render-rules.js';
export { instructionTemplateSyntaxPass } from './instruction-template-syntax.js';
export { gbaOnlyBlocksPass } from './gba-only-blocks.js';

/** All AgentScript lint passes in engine execution order. */
export function defaultRules(): LintPass[] {
  return [
    // Base passes
    symbolTableAnalyzer(),
    duplicateKeyPass(),
    requiredFieldPass(),
    singularCollectionPass(),
    constraintValidationPass(),
    positionIndexPass(),
    unreachableCodePass(),
    unsupportedConditionalsPass(),
    transitionTargetPass(),
    emptyBlockPass(),
    unusedVariablePass({
      collectExternallyUsedVariables: store =>
        collectSetVariablesTargets(store),
    }),
    expressionValidationPass(),
    spreadContextPass(),
    identifierValidationPass(),
    agentIqValidationPass(),
    gbaOnlyBlocksPass(),
    // AgentScript analyzers
    typeMapAnalyzer(),
    reasoningActionsAnalyzer(),
    connectionFormatsAnalyzer(),
    // Must run before undefinedReferencePass — pre-marks `render:` value
    // expressions as validated so their non-referenceable/unknown-property
    // chains don't produce spurious undefined-reference diagnostics.
    renderTargetExemptionPass(),
    // Validation
    undefinedReferencePass(),
    actionIoRule(),
    variableDefaultTypeCheckRule(),
    actionTypeCheckRule(),
    availableWhenTypeCheckRule(),
    functionArgumentTypeCheckRule(),
    setVariablesIoRule(),
    renderRulesRule(),
    renderRuleScopePass(),
    instructionTemplateSyntaxPass(),
  ];
}
