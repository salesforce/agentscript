/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { LintEngine } from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import type { Diagnostic } from '@agentscript/types';
import { parseDocument, testSchemaCtx } from './test-utils.js';
import { defaultRules } from '../lint/passes/index.js';

// ---------------------------------------------------------------------------
// render-rule validation of the `render:` / `when @connection` surface.
//
// The base render-rules pass lives in the agentscript dialect, but its format
// *ownership* checks only have teeth once a connection with `response_formats:`
// is declared — a construct the agentforce dialect defines. So the
// ownership/exemption/empty-when cases are exercised here, against the
// agentforce schema. The `with`-binding validation is a separate pass, covered
// in `render-with-usecases.test.ts`.
// ---------------------------------------------------------------------------

function runLint(source: string): Diagnostic[] {
  const ast = parseDocument(source);
  const engine = new LintEngine({ passes: defaultRules() });
  return engine.run(ast, testSchemaCtx).diagnostics;
}

describe('render-rule format ownership', () => {
  const CONN_MESSAGING = `
connection messaging:
    label: "Messaging"
    response_formats:
        choices:
            description: "Multiple choice"
            source: "response_format://SurfaceAction__MessagingChoices"
        rich_link:
            description: "Rich link"
            source: "response_format://SurfaceAction__MessagingRichLink"
`;

  const CONN_SLACK = `
connection slack:
    label: "Slack"
    response_formats:
        blocks:
            description: "Slack blocks"
            source: "response_format://SurfaceAction__SlackBlocks"
`;

  function topicWithRender(renderExpr: string): string {
    return (
      CONN_MESSAGING +
      CONN_SLACK +
      `
subagent main:
  description: "Main"
  actions:
    get_list:
      description: "Get list"
      target: "flow://get_list"
  reasoning:
    instructions: ->
      |Do it
    actions:
      list_it: @actions.get_list
        when @connection.messaging
          render: ${renderExpr}
`
    );
  }

  const OWNERSHIP_CODES = [
    'render-rule-format-not-in-connection',
    'render-rule-format-connection-mismatch',
    'render-rule-invalid-format-ref',
  ];

  it('accepts shortform ref to a format owned by the connection', () => {
    const diagnostics = runLint(topicWithRender('@response_formats.choices'));
    const errors = diagnostics.filter(d =>
      OWNERSHIP_CODES.includes(d.code ?? '')
    );
    expect(errors).toHaveLength(0);
  });

  it('accepts longform ref to a format owned by the connection', () => {
    const diagnostics = runLint(
      topicWithRender('@connection.messaging.response_formats.choices')
    );
    const errors = diagnostics.filter(d =>
      OWNERSHIP_CODES.includes(d.code ?? '')
    );
    expect(errors).toHaveLength(0);
  });

  it('reports render-rule-format-not-in-connection when shortform names a format that belongs to a different connection', () => {
    // `blocks` is defined on connection `slack`, not on `messaging`. This also
    // covers a name that exists on no connection at all — same branch, same
    // code (the ownership check only asks "is this name in *this* connection").
    const diagnostics = runLint(topicWithRender('@response_formats.blocks'));
    const errors = diagnostics.filter(
      d => d.code === 'render-rule-format-not-in-connection'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe(DiagnosticSeverity.Error);
    expect(errors[0].message).toContain('blocks');
    expect(errors[0].message).toContain('messaging');
  });

  it('reports render-rule-format-connection-mismatch when longform names a different connection', () => {
    const diagnostics = runLint(
      topicWithRender('@connection.slack.response_formats.blocks')
    );
    const errors = diagnostics.filter(
      d => d.code === 'render-rule-format-connection-mismatch'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe(DiagnosticSeverity.Error);
    expect(errors[0].message).toContain('blocks');
    expect(errors[0].message).toContain('messaging');
  });

  it('built-in @response_formats.json bypasses ownership check', () => {
    const diagnostics = runLint(topicWithRender('@response_formats.json'));
    const errors = diagnostics.filter(d =>
      OWNERSHIP_CODES.includes(d.code ?? '')
    );
    expect(errors).toHaveLength(0);
  });

  it('does not emit undefined-reference on @response_formats.<name> render targets', () => {
    // Regression: `response_formats` is a scoped namespace on
    // ResponseFormatBlock, so `@response_formats.choices` would trigger the
    // `non-referenceable-scope` diagnostic under undefinedReferencePass.
    // `renderTargetExemptionPass` must pre-mark render values so this
    // spurious diagnostic never surfaces.
    for (const expr of [
      '@response_formats.choices',
      '@response_formats.json',
      '@connection.messaging.response_formats.choices',
    ]) {
      const diagnostics = runLint(topicWithRender(expr));
      const undefRefs = diagnostics.filter(
        d => d.code === 'undefined-reference'
      );
      expect(undefRefs, `expected no undefined-reference for ${expr}`).toEqual(
        []
      );
    }
  });

  it('reports render-rule-format-not-in-connection when longform matches enclosing connection but names a format owned by a different connection', () => {
    // `blocks` is declared on `slack`, not `messaging`. The longform ref
    // targets `messaging`, so the connection-mismatch guard passes — the
    // ownership check must catch it.
    const diagnostics = runLint(
      topicWithRender('@connection.messaging.response_formats.blocks')
    );
    const notInConn = diagnostics.filter(
      d => d.code === 'render-rule-format-not-in-connection'
    );
    const mismatch = diagnostics.filter(
      d => d.code === 'render-rule-format-connection-mismatch'
    );
    expect(notInConn).toHaveLength(1);
    expect(notInConn[0].severity).toBe(DiagnosticSeverity.Error);
    expect(mismatch).toHaveLength(0);
  });

  it('flags an empty `when @connection` block as a render-rule-empty-when Error', () => {
    // An empty `when @connection.messaging` (no `render:` clause) is a hard
    // Error; the message asks for a `render:` clause without naming a format.
    const source =
      CONN_MESSAGING +
      CONN_SLACK +
      `
subagent main:
  description: "Main"
  actions:
    get_list:
      description: "Get list"
      target: "flow://get_list"
  reasoning:
    instructions: ->
      |Do it
    actions:
      list_it: @actions.get_list
        when @connection.messaging
`;
    const diagnostics = runLint(source);
    const errors = diagnostics.filter(d => d.code === 'render-rule-empty-when');
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe(DiagnosticSeverity.Error);
    expect(errors[0].message).toContain("requires a 'render:' clause");
  });

  it('reports response-format-reserved-name when a connection declares a reserved built-in format name', () => {
    // `json` is a reserved built-in — a connection may not declare it as a
    // user response format. Emitted by the ConnectionFormatsAnalyzer that also
    // builds the ownership index.
    const source = `
connection messaging:
    label: "Messaging"
    response_formats:
        json:
            description: "Shadows the built-in"
            source: "response_format://SurfaceAction__Json"
`;
    const diagnostics = runLint(source);
    const errors = diagnostics.filter(
      d => d.code === 'response-format-reserved-name'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].severity).toBe(DiagnosticSeverity.Error);
    expect(errors[0].message).toContain('json');
  });
});
