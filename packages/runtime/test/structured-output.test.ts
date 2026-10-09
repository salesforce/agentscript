/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { compileSource } from '@agentscript/agentforce';
import {
  Runtime,
  ToolRegistry,
  FnAdapter,
  GuardrailExhaustionError,
} from '../src/index.js';
import type { RuntimeEvent } from '../src/index.js';
import { ScriptedLlm } from './helpers.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const MINIMAL = `
system:
    instructions: "Always respond with JSON."
config:
    agent_name: "JsonBot"
    default_agent_user: "bot@test.com"
start_agent main:
    description: "main"
    reasoning:
        instructions: ->
            | Respond in JSON format.
`;

const WITH_TOOL = `
system:
    instructions: "bot"
config:
    agent_name: "ToolBot"
    default_agent_user: "bot@test.com"
start_agent main:
    description: "main"

    actions:
        Lookup:
            description: "Look up a value"
            inputs:
                key: string
                    description: "Key"
                    is_required: True
            outputs:
                value: string
                    description: "Value"
            target: "fn://lookup"

    reasoning:
        instructions: ->
            | Use tools then respond with JSON.
        actions:
            lookup: @actions.Lookup
`;

function compileMinimal() {
  const { output, diagnostics } = compileSource(MINIMAL);
  const errors = diagnostics.filter(d => d.severity === 1);
  expect(errors).toEqual([]);
  return output;
}

function compileWithTool() {
  const { output, diagnostics } = compileSource(WITH_TOOL);
  const errors = diagnostics.filter(
    d =>
      d.severity === 1 &&
      d.code !== 'invalid-action-target' &&
      d.code !== 'action-missing-input'
  );
  expect(errors).toEqual([]);
  return output;
}

function collectEvents(runtime: Runtime): RuntimeEvent[] {
  const events: RuntimeEvent[] = [];
  runtime.on(e => events.push(e));
  return events;
}

const SCHEMA = {
  type: 'object',
  required: ['name'],
  properties: { name: { type: 'string' } },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Structured Output Enforcement', () => {
  // -------------------------------------------------------------------------
  // 1. Native strategy: responseFormat forwarded to LLM
  // -------------------------------------------------------------------------
  describe('Native strategy: responseFormat forwarded to LLM', () => {
    it('passes responseFormat with correct schema to the LLM driver', async () => {
      const output = compileMinimal();
      const llm = new ScriptedLlm([{ text: '{"name": "Alice"}' }]);

      const runtime = new Runtime({
        doc: output,
        llm,
        tools: new ToolRegistry(),
        structuredOutput: {
          schema: SCHEMA,
          strategy: 'native',
        },
      });

      await runtime.turn('Hello');

      expect(llm.calls).toHaveLength(1);
      expect(llm.calls[0].responseFormat).toBeDefined();
      expect(llm.calls[0].responseFormat).toEqual({
        type: 'json_schema',
        json_schema: {
          name: 'response',
          schema: SCHEMA,
          strict: true,
        },
      });
    });

    it('uses custom name when provided', async () => {
      const output = compileMinimal();
      const llm = new ScriptedLlm([{ text: '{"name": "Alice"}' }]);

      const runtime = new Runtime({
        doc: output,
        llm,
        tools: new ToolRegistry(),
        structuredOutput: {
          schema: SCHEMA,
          name: 'person_response',
          strategy: 'native',
        },
      });

      await runtime.turn('Hello');

      expect(llm.calls[0].responseFormat!.json_schema.name).toBe(
        'person_response'
      );
    });
  });

  // -------------------------------------------------------------------------
  // 2. Native strategy: valid JSON parsed
  // -------------------------------------------------------------------------
  describe('Native strategy: valid JSON parsed', () => {
    it('returns parsed.valid === true with parsed data', async () => {
      const output = compileMinimal();
      const llm = new ScriptedLlm([{ text: '{"name": "Alice"}' }]);

      const runtime = new Runtime({
        doc: output,
        llm,
        tools: new ToolRegistry(),
        structuredOutput: {
          schema: SCHEMA,
          strategy: 'native',
        },
      });

      const result = await runtime.turn('Give me a person');

      expect(result.parsed).toBeDefined();
      expect(result.parsed!.valid).toBe(true);
      expect(result.parsed!.data).toEqual({ name: 'Alice' });
      expect(result.parsed!.rawText).toBe('{"name": "Alice"}');
    });
  });

  // -------------------------------------------------------------------------
  // 3. Native strategy: invalid JSON (driver ignored)
  // -------------------------------------------------------------------------
  describe('Native strategy: invalid JSON (driver ignored)', () => {
    it('returns parsed.valid === false with error when LLM returns non-JSON', async () => {
      const output = compileMinimal();
      const llm = new ScriptedLlm([
        { text: 'I cannot produce JSON right now.' },
      ]);

      const runtime = new Runtime({
        doc: output,
        llm,
        tools: new ToolRegistry(),
        structuredOutput: {
          schema: SCHEMA,
          strategy: 'native',
        },
      });

      const result = await runtime.turn('Give me a person');

      expect(result.parsed).toBeDefined();
      expect(result.parsed!.valid).toBe(false);
      expect(result.parsed!.error).toBeDefined();
      expect(result.parsed!.error).toContain('Invalid JSON');
      expect(result.parsed!.rawText).toBe('I cannot produce JSON right now.');
    });
  });

  // -------------------------------------------------------------------------
  // 4. Guardrail strategy: no responseFormat sent
  // -------------------------------------------------------------------------
  describe('Guardrail strategy: no responseFormat sent', () => {
    it('does NOT include responseFormat in the LLM step input', async () => {
      const output = compileMinimal();
      const llm = new ScriptedLlm([{ text: '{"name": "Bob"}' }]);

      const runtime = new Runtime({
        doc: output,
        llm,
        tools: new ToolRegistry(),
        structuredOutput: {
          schema: SCHEMA,
          strategy: 'guardrail',
        },
      });

      await runtime.turn('Hello');

      expect(llm.calls).toHaveLength(1);
      expect(llm.calls[0].responseFormat).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 5. Guardrail strategy: retry on invalid JSON
  // -------------------------------------------------------------------------
  describe('Guardrail strategy: retry on invalid JSON', () => {
    it('retries when first response is invalid, succeeds on second', async () => {
      const output = compileMinimal();
      const llm = new ScriptedLlm([
        { text: 'not valid json at all' },
        { text: '{"name": "Carol"}' },
      ]);

      const runtime = new Runtime({
        doc: output,
        llm,
        tools: new ToolRegistry(),
        structuredOutput: {
          schema: SCHEMA,
          strategy: 'guardrail',
          maxRetries: 2,
        },
      });

      const events = collectEvents(runtime);
      const result = await runtime.turn('Give me JSON');

      // The guardrail retried and got valid output
      expect(result.assistantText).toBe('{"name": "Carol"}');
      expect(result.parsed).toBeDefined();
      expect(result.parsed!.valid).toBe(true);
      expect(result.parsed!.data).toEqual({ name: 'Carol' });

      // Two LLM calls were made (initial + 1 retry)
      expect(llm.calls).toHaveLength(2);

      // Guardrail fail event emitted
      const fails = events.filter(e => e.kind === 'guardrail-fail');
      expect(fails).toHaveLength(1);
      expect(fails[0]).toMatchObject({
        kind: 'guardrail-fail',
        name: 'structured-output',
        attempt: 1,
      });

      // Guardrail pass event emitted
      const passes = events.filter(
        e => e.kind === 'guardrail-pass' && e.name === 'structured-output'
      );
      expect(passes).toHaveLength(1);

      // No responseFormat sent (guardrail-only strategy)
      expect(llm.calls[0].responseFormat).toBeUndefined();
      expect(llm.calls[1].responseFormat).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 6. Guardrail strategy: exhaustion
  // -------------------------------------------------------------------------
  describe('Guardrail strategy: exhaustion', () => {
    it('throws GuardrailExhaustionError when all retries produce invalid JSON', async () => {
      const output = compileMinimal();
      const llm = new ScriptedLlm([
        { text: 'bad1' },
        { text: 'bad2' },
        { text: 'bad3' },
      ]);

      const runtime = new Runtime({
        doc: output,
        llm,
        tools: new ToolRegistry(),
        structuredOutput: {
          schema: SCHEMA,
          strategy: 'guardrail',
          maxRetries: 2,
        },
        exhaustionPolicy: 'throw',
      });

      const events = collectEvents(runtime);

      await expect(runtime.turn('Give me JSON')).rejects.toThrow(
        GuardrailExhaustionError
      );

      // 3 LLM calls (initial + 2 retries)
      expect(llm.calls).toHaveLength(3);

      // guardrail-exhausted event emitted
      const exhausted = events.filter(e => e.kind === 'guardrail-exhausted');
      expect(exhausted).toHaveLength(1);
      expect(exhausted[0]).toMatchObject({
        kind: 'guardrail-exhausted',
        name: 'structured-output',
      });
    });

    it('returns last-response when exhaustionPolicy is last-response', async () => {
      const output = compileMinimal();
      const llm = new ScriptedLlm([
        { text: 'bad1' },
        { text: 'bad2' },
        { text: 'still bad' },
      ]);

      const runtime = new Runtime({
        doc: output,
        llm,
        tools: new ToolRegistry(),
        structuredOutput: {
          schema: SCHEMA,
          strategy: 'guardrail',
          maxRetries: 2,
        },
        exhaustionPolicy: 'last-response',
      });

      const result = await runtime.turn('Give me JSON');

      expect(result.assistantText).toBe('still bad');
      // Parsing still attempted on final text
      expect(result.parsed).toBeDefined();
      expect(result.parsed!.valid).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // 7. Auto strategy: both responseFormat and guardrail active
  // -------------------------------------------------------------------------
  describe('Auto strategy: both responseFormat and guardrail active', () => {
    it('sends responseFormat AND validates via guardrail', async () => {
      const output = compileMinimal();
      const llm = new ScriptedLlm([{ text: '{"name": "Dave"}' }]);

      const runtime = new Runtime({
        doc: output,
        llm,
        tools: new ToolRegistry(),
        structuredOutput: {
          schema: SCHEMA,
          strategy: 'auto',
        },
      });

      const events = collectEvents(runtime);
      const result = await runtime.turn('Hello');

      // responseFormat was forwarded
      expect(llm.calls).toHaveLength(1);
      expect(llm.calls[0].responseFormat).toBeDefined();
      expect(llm.calls[0].responseFormat).toEqual({
        type: 'json_schema',
        json_schema: {
          name: 'response',
          schema: SCHEMA,
          strict: true,
        },
      });

      // Guardrail validated successfully
      const passes = events.filter(
        e => e.kind === 'guardrail-pass' && e.name === 'structured-output'
      );
      expect(passes).toHaveLength(1);

      // Parsed output is valid
      expect(result.parsed).toBeDefined();
      expect(result.parsed!.valid).toBe(true);
      expect(result.parsed!.data).toEqual({ name: 'Dave' });
    });
  });

  // -------------------------------------------------------------------------
  // 8. Auto strategy: driver ignores responseFormat, guardrail retries
  // -------------------------------------------------------------------------
  describe('Auto strategy: driver ignores responseFormat, guardrail retries', () => {
    it('retries via guardrail when LLM returns non-JSON despite responseFormat', async () => {
      const output = compileMinimal();
      const llm = new ScriptedLlm([
        { text: 'Sorry, I cannot help you with that.' },
        { text: '{"name": "Eve"}' },
      ]);

      const runtime = new Runtime({
        doc: output,
        llm,
        tools: new ToolRegistry(),
        structuredOutput: {
          schema: SCHEMA,
          strategy: 'auto',
          maxRetries: 2,
        },
      });

      const events = collectEvents(runtime);
      const result = await runtime.turn('Give me a person');

      // responseFormat was sent on both attempts
      expect(llm.calls).toHaveLength(2);
      expect(llm.calls[0].responseFormat).toBeDefined();
      expect(llm.calls[1].responseFormat).toBeDefined();

      // Guardrail detected the failure and retried
      const fails = events.filter(e => e.kind === 'guardrail-fail');
      expect(fails).toHaveLength(1);
      expect(fails[0]).toMatchObject({
        kind: 'guardrail-fail',
        name: 'structured-output',
      });

      // Final result is valid
      expect(result.assistantText).toBe('{"name": "Eve"}');
      expect(result.parsed).toBeDefined();
      expect(result.parsed!.valid).toBe(true);
      expect(result.parsed!.data).toEqual({ name: 'Eve' });
    });
  });

  // -------------------------------------------------------------------------
  // 9. JSON in markdown code fences
  // -------------------------------------------------------------------------
  describe('JSON in markdown code fences', () => {
    it('parses JSON wrapped in ```json ... ``` code fences', async () => {
      const output = compileMinimal();
      const jsonInFences = '```json\n{"name": "Fiona"}\n```';
      const llm = new ScriptedLlm([{ text: jsonInFences }]);

      const runtime = new Runtime({
        doc: output,
        llm,
        tools: new ToolRegistry(),
        structuredOutput: {
          schema: SCHEMA,
          strategy: 'native',
        },
      });

      const result = await runtime.turn('Give me JSON');

      expect(result.parsed).toBeDefined();
      expect(result.parsed!.valid).toBe(true);
      expect(result.parsed!.data).toEqual({ name: 'Fiona' });
      expect(result.parsed!.rawText).toBe(jsonInFences);
    });

    it('parses JSON wrapped in bare ``` ... ``` code fences', async () => {
      const output = compileMinimal();
      const jsonInFences = '```\n{"name": "Grace"}\n```';
      const llm = new ScriptedLlm([{ text: jsonInFences }]);

      const runtime = new Runtime({
        doc: output,
        llm,
        tools: new ToolRegistry(),
        structuredOutput: {
          schema: SCHEMA,
          strategy: 'native',
        },
      });

      const result = await runtime.turn('Give me JSON');

      expect(result.parsed).toBeDefined();
      expect(result.parsed!.valid).toBe(true);
      expect(result.parsed!.data).toEqual({ name: 'Grace' });
    });
  });

  // -------------------------------------------------------------------------
  // 10. Schema validation catches type mismatch
  // -------------------------------------------------------------------------
  describe('Schema validation catches type mismatch', () => {
    it('reports invalid when JSON is parseable but field type is wrong', async () => {
      const output = compileMinimal();
      // Schema requires `name` to be a string, but we return a number
      const llm = new ScriptedLlm([{ text: '{"name": 42}' }]);

      const runtime = new Runtime({
        doc: output,
        llm,
        tools: new ToolRegistry(),
        structuredOutput: {
          schema: SCHEMA,
          strategy: 'native',
        },
      });

      const result = await runtime.turn('Give me JSON');

      expect(result.parsed).toBeDefined();
      expect(result.parsed!.valid).toBe(false);
      expect(result.parsed!.error).toContain('JSON Schema validation failed');
      expect(result.parsed!.error).toContain('name');
    });

    it('reports invalid when required field is missing', async () => {
      const output = compileMinimal();
      const llm = new ScriptedLlm([{ text: '{"age": 30}' }]);

      const runtime = new Runtime({
        doc: output,
        llm,
        tools: new ToolRegistry(),
        structuredOutput: {
          schema: SCHEMA,
          strategy: 'native',
        },
      });

      const result = await runtime.turn('Give me JSON');

      expect(result.parsed).toBeDefined();
      expect(result.parsed!.valid).toBe(false);
      expect(result.parsed!.error).toContain('JSON Schema validation failed');
      expect(result.parsed!.error).toContain('name');
    });
  });

  // -------------------------------------------------------------------------
  // 11. No structured output configured
  // -------------------------------------------------------------------------
  describe('No structured output configured', () => {
    it('result.parsed is undefined when structuredOutput is not in options', async () => {
      const output = compileMinimal();
      const llm = new ScriptedLlm([{ text: 'Just a plain text response.' }]);

      const runtime = new Runtime({
        doc: output,
        llm,
        tools: new ToolRegistry(),
      });

      const result = await runtime.turn('Hello');

      expect(result.parsed).toBeUndefined();
    });

    it('does not send responseFormat to the LLM driver', async () => {
      const output = compileMinimal();
      const llm = new ScriptedLlm([{ text: 'Hello!' }]);

      const runtime = new Runtime({
        doc: output,
        llm,
        tools: new ToolRegistry(),
      });

      await runtime.turn('Hello');

      expect(llm.calls).toHaveLength(1);
      expect(llm.calls[0].responseFormat).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 12. Structured output with tools
  // -------------------------------------------------------------------------
  describe('Structured output with tools', () => {
    it('validates final text response after tool calls complete', async () => {
      const output = compileWithTool();

      const fn = new FnAdapter();
      fn.register('lookup', () => ({ value: 'found-it' }));
      const tools = new ToolRegistry();
      tools.register('fn', fn);

      const llm = new ScriptedLlm([
        // First LLM step: calls the tool
        {
          toolCalls: [
            { id: 'tc1', name: 'Lookup', arguments: { key: 'test' } },
          ],
        },
        // Second LLM step: returns JSON text response
        { text: '{"name": "ToolResult"}' },
      ]);

      const runtime = new Runtime({
        doc: output,
        llm,
        tools,
        structuredOutput: {
          schema: SCHEMA,
          strategy: 'native',
        },
      });

      const result = await runtime.turn('Look up something');

      // The tool was called, then the final text is validated
      expect(result.assistantText).toBe('{"name": "ToolResult"}');
      expect(result.parsed).toBeDefined();
      expect(result.parsed!.valid).toBe(true);
      expect(result.parsed!.data).toEqual({ name: 'ToolResult' });

      // responseFormat was sent to the LLM on both calls
      expect(llm.calls).toHaveLength(2);
      expect(llm.calls[0].responseFormat).toBeDefined();
      expect(llm.calls[1].responseFormat).toBeDefined();
    });

    it('validates text even when tool call step produces no text', async () => {
      const output = compileWithTool();

      const fn = new FnAdapter();
      fn.register('lookup', () => ({ value: 'data' }));
      const tools = new ToolRegistry();
      tools.register('fn', fn);

      const llm = new ScriptedLlm([
        // First step: tool call only (no text)
        {
          toolCalls: [{ id: 'tc1', name: 'Lookup', arguments: { key: 'x' } }],
        },
        // Second step: invalid JSON text
        { text: 'not json' },
      ]);

      const runtime = new Runtime({
        doc: output,
        llm,
        tools,
        structuredOutput: {
          schema: SCHEMA,
          strategy: 'native',
        },
      });

      const result = await runtime.turn('Look up something');

      // Parsing happens on the final aggregated text
      expect(result.parsed).toBeDefined();
      expect(result.parsed!.valid).toBe(false);
      expect(result.parsed!.error).toContain('Invalid JSON');
    });
  });
});
