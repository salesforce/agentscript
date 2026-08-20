/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type {
  AstNodeLike,
  AstRoot,
  LintPass,
  PassStore,
} from '@agentscript/language';
import {
  attachDiagnostic,
  decomposeAtMemberChain,
  decomposeAtMemberExpression,
  isNamedMap,
  lintDiagnostic,
  storeKey,
} from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';

const AGENT_NAMESPACES = new Set(['subagent', 'connected_subagent']);

function rangeOf(node: AstNodeLike) {
  return (
    node.__cst?.range ?? {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    }
  );
}

function attachError(node: AstNodeLike, message: string, code: string): void {
  attachDiagnostic(
    node,
    lintDiagnostic(rangeOf(node), message, DiagnosticSeverity.Error, code)
  );
}

const CRON_SHORTHANDS = new Set([
  '@yearly',
  '@annually',
  '@monthly',
  '@weekly',
  '@daily',
  '@midnight',
  '@hourly',
]);

const MONTH_NAMES: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

const DOW_NAMES: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

/**
 * Validate a single cron field. Returns null on success or a human-readable
 * reason string on failure.
 */
function validateCronField(
  field: string,
  min: number,
  max: number,
  named?: Record<string, number>
): string | null {
  const toNum = (raw: string): number | null => {
    const lower = raw.toLowerCase();
    if (named && lower in named) return named[lower];
    if (!/^\d+$/.test(raw)) return null;
    return Number(raw);
  };

  const inRange = (raw: string): boolean => {
    const value = toNum(raw);
    return value !== null && value >= min && value <= max;
  };

  for (const part of field.split(',')) {
    const stepParts = part.split('/');
    if (stepParts.length > 2) return `invalid step syntax in "${part}"`;

    const [base, step] = stepParts;
    if (step !== undefined) {
      if (!/^\d+$/.test(step) || Number(step) < 1)
        return `step value in "${part}" must be a positive integer`;
    }

    if (base === '*') continue;

    const rangeParts = base.split('-');
    if (rangeParts.length === 1) {
      if (!inRange(base)) {
        const num = toNum(base);
        if (num === null) return `"${base}" is not a valid value`;
        return `${num} is out of range (${min}–${max})`;
      }
    } else if (rangeParts.length === 2) {
      const [start, end] = rangeParts;
      const startNum = toNum(start);
      const endNum = toNum(end);
      if (startNum === null) return `"${start}" is not a valid value`;
      if (endNum === null) return `"${end}" is not a valid value`;
      if (startNum < min || startNum > max)
        return `${startNum} is out of range (${min}–${max})`;
      if (endNum < min || endNum > max)
        return `${endNum} is out of range (${min}–${max})`;
      if (startNum > endNum)
        return `range start ${startNum} must not exceed end ${endNum}`;
    } else {
      return `invalid range syntax in "${part}"`;
    }
  }
  return null;
}

const CRON_FIELD_NAMES = [
  'minute (0–59)',
  'hour (0–23)',
  'day-of-month (1–31)',
  'month (1–12 or JAN–DEC)',
  'day-of-week (0–7 or SUN–SAT)',
] as const;

const CRON_BOUNDS: [number, number, Record<string, number> | undefined][] = [
  [0, 59, undefined],
  [0, 23, undefined],
  [1, 31, undefined],
  [1, 12, MONTH_NAMES],
  [0, 7, DOW_NAMES],
];

/**
 * Validate a standard cron expression. Returns null on success or
 * a human-readable error message describing exactly what is wrong.
 *
 * Accepts:
 * - Five-field cron: `minute hour day-of-month month day-of-week`
 * - Named months: JAN–DEC (case-insensitive)
 * - Named days of week: SUN–SAT (case-insensitive); 0 and 7 both represent Sunday
 * - Shorthands: @yearly, @annually, @monthly, @weekly, @daily, @midnight, @hourly
 */
export function validateCron(schedule: string): string | null {
  const trimmed = schedule.trim();

  if (CRON_SHORTHANDS.has(trimmed.toLowerCase())) return null;

  // Looks like a shorthand (@word) but isn't a known one.
  if (/^@\w+$/.test(trimmed)) {
    const valid = [...CRON_SHORTHANDS].join(', ');
    return `"${trimmed}" is not a recognised shorthand. Valid shorthands: ${valid}`;
  }

  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) {
    return `expected 5 fields (minute hour day-of-month month day-of-week) or a shorthand (@yearly, @monthly, @weekly, @daily, @hourly), but got ${fields.length} field${fields.length === 1 ? '' : 's'}`;
  }

  for (let i = 0; i < 5; i++) {
    const [min, max, named] = CRON_BOUNDS[i];
    const reason = validateCronField(fields[i], min, max, named);
    if (reason !== null) {
      return `${CRON_FIELD_NAMES[i]}: ${reason}`;
    }
  }
  return null;
}

/** Convenience wrapper — returns true when the expression is valid. */
export function isValidCron(schedule: string): boolean {
  return validateCron(schedule) === null;
}

class AgentIqValidationPass implements LintPass {
  readonly id = storeKey('agentiq-validation');
  readonly description =
    'Validates AgentIQ workflow, trigger, and orchestrator semantics';

  run(_store: PassStore, root: AstRoot): void {
    const rootFields = root as Record<string, unknown>;
    this.validateWorkflows(rootFields.workflows);
    this.validateTriggers(rootFields.trigger);
    this.validateSubagentBundles(rootFields.subagent);
    this.validateSubagentBundles(rootFields.start_agent);
  }

  private validateWorkflows(value: unknown): void {
    if (!isNamedMap(value)) return;

    for (const [, rawWorkflow] of value) {
      const workflow = rawWorkflow as AstNodeLike;
      const hasAgent = workflow.agent !== undefined;
      const hasPrompt = workflow.prompt !== undefined;

      if (!hasAgent && !hasPrompt) {
        attachError(
          workflow,
          "Workflow must define 'agent', 'prompt', or both",
          'workflow-exactly-one-target'
        );
      }

      if (hasAgent) {
        const agent = workflow.agent as AstNodeLike;
        const ref = decomposeAtMemberExpression(agent);
        if (!ref || !AGENT_NAMESPACES.has(ref.namespace)) {
          attachError(
            agent,
            "'agent' must reference @subagent or @connected_subagent",
            'invalid-workflow-agent'
          );
        }
      }
    }
  }

  private validateTriggers(value: unknown): void {
    if (!isNamedMap(value)) return;

    for (const [, rawTrigger] of value) {
      const trigger = rawTrigger as AstNodeLike;
      const schedule = trigger.schedule as
        | (AstNodeLike & { value?: unknown })
        | undefined;
      if (schedule && typeof schedule.value === 'string') {
        const cronError = validateCron(schedule.value);
        if (cronError !== null) {
          attachError(
            schedule,
            `Invalid cron schedule — ${cronError}`,
            'invalid-cron-schedule'
          );
        }
      }

      if (trigger.target !== undefined) {
        const target = trigger.target as AstNodeLike;
        const ref = decomposeAtMemberChain(target);
        const isAgentWorkflow =
          ref?.namespace === 'workflows' && ref.path.length === 1;
        const isBundleWorkflow =
          ref?.namespace === 'bundles' &&
          ref.path.length === 3 &&
          ref.path[1] === 'workflows';
        if (!isAgentWorkflow && !isBundleWorkflow) {
          attachError(
            target,
            "'target' must reference @workflows.<workflow> or @bundles.<bundle>.workflows.<workflow>",
            'invalid-trigger-target'
          );
        }
      }
    }
  }

  private validateSubagentBundles(value: unknown): void {
    if (!isNamedMap(value)) return;

    for (const [name, rawNode] of value) {
      const node = rawNode as AstNodeLike;
      const bundles = node.bundles as AstNodeLike & { items?: unknown[] };
      // Use __kind check instead of instanceof — avoids module identity issues.
      if (!bundles || bundles.__kind !== 'Sequence') continue;
      if (!Array.isArray(bundles.items)) continue;

      for (const item of bundles.items) {
        const ref = decomposeAtMemberExpression(item);
        if (ref?.namespace === 'bundles') continue;

        attachError(
          item as AstNodeLike,
          `Subagent '${name}' bundles must use @bundles.<name> (e.g. @bundles.targeting)`,
          'invalid-node-bundle-reference'
        );
      }
    }
  }
}

export function agentIqValidationPass(): LintPass {
  return new AgentIqValidationPass();
}
