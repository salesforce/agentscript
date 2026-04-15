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
  emptyBlockPass,
  expressionValidationPass,
  spreadContextPass,
} from '@agentscript/language';
import { typeMapAnalyzer } from './type-map.js';
import { reasoningActionsAnalyzer } from './reasoning-actions.js';
import { actionIoRule } from './action-io.js';
import { actionTypeCheckRule } from './action-type-check.js';

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
export type { ReasoningActionEntry } from './reasoning-actions.js';
export { actionIoRule } from './action-io.js';
export { actionTypeCheckRule } from './action-type-check.js';

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
    emptyBlockPass(),
    expressionValidationPass(),
    spreadContextPass(),
    // AgentScript analyzers
    typeMapAnalyzer(),
    reasoningActionsAnalyzer(),
    // Validation
    undefinedReferencePass(),
    actionIoRule(),
    actionTypeCheckRule(),
  ];
}
