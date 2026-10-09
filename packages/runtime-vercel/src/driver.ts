/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  LlmDriver,
  LlmStepInput,
  StepEvent,
  TokenUsage,
  Msg,
  ToolDef,
} from '@agentscript/runtime';

/**
 * Minimal structural shapes for the Vercel AI SDK. We import them as types
 * only so the runtime-vercel package doesn't hard-depend on a specific major
 * version of `ai` — users bring their own.
 */
export interface AiSdkModelLike {
  specificationVersion?: unknown;
  modelId?: string;
  provider?: string;
}

export interface VercelDriverOptions {
  /** A LanguageModel instance from `ai` (e.g. `anthropic("claude-4-5")`). */
  model: AiSdkModelLike;
  /**
   * `generateText` from `ai`. Injected to avoid a hard import so this package
   * compiles without `ai` installed.
   */
  generateText: GenerateTextFn;
  /**
   * `jsonSchema` from `@ai-sdk/provider-utils` (re-exported by `ai`). Injected
   * for the same reason. Used to wrap our internal JSON-Schema-shaped tool
   * definitions into a `FlexibleSchema` the AI SDK's `tool({ inputSchema })`
   * accepts. If omitted, we pass the raw schema through — which works on
   * some builds of `ai` but fails on others.
   */
  jsonSchema?: (schema: Record<string, unknown>) => unknown;
  /**
   * Top-level AI SDK call settings, spread verbatim onto the `generateText`
   * call: `temperature`, `maxOutputTokens` (v5; `maxTokens` in v4), `topP`,
   * `topK`, `stopSequences`, `maxRetries`, etc. See the AI SDK "Call Settings"
   * reference.
   */
  callSettings?: Record<string, unknown>;
  /**
   * Provider-specific options, forwarded under the AI SDK's dedicated
   * `providerOptions` key (v5) — e.g. `{ anthropic: { cacheControl: … } }`.
   * This is NOT where generation settings like `temperature` go; use
   * {@link VercelDriverOptions.callSettings} for those.
   */
  providerOptions?: Record<string, unknown>;
  /**
   * `streamText` from `ai`. Optional — when supplied, the driver streams the
   * model response token-by-token via `result.fullStream` instead of awaiting
   * `generateText`. The runtime forwards each `text-delta` to its event bus as
   * it arrives, so `agent.stream().textStream` yields real incremental tokens.
   * Injected (like {@link VercelDriverOptions.generateText}) to avoid a hard
   * dependency on a specific `ai` major. When omitted, the driver falls back
   * to `generateText` (one `text-delta` per step).
   */
  streamText?: StreamTextFn;
}

/** Token-usage shape accepted from either AI SDK major (v4 or v5 field names). */
export interface UsageLike {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  /** v4 field names. */
  promptTokens?: number;
  completionTokens?: number;
  /** v5-only; recorded by the provider but not yet surfaced downstream. */
  reasoningTokens?: number;
  cachedInputTokens?: number;
}

export type GenerateTextFn = (opts: {
  model: AiSdkModelLike;
  system?: string;
  messages: Array<{ role: string; content: unknown }>;
  tools?: Record<string, unknown>;
  [key: string]: unknown;
}) => Promise<{
  text: string;
  /**
   * Tool calls on v5+: `{ toolCallId, toolName, input }`.
   * Some older v4 builds used `args` instead of `input`; we handle both.
   */
  toolCalls?: Array<{
    toolCallId: string;
    toolName: string;
    input?: unknown;
    args?: unknown;
  }>;
  /**
   * Token usage for the step. AI SDK v5 reports `inputTokens`/`outputTokens`/
   * `totalTokens`; older builds used `promptTokens`/`completionTokens`. We
   * accept both shapes.
   */
  usage?: UsageLike;
  finishReason?: string;
}>;

/**
 * Structural shape of `streamText` from `ai`. We only touch `fullStream`, whose
 * parts mirror the AI SDK v5 `TextStreamPart` discriminated union (we read
 * `text-delta`, `tool-call`, `finish-step`/`finish` usage, and `error`).
 */
export type StreamTextFn = (opts: {
  model: AiSdkModelLike;
  system?: string;
  messages: Array<{ role: string; content: unknown }>;
  tools?: Record<string, unknown>;
  [key: string]: unknown;
}) => {
  fullStream: AsyncIterable<StreamTextPart>;
};

/** The subset of AI SDK v5 `TextStreamPart` variants the driver consumes. */
export type StreamTextPart =
  | { type: 'text-delta'; text: string }
  | { type: 'reasoning-delta'; text?: string; textDelta?: string }
  | { type: 'reasoning'; text?: string; textDelta?: string }
  | {
      type: 'tool-call';
      toolCallId: string;
      toolName: string;
      input?: unknown;
      args?: unknown;
    }
  | { type: 'finish-step'; usage?: UsageLike; finishReason?: string }
  | { type: 'finish'; totalUsage?: UsageLike; finishReason?: string }
  | { type: 'error'; error: unknown }
  | { type: string; [key: string]: unknown };

/**
 * Turns AgentScript runtime LLM requests into Vercel AI SDK calls. The runtime
 * owns tool execution (not the SDK), so we configure the SDK with tool
 * *definitions* (no `execute`) and feed returned tool calls back to the
 * runtime.
 *
 * By default each step is a single non-streaming `generateText` call. If a
 * `streamText` function is injected, the step instead streams the response
 * token-by-token — the runtime forwards each `text-delta` to its event bus as
 * it arrives, giving `agent.stream()` real incremental output.
 */
export class VercelAiSdkDriver implements LlmDriver {
  constructor(private readonly opts: VercelDriverOptions) {}

  step(input: LlmStepInput): AsyncIterable<StepEvent> {
    return this.opts.streamText
      ? this.streamStep(input)
      : this.generateStep(input);
  }

  private buildRequest(input: LlmStepInput): Record<string, unknown> {
    return {
      model: this.opts.model,
      system: input.system,
      messages: input.messages.map(toAiSdkMessage),
      tools: buildToolsObject(input.tools, this.opts.jsonSchema),
      ...(input.signal ? { abortSignal: input.signal } : {}),
      // Forward native structured-output (JSON schema) mode when the caller
      // requested it. The AI SDK's generateText/streamText accept an
      // `experimental_output`/`responseFormat`-shaped hint on some builds; we
      // pass the schema through under `responseFormat` so providers that honor
      // it (OpenAI JSON mode, etc.) constrain the output. Providers that don't
      // recognize the key ignore it harmlessly.
      ...(input.responseFormat
        ? {
            responseFormat: {
              type: 'json',
              schema: input.responseFormat.json_schema.schema,
              name: input.responseFormat.json_schema.name,
            },
          }
        : {}),
      ...(this.opts.callSettings ?? {}),
      ...(this.opts.providerOptions
        ? { providerOptions: this.opts.providerOptions }
        : {}),
    };
  }

  private async *generateStep(input: LlmStepInput): AsyncIterable<StepEvent> {
    const res = await this.opts.generateText(
      this.buildRequest(input) as Parameters<GenerateTextFn>[0]
    );

    const resReasoning = res as unknown as {
      reasoning?: unknown;
      reasoningText?: unknown;
    };
    const reasoning =
      typeof resReasoning.reasoningText === 'string'
        ? resReasoning.reasoningText
        : typeof resReasoning.reasoning === 'string'
          ? resReasoning.reasoning
          : undefined;
    if (reasoning) yield { kind: 'reasoning-delta', text: reasoning };
    if (res.text) yield { kind: 'text-delta', text: res.text };
    for (const call of res.toolCalls ?? []) {
      const rawInput = call.input !== undefined ? call.input : call.args;
      const { args, parseFailed } = coerceArgs(rawInput);
      yield {
        kind: 'tool-call',
        call: {
          id: call.toolCallId,
          name: call.toolName,
          arguments: args,
        },
        parseFailed,
      };
    }
    const usage = normalizeUsage(res.usage);
    if (usage) {
      yield { kind: 'usage', usage, model: this.opts.model.modelId };
    }
    yield {
      kind: 'finish',
      reason: mapFinishReason(res.finishReason),
    };
  }

  private async *streamStep(input: LlmStepInput): AsyncIterable<StepEvent> {
    const result = this.opts.streamText!(
      this.buildRequest(input) as Parameters<StreamTextFn>[0]
    );

    // The SDK reports usage on `finish-step`/`finish`; the last one we see
    // wins (a single-step generation has one of each). We defer emitting the
    // `usage` event until the stream ends so it lands just before `finish`,
    // matching the ordering of the non-streaming path.
    let usage: TokenUsage | undefined;
    let finishReason: string | undefined;

    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'text-delta': {
          const text = (part as { text?: string }).text;
          if (text) yield { kind: 'text-delta', text };
          break;
        }
        case 'reasoning':
        case 'reasoning-delta': {
          const p = part as { text?: string; textDelta?: string };
          const text = p.text ?? p.textDelta;
          if (text) yield { kind: 'reasoning-delta', text };
          break;
        }
        case 'tool-call': {
          const p = part as {
            toolCallId: string;
            toolName: string;
            input?: unknown;
            args?: unknown;
          };
          const rawInput = p.input !== undefined ? p.input : p.args;
          const { args, parseFailed } = coerceArgs(rawInput);
          yield {
            kind: 'tool-call',
            call: {
              id: p.toolCallId,
              name: p.toolName,
              arguments: args,
            },
            parseFailed,
          };
          break;
        }
        case 'finish-step': {
          const u = normalizeUsage((part as { usage?: UsageLike }).usage);
          if (u) usage = u;
          finishReason ??= (part as { finishReason?: string }).finishReason;
          break;
        }
        case 'finish': {
          const u = normalizeUsage(
            (part as { totalUsage?: UsageLike }).totalUsage
          );
          if (u) usage = u;
          finishReason ??= (part as { finishReason?: string }).finishReason;
          break;
        }
        case 'error':
          throw (part as { error: unknown }).error;
        default:
          break;
      }
    }

    if (usage) {
      yield { kind: 'usage', usage, model: this.opts.model.modelId };
    }
    yield { kind: 'finish', reason: mapFinishReason(finishReason) };
  }
}

function coerceArgs(raw: unknown): {
  args: Record<string, unknown>;
  parseFailed: boolean;
} {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return { args: raw as Record<string, unknown>, parseFailed: false };
  }
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { args: parsed as Record<string, unknown>, parseFailed: false };
      }
    } catch {
      // JSON parse failed — likely truncated mid-stream
      return { args: {}, parseFailed: true };
    }
  }
  return { args: {}, parseFailed: false };
}

function toAiSdkMessage(m: Msg): { role: string; content: unknown } {
  if (m.role === 'tool') {
    return {
      role: 'tool',
      content: [
        {
          type: 'tool-result',
          toolCallId: m.tool_call_id,
          toolName: m.tool_name,
          // v5's LanguageModelV2ToolResultOutput is a tagged union. All
          // providers we care about accept { type: "json" | "error-json" }.
          // Tag failed tool calls as `error-json` so the model can distinguish
          // a genuine error from a success payload that contains an `error`
          // field.
          output: {
            type: m.is_error ? 'error-json' : 'json',
            value: safeParseJson(m.content),
          },
        },
      ],
    };
  }
  if (m.role === 'assistant') {
    if ('tool_calls' in m && m.tool_calls.length > 0) {
      // v5 assistant with tool calls: content is an array of tool-call parts.
      // Our Msg shape forces content to "" in this variant, so no text part.
      const parts: Array<Record<string, unknown>> = m.tool_calls.map(call => ({
        type: 'tool-call',
        toolCallId: call.id,
        toolName: call.name,
        input: call.arguments,
      }));
      return { role: 'assistant', content: parts };
    }
    return { role: 'assistant', content: m.content };
  }
  return { role: m.role, content: m.content };
}

function buildToolsObject(
  tools: ToolDef[],
  jsonSchemaFn?: (s: Record<string, unknown>) => unknown
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const t of tools) {
    out[t.name] = {
      description: t.description,
      // v5: field is `inputSchema` and value must be a FlexibleSchema.
      // Wrap our raw JSON Schema in `jsonSchema()` when available so the
      // SDK can validate model output against it.
      inputSchema: jsonSchemaFn ? jsonSchemaFn(t.inputSchema) : t.inputSchema,
    };
  }
  return out;
}

function mapFinishReason(
  r: string | undefined
): StepEvent extends { kind: 'finish'; reason: infer R } ? R : never {
  switch (r) {
    case 'stop':
      return 'stop' as never;
    case 'tool-calls':
      return 'tool-calls' as never;
    case 'length':
      return 'length' as never;
    default:
      return 'other' as never;
  }
}

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/**
 * Normalise the AI SDK's usage object into our {@link TokenUsage} shape,
 * bridging the v5 (`inputTokens`/`outputTokens`) and v4 (`promptTokens`/
 * `completionTokens`) field names. Returns undefined when no counts are
 * present, so the driver only emits a `usage` event when it has real data.
 */
function normalizeUsage(usage: UsageLike | undefined): TokenUsage | undefined {
  if (!usage) return undefined;
  const inputTokens = usage.inputTokens ?? usage.promptTokens;
  const outputTokens = usage.outputTokens ?? usage.completionTokens;
  const totalTokens =
    usage.totalTokens ??
    (inputTokens !== undefined || outputTokens !== undefined
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : undefined);
  if (
    inputTokens === undefined &&
    outputTokens === undefined &&
    totalTokens === undefined
  ) {
    return undefined;
  }
  return { inputTokens, outputTokens, totalTokens };
}
