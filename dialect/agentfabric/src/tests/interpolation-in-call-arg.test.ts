/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { parseAndLintSource } from './test-utils.js';

function getDiagnostics(source: string) {
  const result = parseAndLintSource(source);
  return result.diagnostics.filter(d => d.code === 'interpolation-in-call-arg');
}

describe('interpolation-in-call-arg rule', () => {
  it('warns about interpolation syntax in a quoted string argument', () => {
    const diags = getDiagnostics(`
trigger t:
  kind: "a2a"
  target: "brokers://my-agent/a2a"
  on_message: -> transition to @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: a2a.message(a2a.textPart("Response: {!@echo.done.input}"))
`);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe(2); // Warning
    expect(diags[0].message).toContain(
      'String interpolation ({!...}) does not work inside function arguments'
    );
    expect(diags[0].message).toContain('"..." + @echo.done.input');
  });

  it('allows string concatenation in a function argument', () => {
    const diags = getDiagnostics(`
trigger t:
  kind: "a2a"
  target: "brokers://my-agent/a2a"
  on_message: -> transition to @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: a2a.message(a2a.textPart("Response: " + @echo.done.input))
`);
    expect(diags).toHaveLength(0);
  });

  it('allows plain string literal in a function argument', () => {
    const diags = getDiagnostics(`
trigger t:
  kind: "a2a"
  target: "brokers://my-agent/a2a"
  on_message: -> transition to @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: a2a.message(a2a.textPart("hello world"))
`);
    expect(diags).toHaveLength(0);
  });

  it('allows string without interpolation pattern', () => {
    const diags = getDiagnostics(`
trigger t:
  kind: "a2a"
  target: "brokers://my-agent/a2a"
  on_message: -> transition to @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: a2a.message(a2a.textPart("just some {curly} braces"))
`);
    expect(diags).toHaveLength(0);
  });

  it('flags interpolation in nested function call arguments', () => {
    const diags = getDiagnostics(`
trigger t:
  kind: "a2a"
  target: "brokers://my-agent/a2a"
  on_message: -> transition to @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: a2a.message(a2a.textPart("Result: {!@orchestrator.main.output}"))
`);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('"..." + @orchestrator.main.output');
  });
});
