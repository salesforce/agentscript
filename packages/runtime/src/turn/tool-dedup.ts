/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Repeated-identical-tool-call detection — a loop escape hatch ported from
 * the reference agent's `agent/turn/tool-dedup.ts`. When the model issues
 * the exact same `(toolName, args)` call over and over (a classic ReAct
 * spin), the result handed back is suffixed with an escalating
 * <system-reminder> that pushes the model to reason about what it actually
 * expects, then to decide, then to conclude. Past a hard streak ceiling the
 * turn is force-stopped so the loop cannot keep burning steps on the same
 * call.
 *
 * Divergence from the reference agent: it additionally reuses a same-step
 * duplicate's result (a deferred handshake between prepare/finalize) so an
 * identical call issued twice in ONE model step executes the tool once. Our
 * runtime dispatches a lone repeated call on the SEQUENTIAL path
 * (`calls.length === 1` never parallelizes), and a genuine spin is
 * inherently step-by-step, so we only need the cross-step streak counter —
 * no same-step deferred reuse. The reminder texts and the streak thresholds
 * match the reference agent verbatim for behavioral parity.
 */

/** Streak at which each escalation kicks in (inclusive). Matches the reference agent. */
export const REPEAT_REMINDER_1_START = 3;
export const REPEAT_REMINDER_2_START = 5;
export const REPEAT_REMINDER_3_START = 8;
export const REPEAT_FORCE_STOP_STREAK = 12;

/** Which escalation (if any) a given streak triggered. */
export type DedupAction = 'none' | 'r1' | 'r2' | 'r3' | 'stop';

/** Outcome of recording a single dispatched tool call. */
export interface DedupDecision {
  /** How many times THIS exact call has now run consecutively (>= 1). */
  readonly streak: number;
  /** Reminder text to suffix onto the tool result, or null when none. */
  readonly reminder: string | null;
  /** True once the streak hits the force-stop ceiling — end the turn. */
  readonly forceStop: boolean;
  /** The escalation tier applied (for observability). */
  readonly action: DedupAction;
}

const REMINDER_TEXT_1 =
  '\n\n<system-reminder>\n' +
  'The same tool call has been repeated several times in a row. ' +
  'Before making your next call, write one sentence stating what new information you expect it to produce. ' +
  'Then act on that sentence: if it names something this result does not already give you, choose the action that best provides it; otherwise, continue with the evidence you already have.' +
  '\n</system-reminder>';

function makeReminderText2(repeatCount: number): string {
  return (
    '\n\n<system-reminder>\n' +
    `The same tool call has now been issued ${String(repeatCount)} times in a row. ` +
    'Choose exactly one of the following and state your choice before acting:\n' +
    '(1) Falsification check: run the cheapest test that could conclusively disprove your current approach, if such a test exists.\n' +
    '(2) Missing input: tell the user precisely what information or decision you need to proceed, and ask for it.\n' +
    '(3) Conclude: deliver your best result based on the evidence already gathered, listing anything that remains uncertain.' +
    '\n</system-reminder>'
  );
}

const REMINDER_TEXT_3 =
  '\n\n<system-reminder>\n' +
  'Write your final response now, without any further tool calls. ' +
  'Cover: the current blocker, each approach you have tried and what it established, and the specific information or decision you need from the user to unblock progress. ' +
  'Text only.' +
  '\n</system-reminder>';

/**
 * JSON canonicalization used for the dedup key: recursively sorts object keys so
 * semantically-equal args collapse to one identity. Ported from the reference agent's
 * `canonicalTelemetryArgs`.
 */
export function canonicalArgs(args: unknown): string {
  const json = JSON.stringify(sortJsonValue(args));
  return json ?? String(args);
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!isPlainRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = sortJsonValue(value[key]);
  }
  return out;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/**
 * Tracks the running tail of consecutive identical tool calls within a single
 * turn. `note()` is called once per dispatched call, in dispatch order, and
 * returns the escalation decision for that call. Reset per turn via `reset()`.
 */
export class ToolCallDeduplicator {
  private lastKey: string | null = null;
  private count = 0;

  /** Clear all streak state. Call at the start of each turn. */
  reset(): void {
    this.lastKey = null;
    this.count = 0;
  }

  /**
   * Record a dispatched `(toolName, args)` call and return whether — and how —
   * to nudge the model. A call that matches the running key extends the streak;
   * any different call resets it to 1.
   */
  note(toolName: string, args: unknown): DedupDecision {
    const key = `${toolName} ${canonicalArgs(args)}`;
    if (key === this.lastKey) {
      this.count += 1;
    } else {
      this.lastKey = key;
      this.count = 1;
    }
    const streak = this.count;

    if (streak >= REPEAT_FORCE_STOP_STREAK) {
      return {
        streak,
        reminder: REMINDER_TEXT_3,
        forceStop: true,
        action: 'stop',
      };
    }
    if (streak >= REPEAT_REMINDER_3_START) {
      return {
        streak,
        reminder: REMINDER_TEXT_3,
        forceStop: false,
        action: 'r3',
      };
    }
    if (streak >= REPEAT_REMINDER_2_START) {
      return {
        streak,
        reminder: makeReminderText2(streak),
        forceStop: false,
        action: 'r2',
      };
    }
    if (streak >= REPEAT_REMINDER_1_START) {
      return {
        streak,
        reminder: REMINDER_TEXT_1,
        forceStop: false,
        action: 'r1',
      };
    }
    return { streak, reminder: null, forceStop: false, action: 'none' };
  }
}

export const __testing = {
  REMINDER_TEXT_1,
  REMINDER_TEXT_3,
  makeReminderText2,
  REPEAT_REMINDER_1_START,
  REPEAT_REMINDER_2_START,
  REPEAT_REMINDER_3_START,
  REPEAT_FORCE_STOP_STREAK,
};
