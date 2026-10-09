/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type {
  McpServerHttpSettings,
  McpServerStdioSettings,
  McpServerSseSettings,
} from '../src/index.js';

describe('MCP Transport Types', () => {
  it('accepts HTTP settings with transport', () => {
    const settings: McpServerHttpSettings = {
      transport: 'http',
      url: 'http://localhost:3000',
      headers: { authorization: 'Bearer token' },
      timeoutMs: 5000,
      startupTimeoutMs: 10000,
      enabledTools: ['tool1', 'tool2'],
      disabledTools: ['tool3'],
    };
    expect(settings.transport).toBe('http');
    expect(settings.url).toBe('http://localhost:3000');
  });

  it('accepts HTTP settings without explicit transport (defaults to http)', () => {
    const settings: McpServerHttpSettings = {
      url: 'http://localhost:3000',
      timeoutMs: 5000,
    };
    expect(settings.url).toBe('http://localhost:3000');
  });

  it('accepts stdio settings', () => {
    const settings: McpServerStdioSettings = {
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { NODE_ENV: 'test' },
      cwd: '/app',
      timeoutMs: 5000,
      startupTimeoutMs: 10000,
      enabledTools: ['tool1'],
    };
    expect(settings.transport).toBe('stdio');
    expect(settings.command).toBe('node');
    expect(settings.args).toEqual(['server.js']);
  });

  it('accepts SSE settings', () => {
    const settings: McpServerSseSettings = {
      transport: 'sse',
      url: 'http://localhost:3000/sse',
      headers: { authorization: 'Bearer token' },
      timeoutMs: 5000,
      disabledTools: ['tool3'],
    };
    expect(settings.transport).toBe('sse');
    expect(settings.url).toBe('http://localhost:3000/sse');
  });
});
