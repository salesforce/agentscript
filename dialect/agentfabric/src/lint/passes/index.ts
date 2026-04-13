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
  emptyBlockPass,
  expressionValidationPass,
} from '@agentscript/language';
import { agentFabricSemanticPass } from './agentfabric-semantic.js';
import { suppressActionsNamespaceUndefinedReferencePass } from './suppress-tools-namespace-undefined-reference.js';

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
    expressionValidationPass(),
    agentFabricSemanticPass(),
    // Validation
    undefinedReferencePass(),
    suppressActionsNamespaceUndefinedReferencePass(),
  ];
}
