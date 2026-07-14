/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * file_upload compilation tests — tests that file_upload block nested in config
 * is properly extracted and compiled into global_configuration.
 */
import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import { parseSource } from './test-utils.js';

describe('file_upload: compilation', () => {
  it('should compile file_upload with mode: auto', () => {
    const source = `
config:
    developer_name: "test_agent"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"
    file_upload:
        mode: "auto"

start_agent main:
    description: "Test agent"
`;
    const { output } = compile(parseSource(source));
    expect(output.global_configuration.file_upload).toEqual({
      mode: 'auto',
    });
  });

  it('should compile file_upload with mode: managed', () => {
    const source = `
config:
    developer_name: "test_agent"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"
    file_upload:
        mode: "managed"

start_agent main:
    description: "Test agent"
`;
    const { output } = compile(parseSource(source));
    expect(output.global_configuration.file_upload).toEqual({
      mode: 'managed',
    });
  });

  it('should compile file_upload with mode: disabled', () => {
    const source = `
config:
    developer_name: "test_agent"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"
    file_upload:
        mode: "disabled"

start_agent main:
    description: "Test agent"
`;
    const { output } = compile(parseSource(source));
    expect(output.global_configuration.file_upload).toEqual({
      mode: 'disabled',
    });
  });

  it('should compile file_upload with mode: error', () => {
    const source = `
config:
    developer_name: "test_agent"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"
    file_upload:
        mode: "error"

start_agent main:
    description: "Test agent"
`;
    const { output } = compile(parseSource(source));
    expect(output.global_configuration.file_upload).toEqual({
      mode: 'error',
    });
  });

  it('should compile file_upload with mode and message', () => {
    const source = `
config:
    developer_name: "test_agent"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"
    file_upload:
        mode: "error"
        message: "This agent doesn't accept attachments. Please paste the text instead."

start_agent main:
    description: "Test agent"
`;
    const { output } = compile(parseSource(source));
    expect(output.global_configuration.file_upload).toEqual({
      mode: 'error',
      message:
        "This agent doesn't accept attachments. Please paste the text instead.",
    });
  });

  it('should compile file_upload with mode: disabled and message', () => {
    const source = `
config:
    developer_name: "test_agent"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"
    file_upload:
        mode: "disabled"
        message: "Files are not supported"

start_agent main:
    description: "Test agent"
`;
    const { output } = compile(parseSource(source));
    expect(output.global_configuration.file_upload).toEqual({
      mode: 'disabled',
      message: 'Files are not supported',
    });
  });

  it('should omit message when not provided', () => {
    const source = `
config:
    developer_name: "test_agent"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"
    file_upload:
        mode: "managed"

start_agent main:
    description: "Test agent"
`;
    const { output } = compile(parseSource(source));
    expect(output.global_configuration.file_upload).toEqual({
      mode: 'managed',
    });
    expect(output.global_configuration.file_upload?.message).toBeUndefined();
  });

  it('should not include file_upload when omitted from config', () => {
    const source = `
config:
    developer_name: "test_agent"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"

start_agent main:
    description: "Test agent"
`;
    const { output } = compile(parseSource(source));
    expect(output.global_configuration.file_upload).toBeUndefined();
  });

  it('should omit file_upload when mode is invalid', () => {
    const source = `
config:
    developer_name: "test_agent"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"
    file_upload:
        mode: "invalid_mode"

start_agent main:
    description: "Test agent"
`;
    const { output } = compile(parseSource(source));
    // Should not include file_upload in output when mode is invalid
    expect(output.global_configuration.file_upload).toBeUndefined();
  });

  it('should omit file_upload when mode is missing', () => {
    const source = `
config:
    developer_name: "test_agent"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"
    file_upload:
        message: "No files allowed"

start_agent main:
    description: "Test agent"
`;
    const { output } = compile(parseSource(source));
    // Should not include file_upload in output when mode is missing
    expect(output.global_configuration.file_upload).toBeUndefined();
  });

  it('should compile file_upload alongside other config fields', () => {
    const source = `
config:
    developer_name: "customer_support"
    agent_label: "Customer Support Agent"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "support@example.com"
    enable_enhanced_event_logs: True
    file_upload:
        mode: "managed"
        message: "Files must be referenced to be visible"

system:
    instructions: "You are a customer service agent."

start_agent main:
    description: "Main service agent"
`;
    const { output } = compile(parseSource(source));

    expect(output.global_configuration.developer_name).toBe('customer_support');
    expect(output.global_configuration.enable_enhanced_event_logs).toBe(true);
    expect(output.global_configuration.file_upload).toEqual({
      mode: 'managed',
      message: 'Files must be referenced to be visible',
    });
  });
});
