/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { Block, InputsBlock } from '@agentscript/language';

/**
 * Schema discriminant value for the Tableau Analyze Data subagent variant.
 */
export const TABLEAU_ANALYZE_DATA_SCHEMA = 'node://tableau/analyze_data/v1';

const TableauAnalyzeDataParametersBlock = Block('ParametersBlock', {
  context: InputsBlock.describe(
    'Variable bindings: each key maps to a @variables.X expression, e.g., authToken: @variables.authToken.'
  ),
}).describe(
  'Variable binding configuration. Use parameters.context to pre-populate node inputs from agent-level variables.'
);

/**
 * Variant-specific overrides for the Tableau Analyze Data subagent.
 *
 * Layered over `afCustomSubagentFields` in schema.ts, which provides the base
 * custom-subagent fields plus AF cross-cutting blocks (actions, model_config,
 * security). This file owns only what is *specific* to tableau — currently
 * the `parameters.context` shape.
 */
export const tableauAnalyzeDataVariantFields = {
  parameters: TableauAnalyzeDataParametersBlock,
};
