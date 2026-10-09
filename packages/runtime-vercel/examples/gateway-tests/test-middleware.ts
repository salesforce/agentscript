/* eslint-disable no-console */
/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Gateway test: Middleware intercepts tool calls, can modify/block behavior.
 *
 * Verifies that:
 *   - Logging middleware records all tool call attempts
 *   - Rate-limit middleware blocks further calls after a threshold
 *   - No fatal errors are raised (rate-limit is graceful)
 *
 * Run:
 *   pnpm exec tsx packages/runtime-vercel/examples/gateway-tests/test-middleware.ts
 */

import type {
  BeforeToolCallContext,
  BeforeToolCallResult,
} from '@agentscript/runtime';
import {
  createGatewayConfig,
  createLlmDriver,
  createTestAgent,
  runTurn,
  mockTool,
  assertions,
  report,
  type Middleware,
} from './harness.js';

// ---------------------------------------------------------------------------
// Inline .agent source — calculator agent
// ---------------------------------------------------------------------------

const AGENT_SOURCE = `
system:
    instructions: "You are a calculator assistant. Use the calculate tool to evaluate math expressions. When the user asks you to calculate multiple expressions, call the calculate tool once for each expression."

config:
    agent_name: "CalcBot"
    default_agent_user: "calc@example.com"

language:
    default_locale: "en_US"

variables:
    last_result: mutable string = ""
        description: "Last calculation result"

start_agent calculator:
    description: "Evaluates math expressions using the calculate tool"

    actions:
        Calculate:
            description: "Evaluate a mathematical expression"
            inputs:
                expression: string
                    description: "The math expression to evaluate"
                    is_required: True
            outputs:
                result: number
                    description: "The numeric result"
            target: "fn://calculate"

    reasoning:
        instructions: ->
            |   You must use the calculate tool for each expression.
                Call calculate once per expression. Do not skip any.
        actions:
            calc: @actions.Calculate
                with expression=...
                set @variables.last_result = @outputs.result
`;

// ---------------------------------------------------------------------------
// Middleware definitions
// ---------------------------------------------------------------------------

interface ToolCallAttempt {
  toolName: string;
  args: Record<string, unknown>;
  timestamp: number;
}

function createLoggingMiddleware(log: ToolCallAttempt[]): Middleware {
  return {
    name: 'logging',
    priority: 10,
    beforeToolCall(ctx: BeforeToolCallContext): void {
      log.push({
        toolName: ctx.toolName,
        args: { ...ctx.args },
        timestamp: Date.now(),
      });
      // Does not abort or modify — just logs.
    },
  };
}

function createRateLimitMiddleware(maxCalls: number): {
  middleware: Middleware;
  executedCount: () => number;
} {
  let executed = 0;
  const middleware: Middleware = {
    name: 'rate-limit',
    priority: 50,
    beforeToolCall(_ctx: BeforeToolCallContext): BeforeToolCallResult | void {
      executed++;
      if (executed > maxCalls) {
        return {
          abort: {
            result: { error: 'rate limited' },
          },
        };
      }
      // Allow the call to proceed.
    },
  };
  return { middleware, executedCount: () => executed };
}

// ---------------------------------------------------------------------------
// Main test
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('=== test-middleware.ts ===\n');

  const cfg = createGatewayConfig();
  const llmDriver = createLlmDriver(cfg);

  console.log(`Gateway: ${cfg.baseURL}`);
  console.log(`Model:   ${cfg.model}\n`);

  // Mock tool: calculate always returns 42 with a small delay
  const { tools } = mockTool({
    calculate: { delayMs: 50, result: { result: 42 } },
  });

  // Middleware
  const toolCallLog: ToolCallAttempt[] = [];
  const loggingMw = createLoggingMiddleware(toolCallLog);
  const { middleware: rateLimitMw, executedCount } =
    createRateLimitMiddleware(2);

  // Build runtime with middleware
  const runtime = createTestAgent({
    source: AGENT_SOURCE,
    tools,
    middleware: [loggingMw, rateLimitMw],
    maxStepsPerTurn: 10,
    llmDriver,
  });

  // Run the turn — ask for 3 calculations
  console.log('> user: Calculate 2+2, then 3*3, then 5+5\n');
  let errorThrown: Error | undefined;
  let capture;

  try {
    capture = await runTurn(runtime, 'Calculate 2+2, then 3*3, then 5+5');
  } catch (err) {
    errorThrown = err as Error;
  }

  // --- Assertions ---
  console.log('\n--- Assertions ---\n');

  // 1. Logging middleware captured tool call attempts.
  //    The LLM may make tool calls in separate reasoning iterations, so the
  //    logging middleware fires once per tool-call *attempt* that reaches
  //    beforeToolCall. We need at least 2 (the ones that were allowed) and
  //    ideally 3 (if the model tried a third).
  assertions.gte(
    toolCallLog.length,
    2,
    'Logging middleware captured >= 2 tool call attempts'
  );

  // 2. Rate-limit middleware was invoked (executedCount >= 2).
  assertions.gte(
    executedCount(),
    2,
    'Rate-limit middleware processed >= 2 calls'
  );

  // 3. If the model attempted a 3rd call, the rate-limiter should have
  //    blocked it, meaning only 2 tool-result events should appear in the
  //    event stream (the 3rd gets an abort result injected by middleware,
  //    which does NOT emit a tool-result event from the adapter).
  if (capture) {
    const toolResultEvents = capture.events.filter(
      e => e.kind === 'tool-result'
    );
    assertions.ok(
      toolResultEvents.length <= 2,
      'At most 2 tool-result events (3rd blocked by rate-limit)',
      `got ${toolResultEvents.length} tool-result events`
    );

    // 4. The turn completed without a fatal error.
    assertions.truthy(
      capture.result.assistantText !== undefined,
      'Turn produced assistant text (no fatal error)'
    );
  }

  // 5. No fatal error was thrown by the turn itself.
  assertions.ok(
    errorThrown === undefined,
    'No fatal error thrown (rate-limit is graceful)',
    errorThrown ? `error: ${errorThrown.message}` : undefined
  );

  // 6. All logged tool calls target the calculate tool.
  const allCalculate = toolCallLog.every(t => t.toolName === 'calc');
  assertions.ok(
    allCalculate,
    'All logged tool calls target the calculate action',
    `toolNames: ${toolCallLog.map(t => t.toolName).join(', ')}`
  );

  report('test-middleware');
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
