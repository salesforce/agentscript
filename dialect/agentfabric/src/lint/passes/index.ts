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
import { agentFabricSemanticPass } from './agentfabric-semantic.js';
import { suppressActionsNamespaceUndefinedReferencePass } from './suppress-tools-namespace-undefined-reference.js';
import type { ExpressionValidationOptions } from '@agentscript/language/lint';
import { AgentFabricSchemaInfo } from '../../schema.js';

const expressionOptions: ExpressionValidationOptions = {
  functions: new Set([
    'len',
    'max',
    'min',
    'uuid',
    'now',
    'strip',
    'startswith',
    'endswith',
    'abs',
    'round',
    'sum',
    'parse_json',
    'capitalize',
    'join',
    'split',
    'splitlines',
  ]),
  namespacedFunctions: AgentFabricSchemaInfo.namespacedFunctions,
};

/** All AgentFabric lint passes in engine execution order. */
export function defaultRules(): LintPass[] {
  return [
    // Base passes from @agentscript/language
    symbolTableAnalyzer(),
    duplicateKeyPass(),
    requiredFieldPass(),
    singularCollectionPass(),
    constraintValidationPass(),
    positionIndexPass(),
    unreachableCodePass(),
    emptyBlockPass(),
    expressionValidationPass(expressionOptions),
    spreadContextPass(),
    agentFabricSemanticPass(),
    // Validation
    undefinedReferencePass(),
    suppressActionsNamespaceUndefinedReferencePass(),
  ];
}
