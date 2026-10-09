/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

/**
 * Git-event trigger vocabulary. A repo author declares, inside a `.agent` file
 * under `.agentscript/`, a top-level `trigger:` block that binds git events
 * (PR opened, push, issue comment, schedule) to that agent workflow. Like the
 * `server:` block, this is parsed OUT OF BAND straight from the YAML source —
 * the compiler/dialect strips unknown top-level keys before compilation, so a
 * `trigger:` block never survives into the compiled IR on its own.
 *
 * The same normalized {@link GitEvent} is produced by both ingress paths (the
 * hosted webhook receiver and `agentscript ci`), so {@link matchTrigger} is the
 * single source of truth for "does this delivery fire this workflow?".
 */

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/** Git event kinds a trigger can bind to. GitHub-shaped, forge-neutral names. */
export const TRIGGER_EVENTS = [
  'pull_request',
  'push',
  'issue_comment',
  'issues',
  'schedule',
] as const;

export type TriggerEvent = (typeof TRIGGER_EVENTS)[number];

/** Where a run's result is posted back. `none` = run for effect only. */
export const REPORT_TARGETS = [
  'pr_review_comment',
  'issue_comment',
  'check_run',
  // A full PR *review* (not a plain comment): the workflow derives a `verdict`
  // state variable (approve|request_changes|comment) that the core reads off the
  // finished run's runtime state, so the agent can APPROVE a clean PR or
  // REQUEST_CHANGES on a heavy one — not just comment. A read-only (fork) run
  // cannot post a review verdict and is downgraded to a comment by the core.
  'pr_review',
  'none',
] as const;

export type ReportTarget = (typeof REPORT_TARGETS)[number];

const triggerOnEntrySchema = z
  .object({
    /** Which git event this entry matches. */
    event: z.enum(TRIGGER_EVENTS),
    /**
     * Event actions to match (e.g. `opened`, `synchronize`, `created`). Empty /
     * omitted = match any action for the event.
     */
    actions: z.array(z.string()).optional(),
    /**
     * Branch globs (the PR base ref for `pull_request`, the pushed ref for
     * `push`). Supports `*`/`**` and leading `!` negation. Omitted = any branch.
     */
    branches: z.array(z.string()).optional(),
    /**
     * Changed-path globs. A delivery matches when at least one changed file
     * matches a positive glob and none of the negated (`!`) globs exclude it.
     * Omitted = any path.
     */
    paths: z.array(z.string()).optional(),
    /**
     * For `issue_comment` only: the run fires only when the comment body starts
     * with this command token (e.g. `/review`).
     */
    comment_command: z.string().optional(),
  })
  .strict();

export type TriggerOnEntry = z.infer<typeof triggerOnEntrySchema>;

export const triggerSchema = z
  .object({
    /** One or more event bindings. Any matching entry fires the workflow. */
    on: z.array(triggerOnEntrySchema).min(1),
    /**
     * Prompt template sent to the agent as the run goal. `{{path.to.field}}`
     * placeholders are filled from the event context (see
     * {@link buildEventContext}). Omitted = a generic default is synthesized by
     * the run-core from the event.
     */
    prompt: z.string().optional(),
    /** Per-run budget forwarded to the autonomous loop. */
    budget: z
      .object({
        maxIterations: z.number().int().positive().optional(),
        turnTimeoutMs: z.number().int().positive().optional(),
        /**
         * Token ceiling for the run's context window: forwarded to the coding
         * harness as its compaction `budgetTokens`, so a long review compacts
         * rather than growing unbounded. This is the workflow-author's knob; the
         * ingress can additionally clamp it to a per-installation cap (see
         * {@link RunGitEventOptions.maxTokens}). Omitted = the harness default.
         */
        maxTokens: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    /** Where to post the result. Default: `none`. */
    report: z.enum(REPORT_TARGETS).optional(),
    /**
     * Serialization policy for overlapping deliveries sharing a key (e.g. the
     * same PR). `cancel-in-progress` aborts an older run when a newer delivery
     * arrives; `queue` serializes them. Advisory to the ingress layer.
     */
    concurrency: z.enum(['cancel-in-progress', 'queue']).optional(),
    /**
     * How much trust to grant a run whose HEAD is a fork. `read_only` (default)
     * withholds any write-scoped token — the run can comment / post a check but
     * cannot push. `trusted` grants the same scope as an internal-branch run.
     * This is the core RCE / prompt-injection control: repo-authored `.agent`
     * code from an untrusted fork must not run with write credentials unless the
     * maintainer explicitly opts in.
     */
    fork_policy: z.enum(['read_only', 'trusted']).optional(),
  })
  .strict();

export type TriggerSpec = z.infer<typeof triggerSchema>;

// ---------------------------------------------------------------------------
// Normalized git event
// ---------------------------------------------------------------------------

/**
 * A normalized git event, produced by an ingress adapter (webhook or CI) from
 * the raw forge payload. {@link matchTrigger} and {@link buildEventContext}
 * consume only this — never the raw payload — so the matcher is forge-agnostic
 * and unit-testable without a GitHub fixture.
 */
export interface GitEvent {
  /** Event kind. */
  event: TriggerEvent;
  /** Event action, when the forge provides one (e.g. `opened`, `created`). */
  action?: string;
  /** `owner/name` of the repository the event targets. */
  repo: string;
  /**
   * The branch the trigger's `branches` globs are matched against: the PR base
   * ref for `pull_request`, the short pushed ref for `push`. Undefined when the
   * event has no meaningful branch (e.g. `schedule`).
   */
  branch?: string;
  /** Paths changed by the event (PR files / pushed commit files), if known. */
  changedPaths?: string[];
  /** True when HEAD comes from a fork — gates the write-token decision. */
  isFork?: boolean;
  /** Pull-request context, present for `pull_request` / PR-scoped comments. */
  pr?: {
    number: number;
    title?: string;
    base?: { ref?: string; sha?: string };
    head?: { ref?: string; sha?: string; repo?: string };
  };
  /** Issue context, present for `issues` / `issue_comment`. */
  issue?: { number: number; title?: string };
  /** Comment context, present for `issue_comment`. */
  comment?: { body: string; author?: string };
  /** Actor who triggered the event, when known. */
  sender?: string;
  /**
   * The raw forge payload, retained for prompt templating of fields the
   * normalized shape does not model. Never matched against.
   */
  raw?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Glob matching (self-contained; no minimatch dependency)
// ---------------------------------------------------------------------------

/**
 * Compile a single glob to a RegExp. Supports `*` (any run of non-`/` chars),
 * `**` (any run including `/`), and `?`. Anchored full-match. Kept dependency
 * -free and deliberately small — this is not a full minimatch.
 */
function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**` → any chars including `/`. Swallow an immediately following `/`
        // so `src/**/x` also matches `src/x`.
        i++;
        if (glob[i + 1] === '/') i++;
        re += '.*';
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

/**
 * Match a value against a glob list with `!`-prefixed negation. A value matches
 * when at least one positive glob matches AND no negative glob matches. A list
 * of only negations treats the baseline as "match everything, then subtract".
 */
export function matchGlobList(
  value: string,
  globs: readonly string[]
): boolean {
  let anyPositive = false;
  let positiveHit = false;
  for (const g of globs) {
    if (g.startsWith('!')) {
      if (globToRegExp(g.slice(1)).test(value)) return false;
    } else {
      anyPositive = true;
      if (globToRegExp(g).test(value)) positiveHit = true;
    }
  }
  return anyPositive ? positiveHit : true;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** Why a trigger entry did not match — surfaced for diagnostics/logging. */
export interface TriggerMatch {
  matched: boolean;
  /** The `on[]` entry that matched, when `matched` is true. */
  entry?: TriggerOnEntry;
  /** Human-readable reason a delivery was dropped, when `matched` is false. */
  reason?: string;
}

/**
 * Decide whether a {@link GitEvent} fires a workflow's {@link TriggerSpec}.
 * Returns the matching `on[]` entry so the caller can apply entry-specific
 * behavior. Pure and synchronous — the single source of truth shared by every
 * ingress path.
 */
export function matchTrigger(spec: TriggerSpec, event: GitEvent): TriggerMatch {
  const reasons: string[] = [];
  for (const entry of spec.on) {
    if (entry.event !== event.event) {
      reasons.push(`event ${event.event} != ${entry.event}`);
      continue;
    }
    if (
      entry.actions &&
      entry.actions.length > 0 &&
      (event.action === undefined || !entry.actions.includes(event.action))
    ) {
      reasons.push(
        `action ${event.action ?? '(none)'} not in [${entry.actions.join(', ')}]`
      );
      continue;
    }
    if (entry.branches && entry.branches.length > 0) {
      const branch = event.branch;
      if (branch === undefined || !matchGlobList(branch, entry.branches)) {
        reasons.push(`branch ${branch ?? '(none)'} not in branch globs`);
        continue;
      }
    }
    if (entry.paths && entry.paths.length > 0) {
      const paths = event.changedPaths ?? [];
      const anyPathMatches = paths.some(p => matchGlobList(p, entry.paths!));
      if (!anyPathMatches) {
        reasons.push('no changed path matched path globs');
        continue;
      }
    }
    if (entry.comment_command !== undefined) {
      if (event.event !== 'issue_comment') {
        reasons.push('comment_command set on a non-issue_comment entry');
        continue;
      }
      const body = event.comment?.body?.trimStart() ?? '';
      if (!body.startsWith(entry.comment_command)) {
        reasons.push(`comment does not start with "${entry.comment_command}"`);
        continue;
      }
    }
    return { matched: true, entry };
  }
  return { matched: false, reason: reasons.join('; ') || 'no trigger entries' };
}

// ---------------------------------------------------------------------------
// Prompt templating + event context
// ---------------------------------------------------------------------------

/**
 * Build the flat template context from a {@link GitEvent}. These keys are what
 * `{{...}}` placeholders in a `trigger.prompt` resolve against. Values are
 * pre-stringified so templating never has to reason about types.
 */
export function buildEventContext(event: GitEvent): Record<string, unknown> {
  return {
    event: event.event,
    action: event.action,
    repo: event.repo,
    branch: event.branch,
    sender: event.sender,
    isFork: event.isFork ?? false,
    changedPaths: event.changedPaths ?? [],
    pr: event.pr
      ? {
          number: event.pr.number,
          title: event.pr.title,
          base: { ref: event.pr.base?.ref, sha: event.pr.base?.sha },
          head: {
            ref: event.pr.head?.ref,
            sha: event.pr.head?.sha,
            repo: event.pr.head?.repo,
          },
        }
      : undefined,
    issue: event.issue
      ? { number: event.issue.number, title: event.issue.title }
      : undefined,
    comment: event.comment
      ? { body: event.comment.body, author: event.comment.author }
      : undefined,
  };
}

/** Resolve a dotted path (`pr.head.sha`) against a nested context object. */
function resolvePath(ctx: Record<string, unknown>, path: string): unknown {
  let cur: unknown = ctx;
  for (const key of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/**
 * Render a `{{dotted.path}}` template against a {@link GitEvent}. Unknown or
 * nullish placeholders render as an empty string (a missing PR title should not
 * abort a run). Arrays render comma-joined; objects as JSON.
 */
export function renderPrompt(template: string, event: GitEvent): string {
  const ctx = buildEventContext(event);
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, path: string) => {
    const value = resolvePath(ctx, path);
    if (value === undefined || value === null) return '';
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  });
}

// ---------------------------------------------------------------------------
// Out-of-band source parsing
// ---------------------------------------------------------------------------

/**
 * Extract and validate the optional top-level `trigger:` block from `.agent`
 * source. Mirrors {@link parseServerBlockFromSource}: the block is read
 * directly from YAML because dialect schemas strip unknown top-level keys
 * before compilation, so it would otherwise be lost.
 *
 * Returns `undefined` when no block is present. THROWS a
 * {@link TriggerParseError} when a block is present but malformed, so a typo
 * fails loudly at load/build time rather than silently never firing.
 */
export function parseTriggerBlockFromSource(
  source: string
): TriggerSpec | undefined {
  const lines = source.split('\n');
  const startIdx = lines.findIndex(line => /^trigger:\s*$/.test(line));
  if (startIdx < 0) return undefined;
  const captured: string[] = ['trigger:'];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '') {
      captured.push(line);
      continue;
    }
    // A non-indented line ends the block (next top-level key).
    if (/^\S/.test(line)) break;
    captured.push(line);
  }
  let raw: unknown;
  try {
    raw = parseYaml(captured.join('\n'));
  } catch (error) {
    throw new TriggerParseError(
      `Could not parse the trigger: block as YAML: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  if (!raw || typeof raw !== 'object') return undefined;
  const block = (raw as { trigger?: unknown }).trigger;
  if (block === undefined || block === null) return undefined;
  const result = triggerSchema.safeParse(block);
  if (!result.success) {
    throw new TriggerParseError(
      `Invalid trigger: block — ${result.error.issues
        .map(i => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ')}`
    );
  }
  return result.data;
}

/** Thrown when a present `trigger:` block is syntactically or structurally invalid. */
export class TriggerParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TriggerParseError';
  }
}
