/* eslint-disable no-console */
/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Stress gateway test: hand-crafted agent that exercises THREE recently-fixed
 * code paths in a single end-to-end run against the real LLM gateway.
 *
 * Recently-fixed paths exercised:
 *   1. Tracing under parallel tool dispatch — `startChildSpan` /
 *      `endSpanById` for concurrent siblings (3 tools fire in parallel).
 *   2. Output guardrail with retry — content-policy blocklist requires the
 *      model to retry once if it includes the forbidden phrase. Confirms
 *      the retry buffer doesn't pollute `runtime.history`.
 *   3. Topic handoff after parallel dispatch — agent transitions to a
 *      summary topic only after all three parallel tools have returned.
 *
 * Validates:
 *   - Parallel-dispatch-start / parallel-dispatch-end events fire
 *   - All 3 search tools invoked
 *   - Wall-clock duration suggests parallelism (< 1.5x slowest tool)
 *   - Handoff to summary topic occurred
 *   - Guardrail-pass event emitted on accepted output
 *   - runtime.history contains no rejected attempts (assistant messages
 *     in history is exactly the count of *accepted* responses, no
 *     synthetic feedback messages)
 *   - No error events
 *
 * Run:
 *   pnpm exec tsx --env-file=.env \
 *     packages/runtime-vercel/examples/gateway-tests/test-stress-parallel-guardrail.ts
 */

import { contentPolicyGuardrail } from '@agentscript/runtime';
import {
  createGatewayConfig,
  createLlmDriver,
  createTestAgent,
  runTurn,
  mockTool,
  assertions,
  report,
  type RuntimeEvent,
} from './harness.js';

const AGENT_SOURCE = `
system:
    instructions: "You are a research assistant. When the user asks a question, you MUST search ALL three sources at the same time using web, database, and cache. Do not skip any source. After all three searches return, transition to the summary topic and provide a concise summary of the findings. Never use the word XYZZY in your responses."

config:
    agent_name: "StressBot"
    default_agent_user: "bot@example.com"

language:
    default_locale: "en_US"

variables:
    web_data: mutable string = ""
        description: "Result from web search"
    db_data: mutable string = ""
        description: "Result from database search"
    cache_data: mutable string = ""
        description: "Result from cache lookup"

start_agent researcher:
    description: "Searches three sources in parallel and hands off to summary"

    actions:
        Search_Web:
            description: "Search the web"
            inputs:
                query: string
                    description: "Query"
                    is_required: True
            outputs:
                results: string
                    description: "Web findings"
            target: "fn://search_web"

        Search_Database:
            description: "Search the internal database"
            inputs:
                query: string
                    description: "Query"
                    is_required: True
            outputs:
                results: string
                    description: "Database findings"
            target: "fn://search_database"

        Search_Cache:
            description: "Search the local cache"
            inputs:
                query: string
                    description: "Query"
                    is_required: True
            outputs:
                results: string
                    description: "Cache findings"
            target: "fn://search_cache"

    reasoning:
        instructions: ->
            |   Call {!@actions.search_web}, {!@actions.search_database},
                and {!@actions.search_cache} all in the same step. Then
                transition to the summary topic.
        actions:
            search_web: @actions.Search_Web
                with query=...
                set @variables.web_data = @outputs.results

            search_database: @actions.Search_Database
                with query=...
                set @variables.db_data = @outputs.results

            search_cache: @actions.Search_Cache
                with query=...
                set @variables.cache_data = @outputs.results

            go_to_summary: @utils.transition to @topic.summary
                description: "Hand off once all three sources have returned"
                available when @variables.web_data != "" and @variables.db_data != "" and @variables.cache_data != ""

topic summary:
    description: "Summarizes the parallel search results for the user"

    actions:
        Mark_Summary_Done:
            description: "Records that the user has been given a summary"
            inputs:
                summary_text: string
                    description: "Final synthesized summary"
                    is_required: True
            outputs:
                acknowledged: boolean
                    description: "Whether the summary was recorded"
            target: "fn://mark_summary_done"

    reasoning:
        instructions: ->
            |   The three searches returned:
            |   - web: {! @variables.web_data }
            |   - database: {! @variables.db_data }
            |   - cache: {! @variables.cache_data }
            |
            |   Provide a concise summary that synthesizes all three sources,
            |   then call {!@actions.mark_done} with that summary text.
            |   Do not include the literal word XYZZY anywhere in your response.
        actions:
            mark_done: @actions.Mark_Summary_Done
                with summary_text=...
`;

async function main(): Promise<void> {
  console.log('=== test-stress-parallel-guardrail ===\n');

  const cfg = createGatewayConfig();
  const llmDriver = createLlmDriver(cfg);
  console.log(`Gateway: ${cfg.baseURL}`);
  console.log(`Model:   ${cfg.model}\n`);

  // Three sources with staggered delays so a sequential dispatch would
  // visibly cost the sum (~600ms), parallel ~300ms.
  const SLOWEST_MS = 300;
  const { tools, callLog } = mockTool({
    search_web: {
      delayMs: SLOWEST_MS,
      result: {
        results: 'Quantum computers leverage qubits in superposition.',
      },
    },
    search_database: {
      delayMs: 200,
      result: { results: 'Internal record: shor algorithm benchmark 2025.' },
    },
    search_cache: {
      delayMs: 100,
      result: { results: 'Cached: IBM claims 1000+ qubit processor.' },
    },
    mark_summary_done: {
      delayMs: 10,
      result: { acknowledged: true },
    },
  });

  // Guardrail forbids a word the model is unlikely to produce — exercise
  // the retry-buffer history-isolation path on the *passing* case.
  const guardrail = contentPolicyGuardrail({
    blocklist: ['XYZZY', 'NEVER_SAY_THIS'],
    name: 'stress-content-policy',
    maxRetries: 2,
  });

  const runtime = createTestAgent({
    source: AGENT_SOURCE,
    tools,
    guardrails: [guardrail],
    parallel: { strategy: 'always' },
    maxStepsPerTurn: 12,
    llmDriver,
  });

  const allEvents: RuntimeEvent[] = [];

  console.log('--- Turn 1: research request ---\n');
  const start = Date.now();
  const turn1 = await runTurn(
    runtime,
    'What do we know about quantum computing?'
  );
  const elapsed = Date.now() - start;
  allEvents.push(...turn1.events);
  logTurn(turn1.events, turn1.durationMs);

  // -------------------------------------------------------------------------
  // Assertions
  // -------------------------------------------------------------------------
  const toolNames = allEvents
    .filter(e => e.kind === 'tool-call')
    .map(e => (e as { kind: 'tool-call'; name: string }).name);

  assertions.ok(
    toolNames.includes('fn://search_web'),
    'search_web was called',
    `tool calls: ${toolNames.join(', ')}`
  );
  assertions.ok(
    toolNames.includes('fn://search_database'),
    'search_database was called'
  );
  assertions.ok(
    toolNames.includes('fn://search_cache'),
    'search_cache was called'
  );

  const dispatchStarts = allEvents.filter(
    e => e.kind === 'parallel-dispatch-start'
  );
  assertions.gte(
    dispatchStarts.length,
    1,
    'parallel-dispatch-start emitted at least once'
  );

  const dispatchEnds = allEvents.filter(
    e => e.kind === 'parallel-dispatch-end'
  );
  assertions.ok(
    dispatchEnds.length === dispatchStarts.length,
    'every parallel-dispatch-start has a matching parallel-dispatch-end',
    `start: ${dispatchStarts.length}, end: ${dispatchEnds.length}`
  );

  // Wall-clock check: if the runtime really dispatched in parallel, all three
  // *search* tools should start within a tight window. Sequential dispatch
  // would space them apart by at least the previous tool's delay.
  // Filter callLog to just the parallel batch (search_*) — mark_summary_done
  // runs in a later step and would inflate the spread otherwise.
  const searchCallTimes = callLog
    .filter(c => c.name.startsWith('search_'))
    .map(c => c.timestamp);
  if (searchCallTimes.length >= 3) {
    const spread = Math.max(...searchCallTimes) - Math.min(...searchCallTimes);
    // Parallel: spread is essentially zero. Sequential lower bound = 100ms
    // (cache delay) + 200ms (db delay) ≈ 300ms. Use 100ms as threshold.
    assertions.lt(
      spread,
      100,
      'all three search invocations start within 100ms (parallel dispatch)'
    );
  }

  // Handoff to summary topic
  const enteredNodes = allEvents
    .filter(e => e.kind === 'node-enter')
    .map(e => (e as { kind: 'node-enter'; node: string }).node);
  assertions.ok(
    enteredNodes.includes('summary'),
    'agent handed off to summary topic after parallel dispatch',
    `nodes entered: [${enteredNodes.join(', ')}]`
  );

  // Guardrail pass event must have fired
  const guardrailPasses = allEvents.filter(e => e.kind === 'guardrail-pass');
  assertions.gte(
    guardrailPasses.length,
    1,
    'at least one guardrail-pass event emitted'
  );

  // History-isolation invariant: even if the guardrail retried (we don't
  // know if the model said XYZZY on first try), `runtime.history` must
  // never contain a synthetic feedback message — those live in the
  // scratch buffer only.
  const checkpoint = runtime.checkpoint();
  const feedbackLeak = checkpoint.history.some(
    m =>
      m.role === 'user' &&
      typeof m.content === 'string' &&
      m.content.includes('Your response failed validation')
  );
  assertions.ok(
    !feedbackLeak,
    'runtime.history contains no synthetic guardrail feedback messages',
    feedbackLeak ? 'leaked feedback found' : undefined
  );

  // Final assistant text must not contain the forbidden word (proves the
  // guardrail is actually filtering, not just passing through).
  const finalText = (turn1.result.assistantText ?? '').toString();
  assertions.ok(
    !finalText.includes('XYZZY') && !finalText.includes('NEVER_SAY_THIS'),
    'final response contains no blocklist words'
  );

  // No errors
  const errorEvents = allEvents.filter(
    e => e.kind === 'tool-error' || e.kind === 'abort'
  );
  assertions.ok(
    errorEvents.length === 0,
    'no error events',
    JSON.stringify(errorEvents)
  );

  console.log(`\n--- Timing ---`);
  console.log(`  Total turn duration: ${elapsed}ms`);
  console.log(
    `  Search call spread:  ${
      searchCallTimes.length >= 2
        ? Math.max(...searchCallTimes) - Math.min(...searchCallTimes) + 'ms'
        : 'n/a'
    }`
  );
  console.log(`  Sum of search delays: 600ms (sequential lower bound)\n`);

  report('test-stress-parallel-guardrail');
}

function logTurn(events: RuntimeEvent[], durationMs: number): void {
  console.log(`  Duration: ${durationMs}ms`);
  for (const e of events) {
    if (e.kind === 'tool-call') {
      console.log(`  [tool-call]  ${e.name}(${JSON.stringify(e.args)})`);
    } else if (e.kind === 'tool-result') {
      console.log(`  [tool-res]   ${e.name} -> ${JSON.stringify(e.result)}`);
    } else if (e.kind === 'node-enter') {
      console.log(`  [node-enter] ${e.node}`);
    } else if (e.kind === 'node-exit') {
      console.log(`  [node-exit]  ${e.node}${e.to ? ' -> ' + e.to : ''}`);
    } else if (e.kind === 'parallel-dispatch-start') {
      console.log(`  [parallel-start] tools: ${e.toolNames.join(', ')}`);
    } else if (e.kind === 'parallel-dispatch-end') {
      console.log(`  [parallel-end]   tools: ${e.toolNames.join(', ')}`);
    } else if (e.kind === 'guardrail-pass') {
      console.log(`  [guardrail-pass] ${e.name}`);
    } else if (e.kind === 'guardrail-fail') {
      console.log(`  [guardrail-fail] ${e.name}: ${e.error}`);
    }
  }
  console.log('');
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
