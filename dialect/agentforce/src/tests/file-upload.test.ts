/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { parseDocument, parseWithDiagnostics } from './test-utils.js';
import { DiagnosticSeverity } from '@agentscript/language';

// ============================================================================
// file_upload nested inside config block
// ============================================================================

describe('file_upload in config block', () => {
  it('parses file_upload block structure', () => {
    const source = `
config:
    developer_name: "test_agent"
    file_upload:
        mode: "auto"
`.trimStart();

    const ast = parseDocument(source);
    const config = ast.config as Record<string, unknown>;
    const fileUpload = config.file_upload as Record<string, unknown>;

    expect(fileUpload).toBeDefined();
    expect(fileUpload.__kind).toBe('FileUploadConfig');
    expect(fileUpload.mode).toBeDefined();
  });

  it('parses file_upload with message', () => {
    const source = `
config:
    developer_name: "test_agent"
    file_upload:
        mode: "error"
        message: "This agent doesn't accept attachments."
`.trimStart();

    const ast = parseDocument(source);
    const config = ast.config as Record<string, unknown>;
    const fileUpload = config.file_upload as Record<string, unknown>;

    expect(fileUpload).toBeDefined();
    expect(fileUpload.mode).toBeDefined();
    expect(fileUpload.message).toBeDefined();
  });

  it('parses file_upload with message: None', () => {
    const source = `
config:
    developer_name: "test_agent"
    file_upload:
        mode: "error"
        message: None
`.trimStart();

    const ast = parseDocument(source);
    const config = ast.config as Record<string, unknown>;
    const fileUpload = config.file_upload as Record<string, unknown>;

    const message = fileUpload.message as { __kind: string };
    expect(message.__kind).toBe('NoneLiteral');
  });

  it('parses file_upload within complete agent definition', () => {
    const source = `
config:
    developer_name: "customer_support"
    agent_type: "AgentforceServiceAgent"
    file_upload:
        mode: "managed"

system:
    instructions: "You are a customer service agent."

start_agent ServiceAgent:
    description: "Main service topic"
`.trimStart();

    const ast = parseDocument(source);

    expect(ast.config).toBeDefined();
    expect(ast.system).toBeDefined();
    expect(ast.start_agent).toBeDefined();

    const config = ast.config as Record<string, unknown>;
    const fileUpload = config.file_upload as Record<string, unknown>;

    expect(fileUpload).toBeDefined();
    expect(fileUpload.__kind).toBe('FileUploadConfig');
  });

  it('produces no errors for valid file_upload block', () => {
    const source = `
config:
    developer_name: "test_agent"
    file_upload:
        mode: "auto"
`.trimStart();

    const { diagnostics } = parseWithDiagnostics(source);
    const errors = diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(errors).toHaveLength(0);
  });

  it('produces no errors for file_upload with message', () => {
    const source = `
config:
    developer_name: "test_agent"
    file_upload:
        mode: "error"
        message: "No files allowed"
`.trimStart();

    const { diagnostics } = parseWithDiagnostics(source);
    const errors = diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(errors).toHaveLength(0);
  });
});

// ============================================================================
// file_upload omitted (should work without it)
// ============================================================================

describe('file_upload optional', () => {
  it('parses config without file_upload block', () => {
    const source = `
config:
    developer_name: "test_agent"
    agent_type: "AgentforceServiceAgent"
`.trimStart();

    const ast = parseDocument(source);
    const config = ast.config as Record<string, unknown>;

    expect(config).toBeDefined();
    expect(config.file_upload).toBeUndefined();
  });

  it('produces no diagnostics when file_upload is omitted', () => {
    const source = `
config:
    developer_name: "test_agent"
`.trimStart();

    const { diagnostics } = parseWithDiagnostics(source);
    // Should have no file_upload-related errors
    const fileUploadErrors = diagnostics.filter(d =>
      d.message.toLowerCase().includes('file_upload')
    );
    expect(fileUploadErrors).toHaveLength(0);
  });
});
