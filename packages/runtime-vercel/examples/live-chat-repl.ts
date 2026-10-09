#!/usr/bin/env -S npx tsx
/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * ─────────────────────────────────────────────────────────────────────────
 * LIVE example 3 — a streaming chat REPL against a real model
 * ─────────────────────────────────────────────────────────────────────────
 *
 * An interactive terminal chat with a live OpenAI model, tokens printed as
 * they arrive via `agent.stream().textStream` (backed by the AI SDK's
 * `streamText`, not `generateText`). The agent can also look things up with
 * a `fn://` tool — tool calls print inline so you can see the model reason
 * mid-stream, then keep printing tokens.
 *
 * Type a message and press Enter. Type `exit` (or Ctrl+D) to quit.
 *
 * Run:  pnpm --filter @agentscript/runtime-vercel exec tsx examples/live-chat-repl.ts
 *
 * Non-interactive smoke mode (for CI / scripted verification — runs one
 * fixed message and exits instead of reading stdin):
 *   REPL_SMOKE_MESSAGE="What is 2+2?" pnpm --filter @agentscript/runtime-vercel exec tsx examples/live-chat-repl.ts
 *
 * Skips cleanly (exit 0) if OPENAI_API_KEY isn't set.
 */

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { ToolRegistry, FnAdapter } from '@agentscript/runtime';
import { compileSource, createAgent } from '../src/index.js';
import { resolveLiveOpenAi, CONFIGURE_HINT } from './_shared/live-openai.js';

const SOURCE = `
system:
    instructions: "You are a friendly, knowledgeable chat assistant. You can look up facts with the search_facts tool when helpful."
config:
    agent_name: "ChatBot"
    default_agent_user: "bot@example.com"

start_agent main:
    description: "General-purpose streaming chat assistant"
    actions:
        Search_Facts:
            description: "Look up a quick fact"
            inputs:
                query: string
                    description: "What to look up"
                    is_required: True
            outputs:
                result: string
            target: "fn://search_facts"
    reasoning:
        instructions: ->
            | Chat naturally with the user. Use {!@actions.search} if you need
              to look something up, otherwise just answer directly.
        actions:
            search: @actions.Search_Facts
                with query=...
`;

const FACTS: Record<string, string> = {
  agentscript: 'AgentScript is a DSL for authoring multi-agent systems.',
};

async function streamOneTurn(
  agent: ReturnType<typeof createAgent>,
  userMsg: string
): Promise<void> {
  const stream = agent.stream(userMsg);
  process.stdout.write('< ');
  for await (const part of stream.fullStream) {
    switch (part.type) {
      case 'text-delta':
        process.stdout.write(part.text);
        break;
      case 'tool-call':
        process.stdout.write(
          `\n  [tool] ${part.toolName}(${JSON.stringify(part.args)})\n< `
        );
        break;
      case 'tool-result':
        process.stdout.write(`  [result] ${JSON.stringify(part.result)}\n< `);
        break;
      case 'abort':
        process.stdout.write(`\n  [aborted] ${JSON.stringify(part.reason)}\n`);
        break;
    }
  }
  await stream.result;
  process.stdout.write('\n');
}

async function main() {
  const live = resolveLiveOpenAi();
  if (!live) {
    console.log(`⏭  Skipping — ${CONFIGURE_HINT}`);
    return;
  }
  console.log(`Live model: openai · ${live.modelId} (streaming)\n`);

  const { output, diagnostics } = compileSource(SOURCE);
  const errors = diagnostics.filter(
    d => d.severity === 1 && d.code !== 'invalid-action-target'
  );
  if (errors.length) {
    console.error('Compile errors:', errors);
    process.exit(1);
  }

  const fn = new FnAdapter();
  fn.register('search_facts', args => {
    const query = String((args as { query?: string }).query ?? '')
      .trim()
      .toLowerCase();
    const hit = FACTS[query] ?? `No fact on file for "${query}".`;
    return { result: hit };
  });
  const tools = new ToolRegistry();
  tools.register('fn', fn);

  const agent = createAgent({ doc: output, llm: live.llm, tools });

  const smokeMessage = process.env.REPL_SMOKE_MESSAGE;
  if (smokeMessage) {
    console.log(`> ${smokeMessage}`);
    await streamOneTurn(agent, smokeMessage);
    console.log('\n✓ Live streaming chat smoke test complete.');
    return;
  }

  console.log('Type a message and press Enter. Type "exit" to quit.\n');
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    for (;;) {
      const userMsg = await rl.question('> ');
      const trimmed = userMsg.trim();
      if (!trimmed || /^exit$/i.test(trimmed)) break;
      await streamOneTurn(agent, trimmed);
    }
  } finally {
    rl.close();
  }
  console.log('\n✓ Live streaming chat session ended.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
