/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * billing compilation tests — the billing block nested in config is extracted
 * and compiled into agent_version.billing (billing mode is version-specific, so
 * the DSL places it on agent_version rather than global_configuration). The
 * dialect surface uses the exact agent-dsl `billingMode` enum values, so the
 * mode passes through to AgentJSON unchanged.
 */
import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import { parseSource } from './test-utils.js';

describe('billing: compilation', () => {
  it('should compile billing with mode: OUTCOME_BASED', () => {
    const source = `
config:
    developer_name: "test_agent"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"
    billing:
        mode: "OUTCOME_BASED"

start_agent main:
    description: "Test agent"
`;
    const { output } = compile(parseSource(source));
    expect(output.agent_version.billing).toEqual({
      mode: 'OUTCOME_BASED',
    });
  });

  it('should compile billing with mode: ACTION_BASED', () => {
    const source = `
config:
    developer_name: "test_agent"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"
    billing:
        mode: "ACTION_BASED"

start_agent main:
    description: "Test agent"
`;
    const { output } = compile(parseSource(source));
    expect(output.agent_version.billing).toEqual({
      mode: 'ACTION_BASED',
    });
  });

  it('should not include billing when omitted from config', () => {
    const source = `
config:
    developer_name: "test_agent"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

start_agent main:
    description: "Test agent"
`;
    const { output } = compile(parseSource(source));
    expect(output.agent_version.billing).toBeUndefined();
  });

  it('should omit billing when mode is invalid', () => {
    const source = `
config:
    developer_name: "test_agent"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"
    billing:
        mode: "outcome_based"

start_agent main:
    description: "Test agent"
`;
    const { output } = compile(parseSource(source));
    // The compiler only accepts the exact agent-dsl casing; lowercase is rejected.
    expect(output.agent_version.billing).toBeUndefined();
  });

  it('should omit billing when mode is missing', () => {
    const source = `
config:
    developer_name: "test_agent"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"
    billing:
        description: "no mode here"

start_agent main:
    description: "Test agent"
`;
    const { output } = compile(parseSource(source));
    expect(output.agent_version.billing).toBeUndefined();
  });

  it('should compile billing alongside other config fields', () => {
    const source = `
config:
    developer_name: "customer_support"
    agent_label: "Customer Support Agent"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "support@example.com"
    enable_enhanced_event_logs: True
    billing:
        mode: "OUTCOME_BASED"

system:
    instructions: "You are a customer service agent."

start_agent main:
    description: "Main service agent"
`;
    const { output } = compile(parseSource(source));

    expect(output.global_configuration.developer_name).toBe('customer_support');
    expect(output.global_configuration.enable_enhanced_event_logs).toBe(true);
    expect(output.agent_version.billing).toEqual({
      mode: 'OUTCOME_BASED',
    });
  });
});
