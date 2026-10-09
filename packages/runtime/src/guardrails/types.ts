/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ToolCall, Msg } from '../llm/types.js';

export type GuardrailTarget = 'text' | 'tool-calls' | 'both';

export interface GuardrailResult {
  valid: boolean;
  reason?: string;
  errors?: GuardrailError[];
  transformedText?: string;
  transformedToolCalls?: ToolCall[];
}

export interface GuardrailError {
  path?: string;
  message: string;
  code?: string;
}

export interface Guardrail {
  name: string;
  target?: GuardrailTarget;
  maxRetries?: number;
  feedbackTemplate?: string;
  validate(
    output: GuardrailInput,
    context: GuardrailContext
  ): GuardrailResult | Promise<GuardrailResult>;
}

export interface GuardrailInput {
  text: string;
  toolCalls: ToolCall[];
}

export interface GuardrailContext {
  node: string;
  state: Readonly<Record<string, unknown>>;
  attempt: number;
  maxRetries: number;
  messages: readonly Msg[];
}

/** Policy when all retries are exhausted without passing. */
export type ExhaustionPolicy = 'throw' | 'last-response';

/** Error thrown when guardrail retries are exhausted (under 'throw' policy). */
export class GuardrailExhaustionError extends Error {
  override readonly name = 'GuardrailExhaustionError';
  readonly guardrailName: string;
  readonly lastError: string;
  readonly attempts: number;

  constructor(guardrailName: string, lastError: string, attempts: number) {
    super(
      `Guardrail "${guardrailName}" failed after ${attempts} attempts: ${lastError}`
    );
    this.guardrailName = guardrailName;
    this.lastError = lastError;
    this.attempts = attempts;
  }
}
