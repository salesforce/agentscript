/* eslint-disable no-console */
/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared test harness for gateway model validation.
 *
 * Design principles:
 * - All tool outputs are hard-coded and deterministic
 * - Tools can have configurable delays (setTimeout) to simulate latency
 * - Assertions check structural behavior, NOT text content
 * - Works with any OpenAI-compatible gateway
 * - Reports PASS/FAIL per assertion with clear diagnostics
 *
 * Exports:
 *   createGatewayConfig   - reads env vars and returns OpenAI-compatible config
 *   createLlmDriver       - creates a VercelAiSdkDriver from a GatewayConfig
 *   createTestAgent        - compiles inline .agent source and builds a Runtime
 *   runTurn               - runs a single turn and captures events
 *   mockTool              - creates delayed mock tools in a ToolRegistry
 *   assertions            - structural assertion helpers
 *   report                - prints pass/fail summary and exits with correct code
 *
 * Run tests:
 *   pnpm exec tsx packages/runtime-vercel/examples/gateway-tests/<test-script>.ts
 */

import { generateText, jsonSchema } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

import {
  Runtime,
  ToolRegistry,
  FnAdapter,
  AbortError,
  type RuntimeOptions,
  type TurnResult,
  type TurnOptions,
  type RuntimeEvent,
  type Middleware,
  type Guardrail,
  type ExhaustionPolicy,
  type LlmDriver,
  type ParallelDispatchOptions,
} from '@agentscript/runtime';
import {
  compileSource,
  VercelAiSdkDriver,
  type GenerateTextFn,
} from '@agentscript/runtime-vercel';
import type { AgentDSLAuthoring } from '@agentscript/compiler';

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

/** Configuration for connecting to an OpenAI-compatible LLM gateway. */
export interface GatewayConfig {
  /** Base URL for the gateway (must serve OpenAI-compatible /v1 endpoints). */
  baseURL: string;
  /** API key or bearer token. */
  apiKey: string;
  /** Model identifier (e.g. "claude-haiku-4-5-20251001"). */
  model: string;
}

/** Result of runTurn(), combining turn result with captured events. */
export interface TurnCapture {
  result: TurnResult;
  events: RuntimeEvent[];
  durationMs: number;
}

/** Options for the mockTool helper. */
export interface MockToolSpec {
  /** Artificial delay in ms before returning the response. */
  delayMs?: number;
  /** Hard-coded response object to return. */
  result: Record<string, unknown>;
}

/** A single assertion result, tracked internally for report(). */
export interface AssertionResultEntry {
  /** Human-readable label for this assertion. */
  label: string;
  /** Whether the assertion passed. */
  passed: boolean;
  /** Diagnostic message (always set on failure, optional on success). */
  detail?: string;
}

// ---------------------------------------------------------------------------
// 1. createGatewayConfig
// ---------------------------------------------------------------------------

/**
 * Reads gateway configuration from environment variables. Supports two
 * naming conventions:
 *
 * Convention A (Anthropic gateway):
 *   ANTHROPIC_BEDROCK_BASE_URL  - Gateway root (we strip /bedrock and use /v1)
 *   ANTHROPIC_AUTH_TOKEN         - Bearer token
 *
 * Convention B (generic):
 *   LLM_GATEWAY_URL             - Base URL (already /v1)
 *   LLM_GATEWAY_API_KEY         - API key
 *   LLM_GATEWAY_MODEL           - Model identifier
 *
 * Exits with a helpful error message if neither convention is satisfied.
 */
export function createGatewayConfig(): GatewayConfig {
  // Convention A
  const bedrockBase = process.env.ANTHROPIC_BEDROCK_BASE_URL;
  const bedrockToken = process.env.ANTHROPIC_AUTH_TOKEN;
  if (bedrockBase && bedrockToken) {
    const baseURL = bedrockBase.replace(/\/bedrock$/, '') + '/v1';
    const model =
      process.env.LLM_GATEWAY_MODEL ??
      process.env.GATEWAY_MODEL ??
      'claude-haiku-4-5-20251001';
    return { baseURL, apiKey: bedrockToken, model };
  }

  // Convention B
  const genericURL = process.env.LLM_GATEWAY_URL;
  const genericKey = process.env.LLM_GATEWAY_API_KEY;
  const genericModel = process.env.LLM_GATEWAY_MODEL;
  if (genericURL && genericKey && genericModel) {
    return { baseURL: genericURL, apiKey: genericKey, model: genericModel };
  }

  const missing: string[] = [];
  if (!bedrockBase && !genericURL) {
    missing.push('ANTHROPIC_BEDROCK_BASE_URL or LLM_GATEWAY_URL');
  }
  if (!bedrockToken && !genericKey) {
    missing.push('ANTHROPIC_AUTH_TOKEN or LLM_GATEWAY_API_KEY');
  }
  if (!genericModel && !bedrockBase) {
    missing.push('LLM_GATEWAY_MODEL');
  }

  console.error(
    `Missing required environment variable(s): ${missing.join(', ')}\n\n` +
      'Set them before running:\n' +
      '  export LLM_GATEWAY_URL="https://your-gateway.example.com/v1"\n' +
      '  export LLM_GATEWAY_API_KEY="your-api-key"\n' +
      '  export LLM_GATEWAY_MODEL="claude-haiku-4-5-20251001"\n'
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. createLlmDriver
// ---------------------------------------------------------------------------

/**
 * Creates a VercelAiSdkDriver backed by the given gateway config.
 * This is the bridge between the Vercel AI SDK and the AgentScript Runtime.
 */
export function createLlmDriver(cfg: GatewayConfig): LlmDriver {
  const openai = createOpenAI({ baseURL: cfg.baseURL, apiKey: cfg.apiKey });
  return new VercelAiSdkDriver({
    model: openai.chat(cfg.model),
    generateText: generateText as unknown as GenerateTextFn,
    jsonSchema: jsonSchema as unknown as (
      s: Record<string, unknown>
    ) => unknown,
  });
}

// ---------------------------------------------------------------------------
// 3. compile
// ---------------------------------------------------------------------------

/**
 * Compiles inline .agent source and returns the AgentDSL document.
 * Throws on compilation errors (ignoring known benign diagnostics).
 */
export function compile(source: string): AgentDSLAuthoring {
  const { output, diagnostics } = compileSource(source);
  const errors = diagnostics.filter(
    d => d.severity === 1 && d.code !== 'invalid-action-target'
  );
  if (errors.length > 0) {
    console.error('Compile errors:');
    for (const e of errors) {
      console.error(`  - [${e.code}] ${e.message}`);
    }
    throw new Error(`Compilation failed with ${errors.length} error(s)`);
  }
  return output;
}

// ---------------------------------------------------------------------------
// 4. createTestAgent
// ---------------------------------------------------------------------------

/**
 * Creates a full Runtime with support for middleware, guardrails, and all
 * runtime options. Uses the lower-level Runtime class (not the high-level
 * createAgent from runtime-vercel) to enable direct access to middleware
 * and guardrail configuration.
 */
export interface TestAgentOptions {
  source: string;
  tools: ToolRegistry;
  middleware?: Middleware[];
  guardrails?: Guardrail[];
  exhaustionPolicy?: ExhaustionPolicy;
  maxStepsPerTurn?: number;
  signal?: AbortSignal;
  llmDriver: LlmDriver;
  /** Parallel tool dispatch configuration. */
  parallel?: ParallelDispatchOptions;
}

export function createTestAgent(opts: TestAgentOptions): Runtime {
  const doc = compile(opts.source);
  const rtOpts: RuntimeOptions = {
    doc,
    llm: opts.llmDriver,
    tools: opts.tools,
    maxStepsPerTurn: opts.maxStepsPerTurn ?? 10,
    middleware: opts.middleware,
    guardrails: opts.guardrails,
    exhaustionPolicy: opts.exhaustionPolicy,
    signal: opts.signal,
    parallel: opts.parallel,
  };
  return new Runtime(rtOpts);
}

// ---------------------------------------------------------------------------
// 5. runTurn
// ---------------------------------------------------------------------------

/**
 * Runs a single turn on a Runtime instance, capturing all emitted events
 * and measuring wall-clock duration.
 */
export async function runTurn(
  runtime: Runtime,
  userInput: string,
  opts?: TurnOptions
): Promise<TurnCapture> {
  const events: RuntimeEvent[] = [];
  const off = runtime.on(e => events.push(e));
  const start = Date.now();
  try {
    const result = await runtime.turn(userInput, opts);
    const durationMs = Date.now() - start;
    return { result, events, durationMs };
  } finally {
    off();
  }
}

// ---------------------------------------------------------------------------
// 6. mockTool
// ---------------------------------------------------------------------------

/**
 * Creates a ToolRegistry with one or more mock tools. Each tool returns
 * a hard-coded response after an optional delay.
 *
 * @param specs - Map of tool names to { delayMs?, result }
 * @returns ToolRegistry and a callLog that records every invocation
 */
export function mockTool(specs: Record<string, MockToolSpec>): {
  tools: ToolRegistry;
  callLog: Array<{ name: string; args: unknown; timestamp: number }>;
} {
  const fn = new FnAdapter();
  const callLog: Array<{ name: string; args: unknown; timestamp: number }> = [];

  for (const [name, spec] of Object.entries(specs)) {
    fn.register(name, async (args: Record<string, unknown>) => {
      callLog.push({ name, args, timestamp: Date.now() });
      if (spec.delayMs && spec.delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, spec.delayMs));
      }
      return spec.result;
    });
  }

  const tools = new ToolRegistry();
  tools.register('fn', fn);
  return { tools, callLog };
}

// ---------------------------------------------------------------------------
// 7. assertions
// ---------------------------------------------------------------------------

const assertionResults: AssertionResultEntry[] = [];

/**
 * Structural assertion helpers. Each method records the result internally
 * and prints PASS/FAIL immediately. Call report() at the end to summarize.
 */
export const assertions = {
  /** Generic boolean assertion. */
  ok(condition: boolean, label: string, detail?: string): void {
    assertionResults.push({ label, passed: condition, detail });
    const icon = condition ? 'PASS' : 'FAIL';
    const detailStr = detail ? ` (${detail})` : '';
    console.log(`  [${icon}] ${label}${detailStr}`);
  },

  /** Strict equality assertion. */
  eq<T>(actual: T, expected: T, label: string): void {
    const passed = actual === expected;
    const detail = passed
      ? undefined
      : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`;
    assertions.ok(passed, label, detail);
  },

  /** Assert actual >= min. */
  gte(actual: number, min: number, label: string): void {
    const passed = actual >= min;
    const detail = passed ? undefined : `expected >= ${min}, got ${actual}`;
    assertions.ok(passed, label, detail);
  },

  /** Assert actual < max. */
  lt(actual: number, max: number, label: string): void {
    const passed = actual < max;
    const detail = passed ? undefined : `expected < ${max}, got ${actual}`;
    assertions.ok(passed, label, detail);
  },

  /** Assert value is truthy. */
  truthy(value: unknown, label: string): void {
    assertions.ok(Boolean(value), label, value ? undefined : 'was falsy');
  },

  /** Assert that an async function throws. Returns the caught error. */
  async throwsAsync(
    fn: () => Promise<unknown>,
    label: string
  ): Promise<Error | undefined> {
    try {
      await fn();
      assertions.ok(false, label, 'did not throw');
      return undefined;
    } catch (e) {
      assertions.ok(true, label);
      return e as Error;
    }
  },

  /** Assert value is an instance of the given constructor. */
  instanceOf(
    value: unknown,
    ctor: new (...a: never[]) => unknown,
    label: string
  ): void {
    assertions.ok(
      value instanceof ctor,
      label,
      `got ${(value as Error)?.constructor?.name ?? typeof value}`
    );
  },
};

// ---------------------------------------------------------------------------
// 8. report
// ---------------------------------------------------------------------------

/**
 * Prints a summary of all recorded assertions and exits the process.
 * Exit code 0 if all passed, 1 if any failed.
 */
export function report(suiteName: string): void {
  const total = assertionResults.length;
  const passed = assertionResults.filter(r => r.passed).length;
  const failed = total - passed;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`${suiteName}: ${passed}/${total} passed, ${failed} failed`);
  console.log('='.repeat(60));

  if (failed > 0) {
    console.log('\nFailed assertions:');
    for (const r of assertionResults.filter(r => !r.passed)) {
      console.log(`  - ${r.label}${r.detail ? ': ' + r.detail : ''}`);
    }
    process.exit(1);
  } else {
    console.log('\nAll assertions passed.');
    process.exit(0);
  }
}

// Re-export useful types and classes for test scripts
export { AbortError, ToolRegistry };
export type {
  TurnResult,
  RuntimeEvent,
  Middleware,
  Guardrail,
  LlmDriver,
  ParallelDispatchOptions,
};
