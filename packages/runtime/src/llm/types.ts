/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

export interface TextMsg {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ToolCallMsg {
  role: 'assistant';
  content: '';
  tool_calls: ToolCall[];
}

export interface ToolResultMsg {
  role: 'tool';
  tool_call_id: string;
  /** Name of the tool this result belongs to. Required by AI SDK v5. */
  tool_name: string;
  content: string;
  /**
   * True when `content` represents a tool failure (thrown error, unknown tool)
   * rather than a successful result. Lets a driver tag the provider payload as
   * an error (e.g. AI SDK's `{ type: 'error-json' }`) so the model can tell a
   * failure from a success payload that merely contains an `error` field.
   */
  is_error?: boolean;
}

export type Msg = TextMsg | ToolCallMsg | ToolResultMsg;

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolDef {
  name: string;
  description?: string;
  /** JSON-Schema for the tool's input. The driver is responsible for adapting to the SDK. */
  inputSchema: Record<string, unknown>;
}

/** Token counts reported by a provider for one LLM step. */
export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export type StepEvent =
  | { kind: 'text-delta'; text: string }
  | { kind: 'reasoning-delta'; text: string }
  | { kind: 'tool-call'; call: ToolCall; parseFailed?: boolean }
  | { kind: 'usage'; usage: TokenUsage; model?: string }
  | { kind: 'finish'; reason: 'stop' | 'tool-calls' | 'length' | 'other' };

export interface LlmStepInput {
  system: string;
  messages: Msg[];
  tools: ToolDef[];
  signal?: AbortSignal;
  /** When set, instructs the LLM to respond in a structured format (native JSON mode). */
  responseFormat?: {
    type: 'json_schema';
    json_schema: {
      name: string;
      schema: Record<string, unknown>;
      strict: boolean;
    };
  };
}

export interface LlmDriver {
  step(input: LlmStepInput): AsyncIterable<StepEvent>;
}
