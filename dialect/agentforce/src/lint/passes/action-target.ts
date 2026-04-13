/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Action target URI scheme validation for Agentforce.
 *
 * Agentforce supports the following invocation target schemes:
 *   - flow://                    — Salesforce Autolaunched Flow
 *   - apex://                    — Apex Invocable Action
 *   - apexRest://                — Apex REST API method
 *   - auraEnabled://             — Aura-enabled Apex method
 *   - standardInvocableAction:// — Standard Salesforce invocable action
 *   - quickAction://             — Salesforce Quick Action
 *   - api://                     — Generic API endpoint
 *   - externalService://         — External Service endpoint
 *   - externalConnector://       — External Connector integration
 *   - slack://                   — Slack integration
 *   - prompt://                  — Prompt Template
 *   - generatePromptResponse://  — Generate Prompt Response
 *   - serviceCatalog://          — Service Catalog item
 *   - createCatalogItemRequest:// — Create Catalog Item Request
 *   - cdpMlPrediction://         — Customer Data Platform ML Prediction
 *   - namedQuery://              — Named Query
 *   - integrationProcedureAction:// — Integration Procedure Action
 *   - executeIntegrationProcedure:// — Execute Integration Procedure
 *   - mcpTool://                 — Model Context Protocol Tool
 *   - expressionSet://           — Expression Set
 *   - runExpressionSet://        — Run Expression Set
 *   - retriever://               — Knowledge Retriever
 *
 * Diagnostic: invalid-action-target
 */

import type { LintPass } from '@agentscript/language';
import {
  defineRule,
  each,
  attachDiagnostic,
  lintDiagnostic,
} from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import { typeMapKey } from '@agentscript/agentscript-dialect';
import type {
  TypeMap,
  ActionSignature,
} from '@agentscript/agentscript-dialect';

const VALID_SCHEMES = [
  'api',
  'apex',
  'apexRest',
  'auraEnabled',
  'cdpMlPrediction',
  'createCatalogItemRequest',
  'executeIntegrationProcedure',
  'expressionSet',
  'externalConnector',
  'externalService',
  'flow',
  'generatePromptResponse',
  'integrationProcedureAction',
  'mcpTool',
  'namedQuery',
  'prompt',
  'quickAction',
  'retriever',
  'runExpressionSet',
  'serviceCatalog',
  'slack',
  'standardInvocableAction',
] as const;
const VALID_SCHEME_SET = new Set(
  VALID_SCHEMES.map(scheme => scheme.toLowerCase())
);

/** Flatten TypeMap into per-action entries that have a target field. */
function flattenActionsWithTarget(tm: TypeMap) {
  const result: Array<{ actionName: string; sig: ActionSignature }> = [];
  for (const [, actionMap] of tm.actions) {
    for (const [actionName, sig] of actionMap) {
      if (sig.target) result.push({ actionName, sig });
    }
  }
  return result;
}

export function actionTargetSchemeRule(): LintPass {
  return defineRule({
    id: 'invalid-action-target',
    description:
      'Action target URIs must use a supported scheme (flow://, apex://, externalService://, standardInvocableAction://, prompt://, generatePromptResponse://, etc.).',
    deps: { action: each(typeMapKey, flattenActionsWithTarget) },

    run({ action }) {
      const { actionName, sig } = action;
      const target = sig.target!;
      let parsed: URL;
      try {
        parsed = new URL(target.value);
      } catch {
        attachDiagnostic(
          target.node,
          lintDiagnostic(
            target.keyRange,
            `Action '${actionName}' has an invalid target "${target.value}". ` +
              `Expected a URI with a supported scheme: ${VALID_SCHEMES.join(', ')}.`,
            DiagnosticSeverity.Error,
            'invalid-action-target'
          )
        );
        return;
      }

      // URL.protocol includes the trailing ":" (e.g. "flow:")
      const scheme = parsed.protocol.slice(0, -1).toLowerCase();
      if (!scheme) {
        attachDiagnostic(
          target.node,
          lintDiagnostic(
            target.keyRange,
            `Action '${actionName}' has an invalid target "${target.value}". ` +
              `Expected a URI with a supported scheme: ${VALID_SCHEMES.join(', ')}.`,
            DiagnosticSeverity.Error,
            'invalid-action-target'
          )
        );
        return;
      }

      if (!VALID_SCHEME_SET.has(scheme)) {
        attachDiagnostic(
          target.node,
          lintDiagnostic(
            target.keyRange,
            `Action '${actionName}' uses unsupported target scheme "${scheme}://". ` +
              `Supported schemes: ${VALID_SCHEMES.join(', ')}.`,
            DiagnosticSeverity.Error,
            'invalid-action-target'
          )
        );
      }
    },
  });
}
