/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

/** Strategy for enforcing structured output from the LLM. */
export type StructuredOutputStrategy = 'native' | 'guardrail' | 'auto';

/** Configuration for structured output enforcement. */
export interface StructuredOutputOptions {
  /** JSON Schema the LLM output must conform to. */
  schema: Record<string, unknown>;
  /** Name for the response format (used by native strategy). Defaults to 'response'. */
  name?: string;
  /** Description of the expected output structure. */
  description?: string;
  /**
   * Strategy for enforcement:
   * - 'native': pass responseFormat to the LLM driver (trust the driver)
   * - 'guardrail': use guardrail retry loop only
   * - 'auto': pass responseFormat AND add guardrail as fallback
   * Default: 'auto'
   */
  strategy?: StructuredOutputStrategy;
  /** Maximum retries for guardrail-based validation. Default: 2. */
  maxRetries?: number;
}

/** Result of attempting to parse and validate structured output. */
export interface ParsedStructuredOutput {
  /** Whether parsing and validation succeeded. */
  valid: boolean;
  /** The parsed data (undefined if invalid). */
  data?: unknown;
  /** Error message if parsing or validation failed. */
  error?: string;
  /** The raw text from the LLM before parsing. */
  rawText: string;
}
