/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LlmStepInput } from '../llm/types.js';
import { validateSchema } from '../guardrails/schema-validator.js';
import type {
  StructuredOutputOptions,
  ParsedStructuredOutput,
} from './types.js';

/**
 * Builds a responseFormat object to pass to LlmStepInput when using native strategy.
 */
export function buildResponseFormat(
  opts: StructuredOutputOptions
): LlmStepInput['responseFormat'] {
  return {
    type: 'json_schema',
    json_schema: {
      name: opts.name ?? 'response',
      schema: opts.schema,
      strict: true,
    },
  };
}

/**
 * Attempts to extract JSON from text that may be wrapped in markdown code fences.
 * Returns the extracted JSON string, or the original text if no fences found.
 */
function extractJson(text: string): string {
  const trimmed = text.trim();

  // Try to extract from markdown code fences: ```json ... ``` or ``` ... ```
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  return trimmed;
}

/**
 * Attempts to parse and validate LLM text output against the schema.
 * Returns a ParsedStructuredOutput indicating success/failure.
 */
export function parseStructuredOutput(
  text: string,
  schema: Record<string, unknown>
): ParsedStructuredOutput {
  const rawText = text;

  // 1. Try to extract JSON from the text (handle markdown code fences)
  const jsonStr = extractJson(text);

  // 2. JSON.parse
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    return {
      valid: false,
      error: `Invalid JSON: ${(e as Error).message}`,
      rawText,
    };
  }

  // 3. Validate against schema
  const errors = validateSchema(parsed, schema, '');
  if (errors.length > 0) {
    const messages = errors.map(e => `${e.path}: ${e.message}`).join('; ');
    return {
      valid: false,
      error: `JSON Schema validation failed: ${messages}`,
      rawText,
    };
  }

  // 4. Return success
  return {
    valid: true,
    data: parsed,
    rawText,
  };
}
