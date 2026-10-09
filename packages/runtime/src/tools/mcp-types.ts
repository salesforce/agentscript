/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tool description returned by an MCP server's `tools/list` call.
 * Mirrors the MCP 2024-11-05 schema.
 */
export interface McpToolDef {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/**
 * Resolved MCP server settings consumed by the Node adapter. The compiler IR
 * uses `EnvRef | string` for `url` / `headers`; the server package resolves
 * env-vars before handing values to the runtime, so the runtime stays free of
 * compiler / env-ref types.
 */
export type McpServerSettings =
  | McpServerHttpSettings
  | McpServerStdioSettings
  | McpServerSseSettings;

export interface McpServerHttpSettings {
  transport?: 'http' | 'streamable-http';
  /** Endpoint URL — already env-resolved. */
  url: string;
  /** Extra HTTP headers — already env-resolved. */
  headers?: Record<string, string>;
  /** Startup timeout in milliseconds (defaults to 30s). */
  startupTimeoutMs?: number;
  /** Per-call timeout in milliseconds (defaults to 30s). */
  timeoutMs?: number;
  /** Tool filtering. */
  enabledTools?: string[];
  disabledTools?: string[];
}

export interface McpServerStdioSettings {
  transport: 'stdio';
  /** Command to spawn. */
  command: string;
  /** Optional command arguments. */
  args?: string[];
  /** Optional environment variables for the child process. */
  env?: Record<string, string>;
  /** Optional working directory for the child process. */
  cwd?: string;
  /** Startup timeout in milliseconds (defaults to 30s). */
  startupTimeoutMs?: number;
  /** Per-call timeout in milliseconds (defaults to 30s). */
  timeoutMs?: number;
  /** Tool filtering. */
  enabledTools?: string[];
  disabledTools?: string[];
}

export interface McpServerSseSettings {
  transport: 'sse';
  /** Endpoint URL — already env-resolved. */
  url: string;
  /** Extra HTTP headers — already env-resolved. */
  headers?: Record<string, string>;
  /** Startup timeout in milliseconds (defaults to 30s). */
  startupTimeoutMs?: number;
  /** Per-call timeout in milliseconds (defaults to 30s). */
  timeoutMs?: number;
  /** Tool filtering. */
  enabledTools?: string[];
  disabledTools?: string[];
}

export const MCP_DEFAULT_TIMEOUT_MS = 30_000;
