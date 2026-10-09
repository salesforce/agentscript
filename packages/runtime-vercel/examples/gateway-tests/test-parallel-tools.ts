/* eslint-disable no-console, @typescript-eslint/require-await */
/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Gateway test: parallel tool dispatch.
 *
 * Validates that when 3 tools are called in the same LLM step, the runtime
 * dispatches them concurrently (strategy: 'always') and the wall-clock time
 * is bounded by the slowest tool, NOT the sum of all tools.
 *
 * NOTE: This test uses top-level await (no async main() wrapper). This is
 * intentional -- tsx supports top-level await natively, and wrapping would
 * add unnecessary indentation to a file that is already linear.
 *
 * Run:
 *   pnpm exec tsx packages/runtime-vercel/examples/gateway-tests/test-parallel-tools.ts
 */

import {
  createTestAgent,
  mockTool,
  runTurn,
  assertions,
  report,
} from './harness.js';
import { VercelAiSdkDriver } from '@agentscript/runtime-vercel';
import type { GenerateTextFn } from '@agentscript/runtime-vercel';

// ---------------------------------------------------------------------------
// Inline .agent source
// ---------------------------------------------------------------------------

const agentSource = `
system:
    instructions: "You are a research assistant. When the user asks a question, search ALL three sources simultaneously to find the answer. Always call all three tools."

config:
    agent_name: "ResearchBot"
    default_agent_user: "bot@example.com"

language:
    default_locale: "en_US"

variables:
    search_results: mutable string = ""
        description: "Aggregated search results"

start_agent researcher:
    description: "Searches multiple sources in parallel"

    actions:
        Search_Web:
            description: "Search the web for information"
            inputs:
                query: string
                    description: "The search query"
                    is_required: True
            outputs:
                results: string
                    description: "Web search results"
                source: string
                    description: "Source identifier"
            target: "fn://search_web"

        Search_Database:
            description: "Search the internal database"
            inputs:
                query: string
                    description: "The search query"
                    is_required: True
            outputs:
                results: string
                    description: "Database search results"
                source: string
                    description: "Source identifier"
            target: "fn://search_database"

        Search_Cache:
            description: "Search the local cache"
            inputs:
                query: string
                    description: "The search query"
                    is_required: True
            outputs:
                results: string
                    description: "Cache search results"
                source: string
                    description: "Source identifier"
            target: "fn://search_cache"

    reasoning:
        instructions: ->
            |   Search all three sources for the user's query using
                {!@actions.search_web}, {!@actions.search_database},
                and {!@actions.search_cache}, then summarize the results.
        actions:
            search_web: @actions.Search_Web
                with query=...
            search_database: @actions.Search_Database
                with query=...
            search_cache: @actions.Search_Cache
                with query=...
`;

// ---------------------------------------------------------------------------
// Mock tools with different delays
// ---------------------------------------------------------------------------

const { tools, callLog } = mockTool({
  search_web: {
    delayMs: 300,
    result: { results: ['Web result 1', 'Web result 2'], source: 'web' },
  },
  search_database: {
    delayMs: 200,
    result: { results: ['DB record 1'], source: 'database' },
  },
  search_cache: {
    delayMs: 100,
    result: { results: ['Cached item'], source: 'cache' },
  },
});

// ---------------------------------------------------------------------------
// Mock LLM -- returns predetermined tool calls then a text response
// ---------------------------------------------------------------------------

let llmStep = 0;

const mockGenerateText: GenerateTextFn = async () => {
  llmStep++;
  if (llmStep === 1) {
    // First call: LLM requests all 3 tools simultaneously
    return {
      text: '',
      toolCalls: [
        {
          toolCallId: 'call_web_1',
          toolName: 'search_web',
          args: { query: 'quantum computing' },
        },
        {
          toolCallId: 'call_db_1',
          toolName: 'search_database',
          args: { query: 'quantum computing' },
        },
        {
          toolCallId: 'call_cache_1',
          toolName: 'search_cache',
          args: { query: 'quantum computing' },
        },
      ],
      finishReason: 'tool-calls',
    };
  }
  // Second call: LLM synthesizes a response
  return {
    text: 'Based on all three sources, quantum computing uses qubits.',
    toolCalls: [],
    finishReason: 'stop',
  };
};

// ---------------------------------------------------------------------------
// Build runtime with parallel dispatch enabled
// ---------------------------------------------------------------------------

const llmDriver = new VercelAiSdkDriver({
  model: { modelId: 'mock-parallel', provider: 'mock' },
  generateText: mockGenerateText,
});

const runtime = createTestAgent({
  source: agentSource,
  tools,
  llmDriver,
  parallel: { strategy: 'always' },
});

// ---------------------------------------------------------------------------
// Run turn and validate
// ---------------------------------------------------------------------------

console.log('=== test-parallel-tools ===');
console.log('Config: parallel strategy = "always"');
console.log(
  'Tools:  search_web (300ms), search_database (200ms), search_cache (100ms)'
);
console.log('Expected: all 3 tools called in parallel, total < 500ms\n');

const { result, events, durationMs } = await runTurn(
  runtime,
  'Search for information about quantum computing'
);

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

// 1. All 3 tools were called
const toolCallEvents = events.filter(e => e.kind === 'tool-call');
const calledToolNames = toolCallEvents.map(
  e => (e as { kind: 'tool-call'; name: string }).name
);

assertions.ok(
  calledToolNames.some(n => n.includes('search_web')),
  'search_web was called'
);
assertions.ok(
  calledToolNames.some(n => n.includes('search_database')),
  'search_database was called'
);
assertions.ok(
  calledToolNames.some(n => n.includes('search_cache')),
  'search_cache was called'
);

// 2. Total tool results = 3
const toolResultEvents = events.filter(e => e.kind === 'tool-result');
assertions.eq(toolResultEvents.length, 3, 'totalToolCalls(events, 3)');

// 3. Timing: total < 500ms proves parallel (sequential would be >= 600ms)
assertions.lt(
  durationMs,
  500,
  `turn duration < 500ms (was ${durationMs}ms, sequential would be >= 600ms)`
);

// 4. Parallel dispatch events were emitted
const parallelStarts = events.filter(e => e.kind === 'parallel-dispatch-start');
const parallelEnds = events.filter(e => e.kind === 'parallel-dispatch-end');
assertions.eq(
  parallelStarts.length,
  1,
  'parallel-dispatch-start event emitted'
);
assertions.eq(parallelEnds.length, 1, 'parallel-dispatch-end event emitted');

// 5. No errors
const errorEvents = events.filter(e => e.kind === 'tool-error');
assertions.eq(errorEvents.length, 0, 'no tool errors');

// 6. Assistant produced text
assertions.truthy(
  result.assistantText.length > 0,
  'assistant text is non-empty'
);

// 7. Call log confirms all 3 tools were invoked
assertions.eq(callLog.length, 3, 'call log has 3 entries');

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log(`\n--- Timing ---`);
console.log(`  Turn duration: ${durationMs}ms`);
console.log(`  Tools called:  ${calledToolNames.join(', ')}`);

report('test-parallel-tools');
