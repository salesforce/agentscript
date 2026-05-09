/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

export {
  LintEngine,
  PassStore,
  DependencyResolutionError,
  storeKey,
  each,
  defineRule,
  schemaContextKey,
} from '../core/analysis/lint-engine.js';

export type {
  LintPass,
  StoreKey,
  EachDep,
  Dep,
  ResolveDeps,
} from '../core/analysis/lint-engine.js';

export {
  collectDiagnostics,
  recurseAstChildren,
  walkAstExpressions,
  dispatchAstChildren,
  forEachExpressionChild,
} from '../core/analysis/ast-walkers.js';

export { walkSchema } from '../core/analysis/schema-walker.js';
export type { SchemaFieldVisitor } from '../core/analysis/schema-walker.js';

export {
  symbolTableAnalyzer,
  symbolTableKey,
} from '../core/analysis/symbol-table.js';
export { undefinedReferencePass } from './undefined-reference.js';
export { duplicateKeyPass } from './duplicate-keys.js';
export { requiredFieldPass } from './required-fields.js';
export { constraintValidationPass } from './constraint-validation.js';
export { positionIndexPass } from '../core/analysis/position-index-pass.js';
export { unreachableCodePass } from './unreachable-code.js';
export { unsupportedConditionalsPass } from './unsupported-conditionals.js';
export { emptyBlockPass } from './empty-block.js';
export { spreadContextPass } from './spread-context.js';
export {
  expressionValidationPass,
  BUILTIN_FUNCTIONS,
} from './expression-validation.js';
export type { ExpressionValidationOptions } from './expression-validation.js';

export {
  positionIndexKey,
  queryExpressionAtPosition,
  queryDefinitionAtPosition,
  queryScopeAtPosition,
} from '../core/analysis/position-index.js';

export type { PositionIndex } from '../core/analysis/position-index.js';

export {
  levenshtein,
  findSuggestion,
  resolveColinearAction,
  lintDiagnostic,
  extractOutputRef,
  extractVariableRef,
  LINT_SOURCE,
  SUGGESTION_THRESHOLD,
} from './lint-utils.js';
