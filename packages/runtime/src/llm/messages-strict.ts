/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Structural request-repair — a loop "escape hatch".
 *
 * Strict providers (Anthropic, and OpenAI-compatible ones) reject a request
 * whose message array is not wire-compliant: an assistant `tool_calls` with no
 * matching tool results, a stray tool result with no preceding call, duplicate
 * `tool_use` ids, or an empty assistant message. Because our runtime re-sends
 * the same conversation history on every turn, one such defect — most commonly
 * introduced when a tool batch is aborted mid-dispatch, leaving an assistant
 * `tool_calls` message without its results — would wedge the session on the
 * same 400 forever.
 *
 * `isRecoverableRequestStructureError` recognizes those rejections; when one is
 * caught, the turn loop resends ONCE with `buildMessagesStrict`, a
 * guaranteed-compliant rebuild (every open call closed with a synthetic result,
 * stray results dropped, duplicate ids deduped, empty assistant messages
 * dropped). Ported from the reference agent (kosong/src/errors.ts + loop/turn-step.ts),
 * narrowed to the defects our `Msg` shape can actually produce (no media).
 */

import type { Msg, ToolResultMsg } from './types.js';

/** Extract an HTTP status code from a provider error, if present. */
function statusCodeOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const rec = error as {
    statusCode?: unknown;
    status?: unknown;
    response?: { status?: unknown; statusCode?: unknown };
  };
  if (typeof rec.statusCode === 'number') return rec.statusCode;
  if (typeof rec.status === 'number') return rec.status;
  const resp = rec.response;
  if (resp && typeof resp === 'object') {
    if (typeof resp.statusCode === 'number') return resp.statusCode;
    if (typeof resp.status === 'number') return resp.status;
  }
  return undefined;
}

// Wordings a strict provider uses when the tool_use/tool_result exchange is
// malformed — a missing result, a stray result, or a non-adjacent pairing.
// Covers Anthropic (`tool_use`/`tool_result`) and OpenAI-compatible providers
// (`tool_call_id` / `role 'tool'` / `tool_calls`). See the reference agent's
// TOOL_EXCHANGE_ADJACENCY_MESSAGE_PATTERNS.
const TOOL_EXCHANGE_PATTERNS = [
  /tool_use[\s\S]*tool_result/,
  /tool_result[\s\S]*tool_use/,
  /unexpected\s+`?tool_result/,
  /tool_call_id[\s\S]*not found/,
  /role\s+['"`]?tool['"`]?\s+must be a response to a preceding message/,
  /assistant message with\s+['"`]?tool_calls['"`]?\s+must be followed by tool messages/,
  /tool_call_ids? did not have response messages/,
  /insufficient tool messages following/,
] as const;

// The broader family of malformed-message-array rejections. Context-overflow
// 400s are deliberately excluded (they route to compaction, not re-projection).
const STRUCTURAL_PATTERNS = [
  /text content blocks must be non-empty/,
  /text content blocks must contain non-whitespace/,
  /first message must use the .*user.* role/,
  /roles must alternate/,
  /multiple .*(?:user|assistant).* roles in a row/,
  /tool_use[\s\S]*ids must be unique/,
  /message at position \d+ with role ['"`]?[a-z]+['"`]? must not be empty/,
] as const;

const CONTEXT_OVERFLOW_PATTERNS = [
  /context[ _-]?length/,
  /context[ _-]?window/,
  /maximum context/,
  /too many tokens/,
  /prompt is too long/,
  /reduce the length/,
  /exceeds? the (?:maximum|model'?s?) (?:context|token)/,
  /input is too long/,
] as const;

/**
 * Whether `error` is a structural request rejection that a strict re-projection
 * can repair. Only deterministic 400/422 request-validation failures qualify;
 * context-overflow 400s (handled by compaction) are excluded.
 */
export function isRecoverableRequestStructureError(error: unknown): boolean {
  const status = statusCodeOf(error);
  if (status !== 400 && status !== 422) return false;
  const message = (
    error instanceof Error ? error.message : String(error)
  ).toLowerCase();
  // Never treat a context-overflow rejection as a structural one.
  if (CONTEXT_OVERFLOW_PATTERNS.some(p => p.test(message))) return false;
  return (
    TOOL_EXCHANGE_PATTERNS.some(p => p.test(message)) ||
    STRUCTURAL_PATTERNS.some(p => p.test(message))
  );
}

/**
 * Whether `error` is a context-overflow rejection: the request's token count
 * exceeded the model's window. These are the 400s deliberately EXCLUDED from
 * {@link isRecoverableRequestStructureError} — a strict re-projection won't help
 * because the array is well-formed, just too big. The turn loop recovers by
 * forcing a compaction pass and resending once. Recognized on any status (some
 * providers use 400, others 413) as long as the wording matches; a context
 * overflow is inherently a request-size failure, so status is advisory.
 */
export function isContextOverflowError(error: unknown): boolean {
  const message = (
    error instanceof Error ? error.message : String(error)
  ).toLowerCase();
  return CONTEXT_OVERFLOW_PATTERNS.some(p => p.test(message));
}

function isToolCallMsg(m: Msg): m is Extract<Msg, { tool_calls: unknown }> {
  return (
    m.role === 'assistant' &&
    Array.isArray((m as { tool_calls?: unknown }).tool_calls)
  );
}

function syntheticMissingResult(id: string, name: string): ToolResultMsg {
  return {
    role: 'tool',
    tool_call_id: id,
    tool_name: name,
    content: JSON.stringify({
      error:
        'Tool result missing — the call did not complete (interrupted or ' +
        'aborted). This placeholder keeps the request wire-valid.',
    }),
    is_error: true,
  };
}

/**
 * Rebuild `messages` into a strictly wire-compliant array:
 *
 *  - duplicate `tool_use` ids are deduped (first occurrence kept);
 *  - each assistant `tool_calls` is immediately followed by exactly one tool
 *    result per surviving call, in call order — a missing result is
 *    synthesized, results for unknown ids are dropped;
 *  - stray tool results with no preceding matching call are dropped;
 *  - empty assistant messages (no text, no tool calls) are dropped.
 *
 * The projection is idempotent: a compliant history passes through unchanged
 * (modulo dropping already-invalid fragments).
 */
export function buildMessagesStrict(messages: readonly Msg[]): Msg[] {
  const seenCallIds = new Set<string>();
  const out: Msg[] = [];
  let i = 0;

  while (i < messages.length) {
    const m = messages[i];

    if (isToolCallMsg(m)) {
      // Dedupe this message's calls against every id seen so far.
      const calls = m.tool_calls.filter(c => {
        if (seenCallIds.has(c.id)) return false;
        seenCallIds.add(c.id);
        return true;
      });

      // Consume the run of tool results that follow this assistant message.
      const resultsById = new Map<string, ToolResultMsg>();
      let j = i + 1;
      while (j < messages.length && messages[j].role === 'tool') {
        const tr = messages[j] as ToolResultMsg;
        if (!resultsById.has(tr.tool_call_id))
          resultsById.set(tr.tool_call_id, tr);
        j++;
      }

      if (calls.length === 0) {
        // Every call was a duplicate → drop the assistant message and any of
        // its (now-orphaned) results.
        i = j;
        continue;
      }

      out.push({ ...m, tool_calls: calls });
      for (const c of calls) {
        out.push(resultsById.get(c.id) ?? syntheticMissingResult(c.id, c.name));
      }
      // Results whose id matched no surviving call are dropped implicitly.
      i = j;
      continue;
    }

    // A tool result reached here without a preceding assistant tool_calls run
    // that consumed it → stray, drop it.
    if (m.role === 'tool') {
      i++;
      continue;
    }

    // Drop empty assistant text messages (no content, no tool calls).
    if (
      m.role === 'assistant' &&
      String((m as { content?: unknown }).content ?? '').trim() === ''
    ) {
      i++;
      continue;
    }

    out.push(m);
    i++;
  }

  return out;
}
