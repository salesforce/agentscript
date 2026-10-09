/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import type { Middleware, Msg } from '@agentscript/runtime';

import type { MemoryEntry, SemanticMemory } from './semantic-memory.js';
import type { WorkingMemory } from './working-memory.js';

/**
 * Wires {@link SemanticMemory} + {@link WorkingMemory} into the runtime loop as
 * a single `beforeLlmStep`/`afterTurn` middleware — the one seam that turns the
 * memory package from an unused library into a live part of every turn.
 *
 * Two things happen per turn:
 *
 *  - **Recall (beforeLlmStep).** Before the model runs, we embed the current
 *    user question, pull the top-K most similar prior memories for this thread,
 *    and inject them (plus the working-memory doc) as `<system-reminder>`
 *    messages via `appendMessages`. This is gated to fire **at most once per
 *    turn**: a fresh middleware instance resets `recalledThisTurn` in
 *    `beforeTurn`, and the agentic loop's later `beforeLlmStep` iterations skip
 *    re-embedding. Injected reminders are user-role (the only non-system role a
 *    strict provider accepts mid-conversation), mirroring the harness's
 *    injection convention.
 *
 *  - **Persist (afterTurn).** After the turn settles we remember the user input
 *    (stashed from `beforeTurn`, since `AfterTurnContext` carries no user text)
 *    and the assistant's reply, each under a fresh unique id. Persisting in
 *    `afterTurn` — not `beforeTurn` — is deliberate: it keeps the current
 *    question out of its own recall results (no self-recall), so a `topK=1`
 *    query in the NEXT turn returns a genuinely prior fact. Ids come from
 *    `randomUUID()` rather than a per-instance counter so they stay unique even
 *    when the agent is reconstructed from a checkpoint each turn (a counter
 *    would reset to 0 and clobber prior entries under a durable session store).
 *
 * `failOpen` is true: a memory backend error degrades the turn to memoryless
 * rather than failing it.
 */

const RECALL_VARIANT = 'memory-recall';
const WORKING_VARIANT = 'memory-working';

/** Default number of memories injected per turn. */
const DEFAULT_TOP_K = 4;
/**
 * Default similarity floor. Recall injects only hits at or above this cosine
 * score, so unrelated memories (near-orthogonal under any embedder) never
 * accrete as context noise over a long session. Deliberately low so the offline
 * {@link HashEmbedder} — which scores by lexical overlap — still surfaces real
 * matches.
 */
const DEFAULT_MIN_SCORE = 0.1;

export interface MemoryMiddlewareOptions {
  /** Semantic recall store. When absent, recall + persistence are disabled. */
  semantic?: SemanticMemory;
  /** Working-memory document store. When absent, no working doc is injected. */
  working?: WorkingMemory;
  /** Conversation/thread scope for recall and persistence. */
  threadId: string;
  /** Optional owner (user/tenant) scope, enabling cross-thread recall. */
  resourceId?: string;
  /** Recall tuning; falls back to sensible defaults. */
  recall?: { topK?: number; minScore?: number };
  /** Pipeline priority. Default 450 — after injection (400), before compaction (500). */
  priority?: number;
  /** Persist the user input each turn (default true). */
  persistUser?: boolean;
  /** Persist the assistant reply each turn (default true). */
  persistAssistant?: boolean;
}

/** Wrap a reminder body in a `<system-reminder variant="...">` user message. */
function wrapReminder(variant: string, body: string): Msg {
  return {
    role: 'user',
    content: `<system-reminder variant="${variant}">\n${body}\n</system-reminder>`,
  };
}

/** True when `msg` is an injected reminder (any variant) rather than real user text. */
function isReminder(msg: Msg): boolean {
  return (
    msg.role === 'user' &&
    typeof msg.content === 'string' &&
    msg.content.startsWith('<system-reminder variant="')
  );
}

/**
 * The most recent genuine user message text, skipping our own injected
 * reminders — the query we run recall against.
 */
function lastRealUserText(messages: readonly Msg[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (
      m &&
      m.role === 'user' &&
      typeof m.content === 'string' &&
      !isReminder(m)
    ) {
      return m.content;
    }
  }
  return undefined;
}

export function createMemoryMiddleware(
  options: MemoryMiddlewareOptions
): Middleware {
  const {
    semantic,
    working,
    threadId,
    resourceId,
    recall,
    priority = 450,
    persistUser = true,
    persistAssistant = true,
  } = options;

  const topK = recall?.topK ?? DEFAULT_TOP_K;
  const minScore = recall?.minScore ?? DEFAULT_MIN_SCORE;

  // Per-turn state. A fresh middleware instance is created per agent (and per
  // checkpoint reconstruction), so these are scoped to a single turn's lifetime.
  let recalledThisTurn = false;
  let pendingUserInput: string | undefined;

  return {
    name: 'memory:recall',
    priority,
    failOpen: true,

    beforeTurn(ctx) {
      recalledThisTurn = false;
      pendingUserInput = ctx.userInput;
    },

    async beforeLlmStep(ctx) {
      if (!semantic && !working) return;
      // Recall once per turn; later agentic-loop iterations reuse the injected
      // reminders already in history rather than re-embedding.
      if (recalledThisTurn) return;
      recalledThisTurn = true;

      const appendMessages: Msg[] = [];

      if (semantic) {
        const query = lastRealUserText(ctx.messages) ?? pendingUserInput;
        if (query && query.trim()) {
          const hits = await semantic.recall(query, {
            threadId,
            resourceId,
            topK,
            minScore,
          });
          if (hits.length > 0) {
            const body = hits.map(h => `- ${h.text}`).join('\n');
            appendMessages.push(
              wrapReminder(
                RECALL_VARIANT,
                `Relevant context recalled from earlier in this conversation:\n${body}`
              )
            );
          }
        }
      }

      if (working) {
        const doc = await working.read({ threadId, resourceId });
        if (doc && doc.trim()) {
          appendMessages.push(
            wrapReminder(
              WORKING_VARIANT,
              `Working memory for this session:\n${doc}`
            )
          );
        }
      }

      if (appendMessages.length > 0) return { appendMessages };
      return undefined;
    },

    async afterTurn(ctx) {
      if (!semantic) return;
      const entries: MemoryEntry[] = [];
      const createdAt = new Date().toISOString();

      if (persistUser && pendingUserInput && pendingUserInput.trim()) {
        entries.push({
          id: randomUUID(),
          text: pendingUserInput,
          threadId,
          resourceId,
          role: 'user',
          createdAt,
        });
      }
      if (persistAssistant && ctx.assistantText && ctx.assistantText.trim()) {
        entries.push({
          id: randomUUID(),
          text: ctx.assistantText,
          threadId,
          resourceId,
          role: 'assistant',
          createdAt,
        });
      }

      pendingUserInput = undefined;
      if (entries.length > 0) await semantic.rememberMany(entries);
    },
  };
}
