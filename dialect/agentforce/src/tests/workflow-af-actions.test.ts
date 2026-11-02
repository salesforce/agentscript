/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Tests that the agentforce `workflow` block accepts AFActionsBlock fields
 * (require_user_confirmation, include_in_progress_indicator, is_user_input,
 * is_displayable, filter_from_agent, complex_data_type_name) in its
 * workflow-scoped actions — the same set accepted in a subagent's actions block.
 */

import { describe, expect, test } from 'vitest';
import { DiagnosticSeverity } from '@agentscript/types';
import { parse } from '@agentscript/parser';
import { parseAndLint } from '@agentscript/language';
import { agentforceDialect } from '../index.js';
import { parseDocument, parseWithDiagnostics } from './test-utils.js';

const HEADER = `
config:
    developer_name: "TestAgent"
system:
    instructions: "A test agent."
    messages:
        welcome: "Hello!"
        error: "Error."
`.trim();

function unknownFieldErrors(source: string) {
  const { diagnostics } = parseWithDiagnostics(source);
  return diagnostics.filter(
    d => d.severity === DiagnosticSeverity.Error && d.code === 'unknown-field'
  );
}

function allErrors(source: string) {
  const { diagnostics } = parseWithDiagnostics(source);
  return diagnostics.filter(d => d.severity === DiagnosticSeverity.Error);
}

describe('workflow AFActionsBlock fields', () => {
  test.each([
    ['recordId', []],
    ['typo', ['action-unknown-input']],
  ])(
    'validates workflow input binding %s in the Agentforce dialect',
    (param, expected) => {
      const source = `${HEADER}
workflow lookup:
    description: "Lookup"
    actions:
        GetRecordDetails:
            description: "Get a record"
            target: "standardInvocableAction://getRecordDetails"
            inputs:
                recordId: string
                    is_user_input: True
    steps: ->
        run @actions.GetRecordDetails
            with ${param} = "001"
`;
      const { diagnostics } = parseAndLint(
        parse(source).rootNode,
        agentforceDialect
      );
      expect(
        diagnostics
          .filter(d => d.severity === DiagnosticSeverity.Error)
          .map(d => d.code)
      ).toEqual(expected);
    }
  );

  test('accepts require_user_confirmation and include_in_progress_indicator', () => {
    const source = `${HEADER}
workflow refund:
    description: "Issue a refund"
    actions:
        issue_refund:
            description: "Issue a refund"
            target: "flow://IssueRefund"
            require_user_confirmation: True
            include_in_progress_indicator: True
            progress_indicator_message: "Issuing your refund..."
    steps: ->
        run @actions.issue_refund
`;
    expect(unknownFieldErrors(source)).toHaveLength(0);
  });

  test.each([
    ['True', ['workflow-action-confirmation-ignored']],
    ['False', []],
    [undefined, []],
  ])(
    'warns only for require_user_confirmation: %s on a workflow action',
    (value, expected) => {
      const field =
        value === undefined
          ? ''
          : `\n            require_user_confirmation: ${value}`;
      const source = `${HEADER}
workflow refund:
    description: "Issue a refund"
    actions:
        issue_refund:
            description: "Issue a refund"
            target: "flow://IssueRefund"${field}
    steps: ->
        run @actions.issue_refund
`;
      const { diagnostics } = parseAndLint(
        parse(source).rootNode,
        agentforceDialect
      );
      expect(
        diagnostics
          .filter(d => d.severity === DiagnosticSeverity.Warning)
          .map(d => d.code)
      ).toEqual(expected);
    }
  );

  test('accepts is_user_input and complex_data_type_name on action inputs', () => {
    const source = `${HEADER}
workflow refund:
    description: "Issue a refund"
    actions:
        issue_refund:
            description: "Issue a refund"
            target: "flow://IssueRefund"
            inputs:
                order: object
                    description: "The order to refund"
                    is_user_input: True
                    is_required: True
                    complex_data_type_name: "lightning__recordInfoType"
    steps: ->
        run @actions.issue_refund
`;
    expect(unknownFieldErrors(source)).toHaveLength(0);
  });

  test('accepts is_displayable, filter_from_agent, complex_data_type_name on outputs', () => {
    const source = `${HEADER}
workflow refund:
    description: "Issue a refund"
    actions:
        issue_refund:
            description: "Issue a refund"
            target: "flow://IssueRefund"
            outputs:
                status: string
                    description: "Refund status"
                    is_displayable: True
                refund_id: string
                    description: "Internal refund ID"
                    is_displayable: False
                    filter_from_agent: True
                refund: object
                    description: "Full refund record"
                    complex_data_type_name: "RefundRecord"
    steps: ->
        run @actions.issue_refund
`;
    expect(unknownFieldErrors(source)).toHaveLength(0);
  });

  test('produces unknown-field error for truly unknown fields', () => {
    const source = `${HEADER}
workflow refund:
    description: "Issue a refund"
    actions:
        issue_refund:
            description: "Issue a refund"
            target: "flow://IssueRefund"
            totally_made_up_field: "value"
    steps: ->
        run @actions.issue_refund
`;
    expect(unknownFieldErrors(source).length).toBeGreaterThan(0);
  });

  test('full workflow with AF action fields and a label produces zero errors', () => {
    const source = `${HEADER}
start_agent router:
    description: "Routes requests"
    reasoning:
        instructions: ->
            | Route return requests to the workflow.
        actions:
            start_return: @utils.transition to @workflow.return_order

workflow return_order:
    label: "Return Order"
    description: "Look up the order and start a return"
    actions:
        GetRecordDetails:
            description: "Get the details of a record"
            require_user_confirmation: False
            include_in_progress_indicator: True
            progress_indicator_message: "Looking up your order..."
            source: "GetRecordDetails"
            target: "standardInvocableAction://getRecordDetails"
            inputs:
                recordId: object
                    description: "The record to look up"
                    is_required: True
                    is_user_input: True
                    complex_data_type_name: "lightning__recordInfoType"
            outputs:
                snapshot: string
                    description: "A snapshot of the record"
                    is_displayable: False
                    filter_from_agent: False
    steps: ->
        say "Hello world!"
        run @actions.GetRecordDetails
`;
    expect(allErrors(source)).toHaveLength(0);
    expect(
      parseDocument(source).workflow?.get('return_order')?.label?.value
    ).toBe('Return Order');
  });
});
