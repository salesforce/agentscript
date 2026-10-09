# Examples

Runnable TypeScript examples for `@agentscript/runtime`. Each file is
self-contained: it compiles an `.agent` DSL source with
`@agentscript/agentforce`, drives it with a scripted `LlmDriver` (no
network calls, no API key needed), and asserts on the result so a regression
fails loudly instead of silently.

Imports are **source-relative** (`../src/index.js`, `../../src/index.js` from
`_shared/`), not the published package name. That means these examples run
straight from a checkout without a `pnpm build` first — swap the import for
`@agentscript/runtime` if you're copying a snippet into your own project.

## Files

- **`require-confirmation.ts`** — `require_user_confirmation`: an agent
  author flags a sensitive action in the DSL; the runtime surfaces it to
  `beforeToolCall` middleware as `ctx.requireConfirmation` so a host can gate
  it. Run: `pnpm --filter @agentscript/runtime example:confirmation`

- **`tool-hooks.ts`** — `pre_tool_call` / `post_tool_call`: hooks that run
  before and after a tool dispatch. `post_tool_call` chains a follow-up
  action after a successful call (a real, compiler-emitted `run @actions.X`);
  `pre_tool_call` can pre-empt the call entirely (handoff before the tool or
  any middleware ever runs). Run:
  `pnpm --filter @agentscript/runtime example:hooks`

- **`kitchen-sink.ts`** — a "Travel Concierge" agent combining delegation,
  confirmation gating, both tool hooks, middleware (`beforeToolCall` +
  `afterToolCall`), guardrails + structured output, tracing, and
  checkpoint/restore in one scenario. Not covered: background subagents and
  swarm fan-out — see the test suite (`background-*.test.ts`,
  `swarm-*.test.ts`) for those. Run:
  `pnpm --filter @agentscript/runtime example:kitchen-sink`

- **`_shared/scripted-llm.ts`** — a minimal `LlmDriver` that plays back a
  scripted sequence of steps. Swap it for `@agentscript/runtime-vercel`'s
  `VercelAiSdkDriver` (or any other `LlmDriver`) to go from "example" to
  "real model," unchanged.

## `pre_tool_call` and the compiler

`pre_tool_call` has no `.agent` DSL surface yet (schema-only as of compiler
2.6.9) — no `.agent` construct emits it. `tool-hooks.ts` and `kitchen-sink.ts`
compile a normal agent and then set `node.pre_tool_call` directly on the
compiled IR before constructing `Runtime`, the same technique the test suite
uses (`test/pre-tool-call.test.ts`). The runtime-side mechanism is identical
to `post_tool_call`, just triggered earlier — this is a preview of what the
DSL will look like once the compiler catches up.
