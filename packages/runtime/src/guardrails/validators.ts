/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  Guardrail,
  GuardrailInput,
  GuardrailContext,
  GuardrailResult,
  GuardrailTarget,
} from './types.js';
import { validateSchema } from './schema-validator.js';

/**
 * Test a string against a pattern without mutating caller-supplied state.
 * RegExp objects with `g` or `y` flags advance `lastIndex` on `.test()`,
 * so using the caller's pattern directly across calls leaks state. Strings
 * are wrapped in a fresh case-insensitive RegExp.
 */
function patternTest(pattern: string | RegExp, input: string): boolean {
  if (typeof pattern === 'string') {
    return new RegExp(pattern, 'i').test(input);
  }
  if (pattern.global || pattern.sticky) {
    return new RegExp(pattern.source, pattern.flags).test(input);
  }
  return pattern.test(input);
}

// ---------------------------------------------------------------------------
// jsonSchemaGuardrail
// ---------------------------------------------------------------------------

export function jsonSchemaGuardrail(opts: {
  schema: Record<string, unknown>;
  name?: string;
  maxRetries?: number;
  feedbackTemplate?: string;
}): Guardrail {
  return {
    name: opts.name ?? 'json-schema',
    target: 'text',
    maxRetries: opts.maxRetries ?? 2,
    feedbackTemplate: opts.feedbackTemplate,
    validate(output) {
      try {
        const parsed = JSON.parse(output.text);
        const errors = validateSchema(parsed, opts.schema, '');
        if (errors.length === 0) return { valid: true };
        return {
          valid: false,
          reason: 'JSON Schema validation failed',
          errors,
        };
      } catch (e) {
        return {
          valid: false,
          reason: `Invalid JSON: ${(e as Error).message}`,
        };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// regexGuardrail
// ---------------------------------------------------------------------------

export function regexGuardrail(opts: {
  pattern: RegExp;
  invert?: boolean;
  name?: string;
  maxRetries?: number;
  feedbackTemplate?: string;
}): Guardrail {
  return {
    name: opts.name ?? `regex:${opts.pattern.source}`,
    target: 'text',
    maxRetries: opts.maxRetries ?? 1,
    feedbackTemplate: opts.feedbackTemplate,
    validate(output) {
      const matches = patternTest(opts.pattern, output.text);
      const valid = opts.invert ? !matches : matches;
      return {
        valid,
        reason: valid
          ? undefined
          : opts.invert
            ? `Output must NOT match pattern: ${opts.pattern.source}`
            : `Output must match pattern: ${opts.pattern.source}`,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// contentPolicyGuardrail
// ---------------------------------------------------------------------------

export function contentPolicyGuardrail(opts: {
  blocklist?: Array<string | RegExp>;
  requirelist?: Array<string | RegExp>;
  name?: string;
  maxRetries?: number;
  feedbackTemplate?: string;
}): Guardrail {
  return {
    name: opts.name ?? 'content-policy',
    target: 'text',
    maxRetries: opts.maxRetries ?? 2,
    feedbackTemplate: opts.feedbackTemplate,
    validate(output) {
      for (const blocked of opts.blocklist ?? []) {
        if (patternTest(blocked, output.text)) {
          const source = typeof blocked === 'string' ? blocked : blocked.source;
          return {
            valid: false,
            reason: `Blocked content detected: ${source}`,
          };
        }
      }
      for (const required of opts.requirelist ?? []) {
        if (!patternTest(required, output.text)) {
          const source =
            typeof required === 'string' ? required : required.source;
          return {
            valid: false,
            reason: `Required content missing: ${source}`,
          };
        }
      }
      return { valid: true };
    },
  };
}

// ---------------------------------------------------------------------------
// customGuardrail
// ---------------------------------------------------------------------------

export function customGuardrail(
  name: string,
  fn: (
    output: GuardrailInput,
    ctx: GuardrailContext
  ) => GuardrailResult | Promise<GuardrailResult>,
  opts?: { maxRetries?: number; target?: GuardrailTarget }
): Guardrail;
export function customGuardrail(opts: {
  name: string;
  target?: GuardrailTarget;
  maxRetries?: number;
  feedbackTemplate?: string;
  validate: (
    output: GuardrailInput,
    context: GuardrailContext
  ) => GuardrailResult | Promise<GuardrailResult>;
}): Guardrail;
export function customGuardrail(
  nameOrOpts:
    | string
    | {
        name: string;
        target?: GuardrailTarget;
        maxRetries?: number;
        feedbackTemplate?: string;
        validate: (
          output: GuardrailInput,
          context: GuardrailContext
        ) => GuardrailResult | Promise<GuardrailResult>;
      },
  fn?: (
    output: GuardrailInput,
    ctx: GuardrailContext
  ) => GuardrailResult | Promise<GuardrailResult>,
  opts?: { maxRetries?: number; target?: GuardrailTarget }
): Guardrail {
  if (typeof nameOrOpts === 'string') {
    return {
      name: nameOrOpts,
      target: opts?.target ?? 'both',
      maxRetries: opts?.maxRetries ?? 2,
      validate: fn!,
    };
  }
  return {
    name: nameOrOpts.name,
    target: nameOrOpts.target,
    maxRetries: nameOrOpts.maxRetries,
    feedbackTemplate: nameOrOpts.feedbackTemplate,
    validate: nameOrOpts.validate,
  };
}

// ---------------------------------------------------------------------------
// composeGuardrails
// ---------------------------------------------------------------------------

export function composeGuardrails(guardrails: Guardrail[]): Guardrail;
export function composeGuardrails(opts: {
  name?: string;
  guardrails: Guardrail[];
  maxRetries?: number;
  feedbackTemplate?: string;
}): Guardrail;
export function composeGuardrails(
  guardrailsOrOpts:
    | Guardrail[]
    | {
        name?: string;
        guardrails: Guardrail[];
        maxRetries?: number;
        feedbackTemplate?: string;
      }
): Guardrail {
  const guardrails = Array.isArray(guardrailsOrOpts)
    ? guardrailsOrOpts
    : guardrailsOrOpts.guardrails;
  const name = Array.isArray(guardrailsOrOpts)
    ? `chain:[${guardrails.map(g => g.name).join(',')}]`
    : (guardrailsOrOpts.name ??
      `chain:[${guardrails.map(g => g.name).join(',')}]`);
  const maxRetries = Array.isArray(guardrailsOrOpts)
    ? guardrails.length > 0
      ? Math.max(...guardrails.map(g => g.maxRetries ?? 2))
      : 2
    : (guardrailsOrOpts.maxRetries ??
      (guardrails.length > 0
        ? Math.max(...guardrails.map(g => g.maxRetries ?? 2))
        : 2));
  const feedbackTemplate = Array.isArray(guardrailsOrOpts)
    ? undefined
    : guardrailsOrOpts.feedbackTemplate;

  return {
    name,
    target: 'both',
    maxRetries,
    feedbackTemplate,
    async validate(
      output: GuardrailInput,
      context: GuardrailContext
    ): Promise<GuardrailResult> {
      const hasText = output.text.length > 0;
      const hasToolCalls = output.toolCalls.length > 0;
      for (const g of guardrails) {
        const target = g.target ?? 'both';
        // Mirror runLlmStepWithGuardrails' target filter so 'both' children
        // always run, and single-target children only skip when the output
        // genuinely doesn't include their target.
        if (target === 'text' && !hasText && hasToolCalls) continue;
        if (target === 'tool-calls' && !hasToolCalls && hasText) continue;
        const result = await g.validate(output, context);
        if (!result.valid) return result;
      }
      return { valid: true };
    },
  };
}
