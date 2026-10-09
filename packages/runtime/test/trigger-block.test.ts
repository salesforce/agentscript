/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  parseTriggerBlockFromSource,
  matchTrigger,
  matchGlobList,
  renderPrompt,
  buildEventContext,
  TriggerParseError,
  type GitEvent,
  type TriggerSpec,
} from '../src/trigger-block.js';

const PR_REVIEW_SOURCE = `trigger:
  on:
    - event: pull_request
      actions: [opened, synchronize, reopened]
      branches: ["main", "release/*"]
      paths: ["src/**", "!**/*.md"]
    - event: issue_comment
      actions: [created]
      comment_command: "/review"
  prompt: |
    Review PR #{{pr.number}} ({{pr.head.sha}}) against {{pr.base.ref}}.
  budget: { maxIterations: 20, turnTimeoutMs: 120000 }
  report: pr_review_comment
  concurrency: cancel-in-progress
  fork_policy: read_only

server:
  llm: { provider: anthropic, model: claude-x, api_key: env(ANTHROPIC_API_KEY) }

system: |
  You are a senior reviewer.
`;

describe('parseTriggerBlockFromSource', () => {
  it('parses a full trigger block out of band', () => {
    const spec = parseTriggerBlockFromSource(PR_REVIEW_SOURCE);
    expect(spec).toBeDefined();
    expect(spec!.on).toHaveLength(2);
    expect(spec!.on[0]!.event).toBe('pull_request');
    expect(spec!.on[0]!.branches).toEqual(['main', 'release/*']);
    expect(spec!.on[1]!.comment_command).toBe('/review');
    expect(spec!.report).toBe('pr_review_comment');
    expect(spec!.fork_policy).toBe('read_only');
    expect(spec!.budget?.maxIterations).toBe(20);
  });

  it('returns undefined when there is no trigger block', () => {
    expect(parseTriggerBlockFromSource('system: |\n  hi\n')).toBeUndefined();
  });

  it('stops the block at the next top-level key', () => {
    const spec = parseTriggerBlockFromSource(PR_REVIEW_SOURCE);
    // The `server:` block that follows must not bleed into the trigger spec.
    expect(Object.keys(spec as object)).not.toContain('llm');
  });

  it('throws on an invalid trigger block rather than silently dropping it', () => {
    const bad = `trigger:\n  on:\n    - event: not_a_real_event\n`;
    expect(() => parseTriggerBlockFromSource(bad)).toThrow(TriggerParseError);
  });

  it('throws when on[] is empty', () => {
    expect(() => parseTriggerBlockFromSource(`trigger:\n  on: []\n`)).toThrow(
      TriggerParseError
    );
  });
});

describe('matchGlobList', () => {
  it('matches * within a path segment', () => {
    expect(matchGlobList('main', ['main', 'release/*'])).toBe(true);
    expect(matchGlobList('release/1.0', ['release/*'])).toBe(true);
    expect(matchGlobList('feature/x', ['release/*'])).toBe(false);
  });

  it('matches ** across segments and honors negation', () => {
    expect(matchGlobList('src/a/b.ts', ['src/**'])).toBe(true);
    expect(matchGlobList('src/x.ts', ['src/**'])).toBe(true); // ** collapses to zero segments
    expect(matchGlobList('docs/x.md', ['src/**'])).toBe(false);
    expect(matchGlobList('src/readme.md', ['src/**', '!**/*.md'])).toBe(false);
  });

  it('treats a negation-only list as match-all-then-subtract', () => {
    expect(matchGlobList('a.ts', ['!**/*.md'])).toBe(true);
    expect(matchGlobList('a.md', ['!**/*.md'])).toBe(false);
  });
});

describe('matchTrigger', () => {
  const spec = parseTriggerBlockFromSource(PR_REVIEW_SOURCE)!;

  const prEvent = (over: Partial<GitEvent> = {}): GitEvent => ({
    event: 'pull_request',
    action: 'opened',
    repo: 'acme/widgets',
    branch: 'main',
    changedPaths: ['src/index.ts'],
    pr: { number: 7, base: { ref: 'main' }, head: { sha: 'abc123' } },
    ...over,
  });

  it('matches an opened PR to main touching src', () => {
    const m = matchTrigger(spec, prEvent());
    expect(m.matched).toBe(true);
    expect(m.entry?.event).toBe('pull_request');
  });

  it('drops a PR action not in the actions list', () => {
    expect(matchTrigger(spec, prEvent({ action: 'labeled' })).matched).toBe(
      false
    );
  });

  it('drops a PR to a non-matching base branch', () => {
    expect(matchTrigger(spec, prEvent({ branch: 'dev' })).matched).toBe(false);
  });

  it('drops a PR that only touches excluded paths', () => {
    expect(
      matchTrigger(spec, prEvent({ changedPaths: ['README.md'] })).matched
    ).toBe(false);
  });

  it('matches an issue_comment only when it starts with the command', () => {
    const base: GitEvent = {
      event: 'issue_comment',
      action: 'created',
      repo: 'acme/widgets',
      issue: { number: 7 },
      comment: { body: '/review please' },
    };
    expect(matchTrigger(spec, base).matched).toBe(true);
    expect(
      matchTrigger(spec, { ...base, comment: { body: 'looks good' } }).matched
    ).toBe(false);
  });

  it('reports a reason when nothing matched', () => {
    const m = matchTrigger(spec, {
      event: 'push',
      repo: 'acme/widgets',
      branch: 'main',
    });
    expect(m.matched).toBe(false);
    expect(m.reason).toBeTruthy();
  });

  it('matches any action when the entry omits actions', () => {
    const anyAction: TriggerSpec = {
      on: [{ event: 'push', branches: ['main'] }],
    };
    expect(
      matchTrigger(anyAction, { event: 'push', repo: 'r', branch: 'main' })
        .matched
    ).toBe(true);
  });
});

describe('renderPrompt / buildEventContext', () => {
  const event: GitEvent = {
    event: 'pull_request',
    action: 'opened',
    repo: 'acme/widgets',
    branch: 'main',
    changedPaths: ['src/a.ts', 'src/b.ts'],
    pr: {
      number: 42,
      title: 'Add feature',
      base: { ref: 'main' },
      head: { sha: 'deadbeef' },
    },
  };

  it('fills dotted placeholders from the event', () => {
    const out = renderPrompt(
      'PR #{{pr.number}} ({{pr.head.sha}}) -> {{pr.base.ref}}',
      event
    );
    expect(out).toBe('PR #42 (deadbeef) -> main');
  });

  it('renders unknown placeholders as empty string', () => {
    expect(renderPrompt('x={{pr.nope.deep}}', event)).toBe('x=');
  });

  it('joins array placeholders with commas', () => {
    expect(renderPrompt('{{changedPaths}}', event)).toBe('src/a.ts, src/b.ts');
  });

  it('exposes a stable context shape', () => {
    const ctx = buildEventContext(event);
    expect(ctx.repo).toBe('acme/widgets');
    expect((ctx.pr as { number: number }).number).toBe(42);
    expect(ctx.isFork).toBe(false);
  });
});
