/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import type { AgentDSLAuthoring } from '@agentscript/compiler';

const envRefSchema = z.object({
  kind: z.literal('env'),
  name: z.string(),
  prefix: z.string().optional(),
  default: z.string().optional(),
});

const envOrStringSchema = z.union([envRefSchema, z.string()]);

const llmProviderSchema = z.enum([
  'anthropic',
  'openai',
  'google',
  'openai-compatible',
]);

const llmFallbackSchema = z.object({
  provider: llmProviderSchema,
  model: z.string(),
  api_key: envOrStringSchema.optional(),
  base_url: envOrStringSchema.optional(),
});

const llmConfigSchema = llmFallbackSchema.extend({
  fallback: llmFallbackSchema.optional(),
});

const mcpAuthSchema = z.discriminatedUnion('strategy', [
  z.object({
    strategy: z.literal('api_key'),
    key: envOrStringSchema,
  }),
  z.object({
    strategy: z.literal('bearer'),
    key: envOrStringSchema,
  }),
  z.object({
    strategy: z.literal('none'),
  }),
]);

const mcpServerHttpSchema = z.object({
  transport: z.enum(['http', 'streamable-http']).optional(),
  url: envOrStringSchema,
  headers: z.record(z.string(), envOrStringSchema).optional(),
  auth: mcpAuthSchema.optional(),
  startupTimeoutMs: z.number().int().min(1).optional(),
  timeoutMs: z.number().int().min(1).optional(),
  enabledTools: z.array(z.string()).optional(),
  disabledTools: z.array(z.string()).optional(),
});

const mcpServerStdioSchema = z.object({
  transport: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
  startupTimeoutMs: z.number().int().min(1).optional(),
  timeoutMs: z.number().int().min(1).optional(),
  enabledTools: z.array(z.string()).optional(),
  disabledTools: z.array(z.string()).optional(),
});

const mcpServerSseSchema = z.object({
  transport: z.literal('sse'),
  url: envOrStringSchema,
  headers: z.record(z.string(), envOrStringSchema).optional(),
  auth: mcpAuthSchema.optional(),
  startupTimeoutMs: z.number().int().min(1).optional(),
  timeoutMs: z.number().int().min(1).optional(),
  enabledTools: z.array(z.string()).optional(),
  disabledTools: z.array(z.string()).optional(),
});

const mcpServerSchema = z.preprocess(
  raw => {
    // Transport inference: command → stdio, url → http (default)
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
      return raw;
    const obj = raw as Record<string, unknown>;
    if ('transport' in obj) return obj;
    if (typeof obj['command'] === 'string')
      return { ...obj, transport: 'stdio' };
    // Default to http if url is present
    return obj;
  },
  z.discriminatedUnion('transport', [
    mcpServerStdioSchema,
    mcpServerSseSchema,
    mcpServerHttpSchema,
  ])
);

export const serverBlockConfigSchema = z.object({
  llm: llmConfigSchema.optional(),
  mcp: z.record(z.string(), mcpServerSchema).optional(),
  auth_token: envOrStringSchema.optional(),
  rate_limit_rpm: envOrStringSchema.optional(),
  session_store: z.enum(['memory', 'postgres']).optional(),
});

export type EnvRef = z.infer<typeof envRefSchema>;
export type ServerBlockValue = z.infer<typeof envOrStringSchema>;
export type LlmConfig = z.infer<typeof llmConfigSchema>;
export type McpServerConfig = z.infer<typeof mcpServerSchema>;
export type ServerBlockConfig = z.infer<typeof serverBlockConfigSchema>;

export type AgentDSLAuthoringWithServerBlock = AgentDSLAuthoring & {
  server?: ServerBlockConfig;
};

export type EnvSource = Readonly<Record<string, string | undefined>>;

export function resolveServerBlockValue(
  value: ServerBlockValue | undefined,
  env: EnvSource,
  fieldPath: string
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') return value;
  return resolveEnvRef(value, env, fieldPath);
}

function resolveEnvRef(ref: EnvRef, env: EnvSource, fieldPath: string): string {
  const raw = env[ref.name];
  if (raw === undefined || raw === '') {
    if (ref.default !== undefined) {
      return ref.prefix ? ref.prefix + ref.default : ref.default;
    }
    throw new Error(
      `Environment variable "${ref.name}" required by ${fieldPath} is not set.`
    );
  }
  return ref.prefix ? ref.prefix + raw : raw;
}

export interface ResolvedLlmConfig {
  provider: LlmConfig['provider'];
  model: string;
  apiKey?: string;
  baseUrl?: string;
  fallback?: Omit<ResolvedLlmConfig, 'fallback'>;
}

export function resolveLlmConfig(
  llm: LlmConfig,
  env: EnvSource
): ResolvedLlmConfig {
  const resolved: ResolvedLlmConfig = {
    provider: llm.provider,
    model: llm.model,
    apiKey: resolveServerBlockValue(llm.api_key, env, 'server.llm.api_key'),
    baseUrl: resolveServerBlockValue(llm.base_url, env, 'server.llm.base_url'),
  };
  if (llm.fallback) {
    resolved.fallback = {
      provider: llm.fallback.provider,
      model: llm.fallback.model,
      apiKey: resolveServerBlockValue(
        llm.fallback.api_key,
        env,
        'server.llm.fallback.api_key'
      ),
      baseUrl: resolveServerBlockValue(
        llm.fallback.base_url,
        env,
        'server.llm.fallback.base_url'
      ),
    };
  }
  return resolved;
}

export function walkEnvRefs(serverBlock: {
  llm?: LlmConfig;
  mcp?: Record<string, McpServerConfig>;
  auth_token?: ServerBlockValue;
  rate_limit_rpm?: ServerBlockValue;
}): Array<{ name: string; path: string }> {
  const refs: Array<{ name: string; path: string }> = [];
  const collect = (value: ServerBlockValue | undefined, path: string) => {
    if (value && typeof value === 'object' && value.kind === 'env') {
      refs.push({ name: value.name, path });
    }
  };

  if (serverBlock.llm) {
    collect(serverBlock.llm.api_key, 'server.llm.api_key');
    collect(serverBlock.llm.base_url, 'server.llm.base_url');
    if (serverBlock.llm.fallback) {
      collect(serverBlock.llm.fallback.api_key, 'server.llm.fallback.api_key');
      collect(
        serverBlock.llm.fallback.base_url,
        'server.llm.fallback.base_url'
      );
    }
  }
  if (serverBlock.mcp) {
    for (const [name, mcpServer] of Object.entries(serverBlock.mcp)) {
      // Only collect url for http/sse transports (stdio doesn't have url)
      if ('url' in mcpServer && mcpServer.url) {
        collect(mcpServer.url as ServerBlockValue, `server.mcp.${name}.url`);
      }
      // Only collect auth for http/sse transports
      if (
        'auth' in mcpServer &&
        mcpServer.auth &&
        mcpServer.auth.strategy !== 'none'
      ) {
        collect(mcpServer.auth.key, `server.mcp.${name}.auth.key`);
      }
      // Only collect headers for http/sse transports
      if ('headers' in mcpServer && mcpServer.headers) {
        for (const [headerName, headerValue] of Object.entries(
          mcpServer.headers
        )) {
          collect(headerValue, `server.mcp.${name}.headers.${headerName}`);
        }
      }
    }
  }
  collect(serverBlock.auth_token, 'server.auth_token');
  collect(serverBlock.rate_limit_rpm, 'server.rate_limit_rpm');
  return refs;
}

const ENV_CALL = /^env\s*\(\s*([A-Z][A-Z0-9_]*)\s*(?:,\s*(.*?))?\s*\)$/;
const KW_ARG = /(prefix|default)\s*=\s*"((?:[^"\\]|\\.)*)"/g;

export function parseServerBlockValue(raw: string): ServerBlockValue {
  const trimmed = raw.trim();
  const match = trimmed.match(ENV_CALL);
  if (!match) return raw;
  const name = match[1]!;
  const opts = match[2] ?? '';
  const ref: EnvRef = { kind: 'env', name };
  for (const m of opts.matchAll(KW_ARG)) {
    const value = m[2]!.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    if (m[1] === 'prefix') ref.prefix = value;
    else if (m[1] === 'default') ref.default = value;
  }
  return ref;
}

function normalizeEnvRefs(value: unknown): unknown {
  if (typeof value === 'string') return parseServerBlockValue(value);
  if (Array.isArray(value)) return value.map(normalizeEnvRefs);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = normalizeEnvRefs(v);
    }
    return out;
  }
  return value;
}

/**
 * Extract and parse the optional `server:` block from `.agent` source.
 * The runtime parses the block directly from YAML rather than relying on the
 * compiler/dialect output, because dialect schemas strip unknown top-level
 * keys before compilation.
 */
export function parseServerBlockFromSource(
  source: string
): ServerBlockConfig | undefined {
  const lines = source.split('\n');
  const startIdx = lines.findIndex(line => /^server:\s*$/.test(line));
  if (startIdx < 0) return undefined;
  const captured: string[] = ['server:'];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '') {
      captured.push(line);
      continue;
    }
    if (/^\S/.test(line)) break;
    captured.push(line);
  }
  let raw: unknown;
  try {
    raw = parseYaml(captured.join('\n'));
  } catch {
    return undefined;
  }
  if (!raw || typeof raw !== 'object') return undefined;
  const block = (raw as { server?: unknown }).server;
  if (!block || typeof block !== 'object') return undefined;
  const normalized = normalizeEnvRefs(block);
  const result = serverBlockConfigSchema.safeParse(normalized);
  return result.success ? result.data : undefined;
}
