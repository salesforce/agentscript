# @agentscript/runtime

A lightweight TypeScript runtime that executes the `AgentDSLAuthoring` IR emitted by `@agentscript/compiler`.

The repo's compiler has always been open; the _runtime_ was not. This package is the first open JS executor for AgentScript — enough to run compiled agents in Node, Bun, edge workers, or the browser, outside Salesforce infrastructure.

## Install

```bash
pnpm add @agentscript/runtime @agentscript/agentforce
```

## Usage

```typescript
import { compileSource } from '@agentscript/agentforce';
import { Runtime, ToolRegistry, FnAdapter } from '@agentscript/runtime';

const { output } = compileSource(agentScriptSource);

const fn = new FnAdapter();
fn.register('lookup_order', async ({ order_id }) => ({ status: 'shipped' }));

const tools = new ToolRegistry();
tools.register('fn', fn);

const runtime = new Runtime({ doc: output, llm, tools });
const { assistantText } = await runtime.turn('Where is my order?');
```

`llm` is any value that implements the driver interface below. For the Vercel AI SDK, use [`@agentscript/runtime-vercel`](../runtime-vercel/).

### LLM driver

```typescript
interface LlmDriver {
  step(input: {
    system: string;
    messages: Msg[];
    tools: ToolDef[];
  }): AsyncIterable<StepEvent>;
}
```

Ship `text-delta`, `tool-call`, and a final `finish` event per step.

### Tool adapters

Register adapters keyed by URI scheme. Built-ins:

- `fn://` — local JS functions (`FnAdapter`)
- `http(s)://` — POST JSON to a URL (`HttpAdapter`)
- `mcp://` — MCP servers (`McpAdapter`)

Any action target whose scheme is not `__state_update_action__` is routed through the registry. Salesforce-only schemes (`apex://`, `flow://`, `apexRest://`) have no built-in adapter — bring your own or stub them with `FnAdapter`.

## What it runs

- `subagent` / `start_agent` nodes
- Lifecycle hooks: `before_reasoning`, `before_reasoning_iteration`, `after_all_tool_calls`, `after_reasoning`
- `set` / `run` / `with` / `transition` semantics via compiled step IR
- `__state_update_action__` sentinel → direct state mutation, no tool dispatch
- `{{ state.x }}` template interpolation in system and focus prompts
- `mutable` / `linked` (Context) variable enforcement
- Intra-turn subagent handoff

## What it does not run yet

Deferred to follow-up PRs.

- `action` / `router` / `external_agent` / `byon` node types (only `subagent` today; documents containing these node types are rejected at load time with an explicit `Unsupported node type(s)` error)
- `on_init` / `on_exit` lifecycle hooks
- `end_turn_first` on handoff
- Durable, checkpoint-based `RequireConfirmation` pause/resume (the compiled flag is surfaced to middleware — see below — but the runtime itself does not pause a turn to wait on it)
- Granular per-turn limits (`maxHandoffs`, `maxReasoningIterations`, `maxToolCallsPerNode`)
- Subgraph tools (agent-as-tool nesting)
- Middleware and `pre_tool_call`/`post_tool_call` hooks on the parallel-delegation-history dispatch path (`delegateMultiple`'s children) — a documented, narrower gap than the ones above

## What now ships in this runtime

- `AbortSignal` cancellation (runtime-level and per-turn)
- OpenTelemetry-shaped tracing with pluggable span exporters (`InMemorySpanExporter`, `ConsoleSpanExporter`, `MultiSpanExporter`)
- Output guardrails with retry, exhaustion policies, and feedback templates
- Structured output enforcement (`native` / `guardrail` / `auto` strategies)
- Middleware pipeline with before/after hooks
- Tool-call usage limits
- Checkpoint / restore via `runtime.checkpoint()` and `Runtime.fromCheckpoint(...)`
- Delegation-as-tool and parallel tool dispatch
- `pre_tool_call` / `post_tool_call` per-tool hooks, on both the sequential and parallel main-loop dispatch paths (`post_tool_call` is compiler-emitted today for nested `run`/`if` inside a tool body; `pre_tool_call` is schema-only in the compiler so far, but the runtime mechanism is ready)
- `require_user_confirmation` surfaced to `beforeToolCall` middleware via `ctx.requireConfirmation`, on both dispatch paths

## Testing

```bash
pnpm --filter @agentscript/runtime test
```

## Examples

Runnable TypeScript examples live under [`examples/`](./examples/README.md) —
`require_user_confirmation`, `pre_tool_call`/`post_tool_call`, and a
kitchen-sink agent combining delegation, middleware, guardrails, structured
output, tracing, and checkpoint/restore.

## License

Apache-2.0
