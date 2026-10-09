# @agentscript/runtime-vercel

Vercel AI SDK adapter for [`@agentscript/runtime`](../runtime/). Wraps `generateText` as an `LlmDriver` so the runtime can drive any SDK-supported provider (Anthropic, OpenAI, Google, …) while keeping tool dispatch and state management inside the runtime.

## Install

```bash
pnpm add @agentscript/runtime-vercel @agentscript/runtime ai @ai-sdk/anthropic
```

`ai` is a peer dependency — bring the version you use. `compileSource` is
re-exported from this package so you don't need a separate dependency on
`@agentscript/agentforce`.

## Usage

```typescript
import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { ToolRegistry, FnAdapter } from '@agentscript/runtime';
import { compileSource, createAgent } from '@agentscript/runtime-vercel';

const { output } = compileSource(agentScriptSource);

const fn = new FnAdapter();
fn.register('lookup_order', async ({ order_id }) => ({ status: 'shipped' }));
const tools = new ToolRegistry();
tools.register('fn', fn);

const agent = createAgent({
  doc: output,
  llm: { model: anthropic('claude-sonnet-4-6'), generateText },
  tools,
});

// Promise-style with lifecycle callbacks.
const { assistantText, usage } = await agent.run('Where is my order?', {
  onStepFinish: step => console.log('step done:', step.node),
  onFinish: result => console.log('turn done:', result.finalNode),
});
console.log(usage?.totalTokens, 'tokens');
```

### Call settings & provider options

The driver forwards two distinct buckets to the AI SDK:

```typescript
const agent = createAgent({
  doc: output,
  llm: {
    model: anthropic('claude-sonnet-4-6'),
    generateText,
    // Top-level AI SDK call settings (v5 renamed `maxTokens` → `maxOutputTokens`).
    callSettings: { temperature: 0.2, maxOutputTokens: 1024 },
    // Provider-specific extensions go under the SDK's `providerOptions` key.
    providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
  },
  tools,
});
```

### Token usage & cost

Every turn reports token usage on `result.usage`. Pass a `modelPricing` table
(USD per 1K tokens, keyed by model id) to also get a `costUsd` estimate, and
call `agent.usage()` for the lifetime total across turns:

```typescript
const agent = createAgent({
  doc: output,
  llm: { model: anthropic('claude-sonnet-4-6'), generateText },
  tools,
  modelPricing: {
    'claude-sonnet-4-6': { inputPer1k: 0.003, outputPer1k: 0.015 },
  },
});

const { usage } = await agent.run('…');
console.log(usage?.totalTokens, usage?.costUsd);
console.log(agent.usage()); // lifetime totals, with per-model breakdown
```

### Streaming

`agent.stream()` returns Vercel-style `fullStream` / `textStream` iterables:

```typescript
const stream = agent.stream('Where is my order?');

for await (const part of stream.fullStream) {
  switch (part.type) {
    case 'text-delta':
      process.stdout.write(part.text);
      break;
    case 'tool-call':
      console.log('→', part.toolName, part.args);
      break;
    case 'tool-result':
      console.log('←', part.toolName, part.result);
      break;
    case 'state-change':
      console.log('state', part.name, '=', part.after);
      break;
    case 'start-step':
      console.log('enter node', part.node);
      break;
    case 'finish-step':
      console.log('exit node', part.node, '→', part.to);
      break;
    case 'usage':
      console.log('usage', part.usage.totalTokens);
      break;
    case 'finish':
      console.log('done', part.finalNode);
      break;
    case 'error':
      console.error(part.error);
      break;
  }
}
const { assistantText } = await stream.result;
```

Or for text-only streaming:

```typescript
for await (const chunk of stream.textStream) process.stdout.write(chunk);
```

#### Real token streaming

By default each LLM step is a single `generateText` call, so `textStream`
yields one chunk per step. Inject `streamText` to stream the model response
token-by-token instead — the runtime forwards each delta as it arrives, so
`textStream` yields real incremental tokens:

```typescript
import { generateText, streamText } from 'ai';

const agent = createAgent({
  doc: output,
  llm: { model: anthropic('claude-sonnet-4-6'), generateText, streamText },
  tools,
});
```

Tool dispatch, state updates, usage, and every other stream part behave
identically — only text delivery becomes incremental.

### Stream part types

| `type`         | Payload                                   | Analog in `ai` `fullStream` |
| -------------- | ----------------------------------------- | --------------------------- |
| `start-step`   | `{ node }`                                | `start-step`                |
| `finish-step`  | `{ node, to? }`                           | `finish-step`               |
| `text-delta`   | `{ text }`                                | `text-delta`                |
| `tool-call`    | `{ toolName, args }`                      | `tool-call`                 |
| `tool-result`  | `{ toolName, result }`                    | `tool-result`               |
| `tool-error`   | `{ toolName, error }`                     | `tool-error`                |
| `state-change` | `{ name, before, after }` _(AgentScript)_ | —                           |
| `usage`        | `{ usage }` _(tokens + cost)_             | `finish` (usage)            |
| `finish`       | `{ finalNode, assistantText, usage? }`    | `finish`                    |
| `error`        | `{ error }`                               | `error`                     |

AgentScript also surfaces these lifecycle parts (no `ai` analog): `guardrail-pass`,
`guardrail-fail`, `guardrail-exhausted`, `delegation-start`, `delegation-end`,
`delegation-error`, `parallel-dispatch-start`, `parallel-dispatch-end`,
`tool-limit-reached`, `action-skipped`, and `end-session`. Switch on `part.type`
to handle the ones you care about; unknown types can be ignored.

Failed tool calls are tagged as `error-json` when forwarded to the provider (v5),
so the model can distinguish a genuine tool error from a success payload that
happens to contain an `error` field.

The adapter configures AI SDK tools with schema only (no `execute`) — tool calls returned by the model are forwarded back to the runtime, which dispatches through its own adapter registry and applies `state_updates`.

### Low-level

If you need to plug directly into `@agentscript/runtime`, `VercelAiSdkDriver` is exported too — `createAgent` is just a thin wrapper over it.

## Examples

Runnable TypeScript examples live under [`examples/`](./examples/). Most
(`run-mock.ts`, `run-anthropic.ts`, `run-gateway.ts`, `run-gateway-travel.ts`)
are covered by the package's existing tooling. Four more call a **live**
OpenAI model using the `OPENAI_API_KEY` / `AGENT_MODEL` in the repo's `.env`
— no mocked LLM anywhere in these files:

- **`live-weather-order.ts`** — the simplest live demo: one agent, two
  `fn://` tools (weather + order lookup), the model decides which to call.
  `pnpm --filter @agentscript/runtime-vercel example:live-weather-order`
- **`live-travel-concierge.ts`** — a `require_user_confirmation`-gated
  `Book_Flight` action; a `beforeToolCall` middleware pauses for a real y/n
  at the terminal before the booking tool ever runs.
  `pnpm --filter @agentscript/runtime-vercel example:live-travel-concierge`
- **`live-chat-repl.ts`** — an interactive terminal chat streaming real
  tokens via `agent.stream().fullStream` (backed by `streamText`, not
  `generateText`).
  `pnpm --filter @agentscript/runtime-vercel example:live-chat-repl`
- **`live-structured-extraction.ts`** — forces the model's free-form reply
  into a JSON Schema shape via `structuredOutput: { strategy: 'guardrail' }`
  on the low-level `Runtime`, with parse-validate-retry instead of relying on
  provider-native JSON mode.
  `pnpm --filter @agentscript/runtime-vercel example:live-structured-extraction`

All four skip cleanly (exit 0, no error) if `OPENAI_API_KEY` isn't set, so
they stay CI-safe. `gpt-5.6` (and other reasoning models) reject tool-calling
under their default reasoning settings via the Chat Completions API — the
shared `_shared/live-openai.ts` helper works around this with
`providerOptions: { openai: { reasoningEffort: 'none' } }`.

## License

Apache-2.0
