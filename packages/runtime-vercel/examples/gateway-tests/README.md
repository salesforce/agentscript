# Gateway Model Validation Tests

Deterministic test harness for validating LLM gateway models against the AgentScript JS Runtime.

## Key Insight

All tool outputs are **hard-coded and deterministic**. This means the _logical flow_ of the agent (which tools it calls, what state changes happen, what handoffs occur) should be **identical regardless of which model** is used behind the gateway. We never assert on text content from the LLM -- only on structural behavior.

## Environment Variables

| Variable              | Description                                | Example                          |
| --------------------- | ------------------------------------------ | -------------------------------- |
| `LLM_GATEWAY_URL`     | Base URL for the OpenAI-compatible gateway | `https://gateway.example.com/v1` |
| `LLM_GATEWAY_API_KEY` | API key or bearer token                    | `sk-...`                         |
| `LLM_GATEWAY_MODEL`   | Model identifier to test                   | `claude-haiku-4-5-20251001`      |

## Running Tests

```bash
# Set environment variables
export LLM_GATEWAY_URL="https://your-gateway.example.com/v1"
export LLM_GATEWAY_API_KEY="your-api-key"
export LLM_GATEWAY_MODEL="claude-haiku-4-5-20251001"

# Run a specific test script
pnpm exec tsx packages/runtime-vercel/examples/gateway-tests/<test-script>.ts
```

Each test script is a standalone program that exits with code 0 on success and 1 on failure. No test framework (vitest, jest, etc.) is required.

## Harness API

The shared harness (`harness.ts`) exports:

### `createGatewayConfig()`

Reads the three environment variables and returns a `GatewayConfig` object. Exits with a descriptive error if any variable is missing.

### `createTestAgent(source, tools, opts?)`

Compiles AgentScript source, creates an agent wired to the real LLM gateway, and returns `{ agent, events }` where `events` is an array that accumulates all stream parts across turns.

### `runTurn(agent, message, events)`

Sends a user message, streams the full response, and returns a `TurnResult` containing:

- `text` -- accumulated assistant text (for debugging, not assertions)
- `events` -- stream parts for this turn only
- `toolCalls` -- extracted tool calls with timestamps
- `stateChanges` -- extracted state mutations (excluding internal vars)
- `handoffs` -- extracted node-to-node transitions
- `duration` -- wall-clock ms

### `mockTool(name, response, opts?)`

Creates a deterministic tool handler returning a fixed response. Options:

- `delayMs` -- artificial latency before returning
- `failAfterMs` -- throw after delay (simulate timeout)
- `callCount` -- mutable `{ current: number }` to track invocations

### `createMockToolRegistry(mocks)`

Convenience wrapper: takes an array of `mockTool()` results and returns a fully configured `ToolRegistry`.

### `assertions`

Structural assertion methods (all return `AssertionResult`, never throw):

| Method                                              | What it checks                                          |
| --------------------------------------------------- | ------------------------------------------------------- |
| `toolWasCalled(events, name)`                       | Tool was called at least once                           |
| `toolWasCalledWith(events, name, args)`             | Tool was called with specific arg values (subset match) |
| `toolCallOrder(events, names)`                      | Tools appeared as a subsequence in call order           |
| `toolsCalledInParallel(events, names, toleranceMs)` | Tools started within tolerance of each other            |
| `stateEquals(agent, key, expected)`                 | State variable has expected value                       |
| `handoffOccurred(events, from, to)`                 | A node handoff was observed                             |
| `noErrors(events)`                                  | No error or tool-error events                           |
| `totalToolCalls(events, count)`                     | Exact number of tool calls                              |

### `report(testName, results)`

Pretty-prints PASS/FAIL per assertion and returns an exit code (0 = all passed, 1 = any failed).

## Why Structural Assertions?

Different models produce different text, phrasing, and formatting. But when tool outputs are deterministic and the agent definition is fixed, the **structural behavior** -- which tools get called, in what order, with what arguments, and what state transitions result -- should be model-agnostic.

This lets us:

1. **Validate new models** against a known-good behavioral baseline
2. **Detect regressions** when gateway configurations change
3. **Compare models** on correctness of tool orchestration, not prose quality
