/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Tests that the agentforce `orchestrator` block accepts AFActionsBlock fields
 * (require_user_confirmation, include_in_progress_indicator, is_user_input,
 * is_displayable, filter_from_agent, complex_data_type_name) — the same set
 * accepted in a subagent's actions block.
 */

import { describe, expect, test } from 'vitest';
import { parseWithDiagnostics } from './test-utils.js';
import { DiagnosticSeverity } from '@agentscript/types';

const GBA_HEADER = `
config:
    developer_name: "TestGba"
    agent_type: "GoalBasedAgent"
system:
    instructions: "A goal-based agent."
    messages:
        welcome: "Hello!"
        error: "Error."
`.trim();

function unknownFieldErrors(source: string) {
  const { diagnostics } = parseWithDiagnostics(source);
  return diagnostics.filter(
    d =>
      d.severity === DiagnosticSeverity.Error &&
      typeof d.code === 'string' &&
      d.code === 'unknown-field'
  );
}

function allErrors(source: string) {
  const { diagnostics } = parseWithDiagnostics(source);
  return diagnostics.filter(d => d.severity === DiagnosticSeverity.Error);
}

describe('orchestrator AFActionsBlock fields', () => {
  test('accepts require_user_confirmation and include_in_progress_indicator', () => {
    const source = `${GBA_HEADER}
orchestrator agent:
    actions:
        create_case:
            description: "Create a case"
            target: "flow://CreateCase"
            require_user_confirmation: True
            include_in_progress_indicator: True
            progress_indicator_message: "Creating your case..."
`;
    const errors = unknownFieldErrors(source);
    expect(errors).toHaveLength(0);
  });

  test('accepts is_user_input on action inputs', () => {
    const source = `${GBA_HEADER}
orchestrator agent:
    actions:
        create_case:
            description: "Create a case"
            target: "flow://CreateCase"
            inputs:
                subject: string
                    description: "Case subject"
                    is_user_input: True
                    is_required: True
`;
    const errors = unknownFieldErrors(source);
    expect(errors).toHaveLength(0);
  });

  test('accepts is_displayable, filter_from_agent, complex_data_type_name on outputs', () => {
    const source = `${GBA_HEADER}
orchestrator agent:
    actions:
        create_case:
            description: "Create a case"
            target: "flow://CreateCase"
            outputs:
                case_number: string
                    description: "The case number"
                    is_displayable: True
                case_id: string
                    description: "Internal record ID"
                    is_displayable: False
                    filter_from_agent: True
                case_data: object
                    description: "Full case data"
                    is_displayable: True
                    complex_data_type_name: "CaseRecord"
`;
    const errors = unknownFieldErrors(source);
    expect(errors).toHaveLength(0);
  });

  test('produces unknown-field error for truly unknown fields', () => {
    const source = `${GBA_HEADER}
orchestrator agent:
    actions:
        create_case:
            description: "Create a case"
            target: "flow://CreateCase"
            totally_made_up_field: "value"
`;
    const errors = unknownFieldErrors(source);
    expect(errors.length).toBeGreaterThan(0);
  });

  test('full real-world orchestrator with AF action fields produces no unknown-field errors', () => {
    const source = `${GBA_HEADER}
orchestrator agent:
    reasoning:
        instructions: ->
            | Determine intent and take appropriate action.
        actions:
            create_case: @actions.CreateCaseEnhancedData
    actions:
        CreateCaseEnhancedData:
            description: "Create a new Case record with AI-enhanced data"
            target: "flow://CreateCaseEnhancedData"
            require_user_confirmation: True
            include_in_progress_indicator: True
            progress_indicator_message: "Creating your case with enhanced data..."
            inputs:
                Subject:
                    description: "The subject of the case"
                    is_user_input: True
                    is_required: True
                Description:
                    description: "Description of the issue"
                    is_user_input: True
                    is_required: False
            outputs:
                CaseNumber:
                    description: "The case number"
                    is_displayable: True
                CaseId:
                    description: "Internal case ID"
                    is_displayable: False
                    filter_from_agent: True
`;
    const errors = unknownFieldErrors(source);
    expect(errors).toHaveLength(0);
  });

  test('all fields valid — full script produces zero errors', () => {
    const source = `${GBA_HEADER}
orchestrator agent:
    actions:
        lookup:
            description: "Look up data"
            target: "flow://Lookup"
            require_user_confirmation: False
            include_in_progress_indicator: False
            inputs:
                query: string
                    description: "Query string"
                    is_required: True
                    is_user_input: True
            outputs:
                result: string
                    description: "Result"
                    is_displayable: True
`;
    const errors = allErrors(source);
    expect(errors).toHaveLength(0);
  });
});
