/**
 * Build LLMProvider[] and InvokableClient[] from parsed AST.
 * Mirrors _get_llm_providers() and _get_invokable_clients() in the Python adaptor.
 */

import type { LLMProvider, InvokableClient } from './service-types.js';
import type { AgentFabricCompilerContext } from './compiler-context.js';
import {
  extractNumber,
  extractString,
  iterateCollection,
  toPlainData,
} from './utils.js';

function stripConnectionPrefix(target: string | undefined): string | undefined {
  if (!target) return undefined;
  return target.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '');
}

function safeExtractString(value: unknown): string | undefined {
  const s = extractString(value);
  if (s === undefined || s === '[object Object]') return undefined;
  return normalizeQuoted(s);
}

function normalizeQuoted(s: string): string {
  let out = s.trim();
  out = out.replace(/^\\?['"]/, '');
  out = out.replace(/\\?['"]$/, '');
  return out;
}

function extractHeadersMap(
  headersValue: unknown
): Record<string, string | null> | undefined {
  const byCollection = iterateCollection(headersValue);
  if (byCollection.length > 0) {
    const out: Record<string, string | null> = {};
    for (const [headerName, headerEntry] of byCollection) {
      let headerRaw = safeExtractString(
        (headerEntry as Record<string, unknown>).__colinear ??
          (headerEntry as Record<string, unknown>).colinear
      );
      if (headerRaw === undefined) {
        const plain = toPlainData(headerEntry);
        if (
          typeof plain === 'string' ||
          typeof plain === 'number' ||
          typeof plain === 'boolean'
        ) {
          headerRaw = String(plain);
        }
      }
      out[normalizeQuoted(headerName)] = headerRaw ?? null;
    }
    return out;
  }

  if (headersValue && typeof headersValue === 'object') {
    const hv = headersValue as Record<string, unknown>;
    const rawEntries = hv.entries;
    if (Array.isArray(rawEntries)) {
      const out: Record<string, string | null> = {};
      for (const item of rawEntries) {
        if (!item || typeof item !== 'object') continue;
        const kv = item as Record<string, unknown>;
        const plainKey = toPlainData(kv.key);
        const plainValue = toPlainData(kv.value);
        const key =
          safeExtractString(kv.key) ??
          (typeof plainKey === 'string' ||
          typeof plainKey === 'number' ||
          typeof plainKey === 'boolean'
            ? String(plainKey)
            : undefined) ??
          safeExtractString(kv.name) ??
          safeExtractString(kv.__key);
        const value =
          safeExtractString(kv.value) ??
          (typeof plainValue === 'string' ||
          typeof plainValue === 'number' ||
          typeof plainValue === 'boolean'
            ? String(plainValue)
            : undefined) ??
          safeExtractString(kv.__value);
        if (key !== undefined) out[normalizeQuoted(key)] = value ?? null;
      }
      if (Object.keys(out).length > 0) return out;
    }
  }

  const plainHeaders = toPlainData(headersValue);
  if (
    plainHeaders &&
    typeof plainHeaders === 'object' &&
    !Array.isArray(plainHeaders)
  ) {
    const out: Record<string, string | null> = {};
    for (const [headerName, headerValue] of Object.entries(plainHeaders)) {
      if (headerName === 'entries' && Array.isArray(headerValue)) continue;
      out[normalizeQuoted(headerName)] =
        headerValue === null || headerValue === undefined
          ? null
          : normalizeQuoted(String(headerValue));
    }
    if (Object.keys(out).length > 0) return out;
  }

  return undefined;
}

function lowercaseHeaderKeys(
  headers: Record<string, string | null> | undefined
): Record<string, string | null> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key.toLowerCase()] = value;
  }
  return out;
}

export function buildLLMProviders(
  llmEntries: Map<string, Record<string, unknown>> | undefined,
  llmNameAliases: Map<string, string> | undefined,
  _ctx: AgentFabricCompilerContext
): LLMProvider[] {
  const providers: LLMProvider[] = [];

  if (!llmEntries) return providers;

  for (const [name, entry] of llmEntries) {
    const providerName = llmNameAliases?.get(name) ?? name;
    const kind = extractString((entry as Record<string, unknown>).kind) ?? '';
    const normalizedKind = kind.toLowerCase();

    let platform: string;
    if (normalizedKind.startsWith('openai')) {
      platform = 'openai';
    } else if (normalizedKind.startsWith('gemini')) {
      platform = 'gemini';
    } else {
      platform = normalizedKind;
    }

    const target = extractString((entry as Record<string, unknown>).target);
    const connection = stripConnectionPrefix(target);

    const headersValue = (entry as Record<string, unknown>).headers;
    const headers = lowercaseHeaderKeys(extractHeadersMap(headersValue));

    const timeout = extractNumber((entry as Record<string, unknown>).timeout);
    const apiKey = extractString((entry as Record<string, unknown>).api_key);

    const metadata: LLMProvider['metadata'] = {
      platform,
      connection,
    };
    if (headers !== undefined) metadata.headers = headers;
    if (timeout !== undefined) metadata.timeout = timeout;
    if (apiKey !== undefined) metadata.api_key = apiKey;

    providers.push({
      name: providerName,
      description: `LLM provider: ${providerName}`,
      metadata,
    });
  }

  return providers;
}

export function buildInvokableClients(
  toolDefs: Map<string, Record<string, unknown>> | undefined,
  _ctx: AgentFabricCompilerContext
): InvokableClient[] {
  const clients: InvokableClient[] = [];

  function buildToolClientBase(
    name: string,
    type: InvokableClient['type'],
    metadata: Record<string, unknown>,
    label?: string
  ): InvokableClient {
    return {
      name: `${name}-client`,
      type,
      label: label ?? name,
      metadata,
    };
  }

  function buildMcpToolClient(
    name: string,
    connection: string,
    display: { label?: string; description?: string },
    toolName?: string
  ): InvokableClient {
    const metadata: Record<string, unknown> = {
      description: display.description ?? `MCP tool: ${name}`,
      connection,
      transport: 'streamable-http',
    };
    if (toolName) metadata.tool_name = toolName;
    return buildToolClientBase(name, 'mcp_tool', metadata, display.label);
  }

  function buildA2AClient(
    name: string,
    connection: string,
    display: { label?: string; description?: string }
  ): InvokableClient {
    const metadata: Record<string, unknown> = { connection };
    if (display.description !== undefined) {
      metadata.description = display.description;
    }
    return buildToolClientBase(name, 'a2a', metadata, display.label);
  }

  if (toolDefs) {
    for (const [name, def] of toolDefs) {
      const rec = def as Record<string, unknown>;
      const kind = extractString(rec.kind);
      const target = extractString(rec.target) ?? '';
      const connection = stripConnectionPrefix(target) ?? '';
      const userLabel = extractString(rec.label);
      const userDescription = extractString(rec.description);
      const display = {
        label: userLabel,
        description: userDescription,
      };

      if (kind === 'mcp:tool') {
        const toolName = extractString(rec.tool_name);
        clients.push(buildMcpToolClient(name, connection, display, toolName));
      } else if (kind === 'a2a:send_message') {
        clients.push(buildA2AClient(name, connection, display));
      }
    }
  }

  // Always include built-in internal client
  clients.push({
    name: 'in-built',
    type: 'internal-action',
    label: 'Internal Actions',
    metadata: {
      description: 'Built-in actions for state management',
    },
  });

  return clients;
}
