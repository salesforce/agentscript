/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import { parseSource, checkSchemaConformance } from './test-utils.js';
import { DiagnosticSeverity } from '@agentscript/types';

describe('GBA: Context services', () => {
  const source = `
config:
    developer_name: "TestAgent"
    agent_type: "GoalBasedAgent"
    default_agent_user: "test_user"

context:
    memory:
        enabled: True
    salesforce:
        enabled: True
    data_cloud:
        enabled: False

start_agent main:
    description: "Entry"
`;

  it('compiles context services with correct enabled values', () => {
    const { output, diagnostics } = compile(parseSource(source));
    const errors = diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(errors).toHaveLength(0);

    expect(output.agent_version.context).toBeDefined();
    expect(output.agent_version.context.salesforce).toEqual({ enabled: true });
    expect(output.agent_version.context.data_cloud).toEqual({ enabled: false });
    expect(output.agent_version.context.memory).toEqual({ enabled: true });
  });

  it('produces schema-conformant output', () => {
    const { output } = compile(parseSource(source));
    const violations = checkSchemaConformance(output);
    expect(violations).toEqual([]);
  });

  it('reports error when context service missing required enabled field', () => {
    const invalidSource = `
config:
    developer_name: "TestAgent"
    agent_type: "GoalBasedAgent"
    default_agent_user: "test_user"

context:
    salesforce:
        auto_enabled: True

start_agent main:
    description: "Entry"
`;

    const { diagnostics } = compile(parseSource(invalidSource));
    const errors = diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );

    expect(errors.length).toBeGreaterThan(0);
    const salesforceError = errors.find(
      e =>
        e.message.toLowerCase().includes('salesforce') &&
        e.message.toLowerCase().includes('enabled')
    );
    expect(salesforceError).toBeDefined();
  });

  it('handles mixed context service configurations', () => {
    const mixedSource = `
config:
    developer_name: "TestAgent"
    agent_type: "GoalBasedAgent"
    default_agent_user: "test_user"

context:
    memory:
        enabled: False
    data_cloud:
        enabled: True

start_agent main:
    description: "Entry"
`;

    const { output, diagnostics } = compile(parseSource(mixedSource));
    const errors = diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(errors).toHaveLength(0);

    expect(output.agent_version.context.memory).toEqual({ enabled: false });
    expect(output.agent_version.context.data_cloud).toEqual({ enabled: true });
    expect(output.agent_version.context.salesforce).toBeUndefined();
  });
});
