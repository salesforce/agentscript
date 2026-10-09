/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { compileSource } from '@agentscript/agentforce';
import {
  Runtime,
  ToolRegistry,
  GuardrailExhaustionError,
  jsonSchemaGuardrail,
  regexGuardrail,
  contentPolicyGuardrail,
  customGuardrail,
  composeGuardrails,
} from '../src/index.js';
import type { RuntimeEvent, Middleware } from '../src/index.js';
import { ScriptedLlm } from './helpers.js';

const MINIMAL = `
system:
    instructions: "bot"
config:
    agent_name: "Bot"
    default_agent_user: "bot@test.com"
start_agent main:
    description: "main"
    reasoning:
        instructions: ->
            | Help.
`;

function compileMinimal() {
  const { output, diagnostics } = compileSource(MINIMAL);
  const errors = diagnostics.filter(d => d.severity === 1);
  expect(errors).toEqual([]);
  return output;
}

function collectEvents(runtime: Runtime): RuntimeEvent[] {
  const events: RuntimeEvent[] = [];
  runtime.on(e => events.push(e));
  return events;
}

describe('Guardrail Integration', () => {
  describe('Basic text guardrail passes on first try', () => {
    it('emits guardrail-pass when JSON schema guardrail passes', async () => {
      const output = compileMinimal();
      const llm = new ScriptedLlm([{ text: '{"name": "Alice", "age": 30}' }]);

      const guardrail = jsonSchemaGuardrail({
        schema: {
          type: 'object',
          required: ['name', 'age'],
          properties: {
            name: { type: 'string' },
            age: { type: 'number' },
          },
        },
      });

      const runtime = new Runtime({
        doc: output,
        llm,
        tools: new ToolRegistry(),
        guardrails: [guardrail],
      });

      const events = collectEvents(runtime);
      const result = await runtime.turn('Give me a person');

      expect(result.assistantText).toBe('{"name": "Alice", "age": 30}');
      expect(
        events.some(
          e => e.kind === 'guardrail-pass' && e.name === 'json-schema'
        )
      ).toBe(true);
      expect(events.some(e => e.kind === 'guardrail-fail')).toBe(false);
      // Only one LLM call — no retries needed
      expect(llm.calls).toHaveLength(1);
    });
  });

  describe('Guardrail retry succeeds on second attempt', () => {
    it('retries on failure and passes on second LLM response', async () => {
      const output = compileMinimal();
      // First response: invalid JSON; second response: valid JSON
      const llm = new ScriptedLlm([
        { text: 'not valid json' },
        { text: '{"name": "Bob"}' },
      ]);

      const guardrail = jsonSchemaGuardrail({
        schema: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string' } },
        },
        maxRetries: 2,
      });

      const runtime = new Runtime({
        doc: output,
        llm,
        tools: new ToolRegistry(),
        guardrails: [guardrail],
      });

      const events = collectEvents(runtime);
      const result = await runtime.turn('Give me a person');

      expect(result.assistantText).toBe('{"name": "Bob"}');
      // Should have guardrail-fail then guardrail-pass
      const fails = events.filter(e => e.kind === 'guardrail-fail');
      const passes = events.filter(e => e.kind === 'guardrail-pass');
      expect(fails).toHaveLength(1);
      expect(fails[0]).toMatchObject({
        kind: 'guardrail-fail',
        name: 'json-schema',
        attempt: 1,
      });
      expect(passes).toHaveLength(1);

      // Two LLM calls were made
      expect(llm.calls).toHaveLength(2);

      // The second call should contain the feedback message in its messages
      const secondCall = llm.calls[1];
      const userMessages = secondCall.messages.filter(m => m.role === 'user');
      const feedbackMsg = userMessages.find(
        m =>
          'content' in m &&
          typeof m.content === 'string' &&
          m.content.includes('failed validation')
      );
      expect(feedbackMsg).toBeDefined();
    });
  });

  describe('Retry feedback isolation', () => {
    // Regression: retries previously pushed rejected attempts + synthetic
    // user feedback into this.history, leaking failed attempts into the
    // canonical conversation. They must stay in a scratch buffer.
    it('does not leak rejected attempts or feedback into canonical history on success', async () => {
      const output = compileMinimal();
      const llm = new ScriptedLlm([
        { text: 'first attempt is bad' },
        { text: '{"name": "Alice"}' },
      ]);

      const guardrail = jsonSchemaGuardrail({
        schema: {
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string' } },
        },
        maxRetries: 2,
      });

      const runtime = new Runtime({
        doc: output,
        llm,
        tools: new ToolRegistry(),
        guardrails: [guardrail],
      });

      await runtime.turn('Give me a person');

      const checkpoint = runtime.checkpoint();
      const assistantMessages = checkpoint.history.filter(
        m => m.role === 'assistant'
      );
      const userMessages = checkpoint.history.filter(m => m.role === 'user');

      // Only one assistant message in canonical history — the passing one.
      expect(assistantMessages).toHaveLength(1);
      expect(
        assistantMessages.every(
          m =>
            'content' in m &&
            typeof m.content === 'string' &&
            !m.content.includes('first attempt is bad')
        )
      ).toBe(true);
      // Only the original user prompt — no synthetic feedback messages.
      expect(userMessages).toHaveLength(1);
      expect(
        userMessages.every(
          m =>
            'content' in m &&
            typeof m.content === 'string' &&
            !m.content.includes('failed validation')
        )
      ).toBe(true);
    });

    it('does not leak rejected attempts on guardrail exhaustion (throw policy)', async () => {
      const output = compileMinimal();
      const llm = new ScriptedLlm([
        { text: 'bad1' },
        { text: 'bad2' },
        { text: 'bad3' },
      ]);
      const guardrail = jsonSchemaGuardrail({
        schema: { type: 'object', required: ['name'], properties: {} },
        maxRetries: 2,
      });
      const runtime = new Runtime({
        doc: output,
        llm,
        tools: new ToolRegistry(),
        guardrails: [guardrail],
        exhaustionPolicy: 'throw',
      });

      await expect(runtime.turn('go')).rejects.toThrow(
        GuardrailExhaustionError
      );

      const checkpoint = runtime.checkpoint();
      const assistantMessages = checkpoint.history.filter(
        m => m.role === 'assistant'
      );
      // No assistant messages — every attempt was rejected.
      expect(assistantMessages).toHaveLength(0);
      // Only the user prompt — no synthetic feedback persisted.
      const userMessages = checkpoint.history.filter(m => m.role === 'user');
      expect(userMessages).toHaveLength(1);
    });
  });

  describe('Guardrail exhaustion with throw policy', () => {
    it('throws GuardrailExhaustionError when retries exceeded', async () => {
      const output = compileMinimal();
      // All responses are invalid
      const llm = new ScriptedLlm([
        { text: 'bad1' },
        { text: 'bad2' },
        { text: 'bad3' },
      ]);

      const guardrail = jsonSchemaGuardrail({
        schema: { type: 'object', properties: {} },
        maxRetries: 2,
      });

      const runtime = new Runtime({
        doc: output,
        llm,
        tools: new ToolRegistry(),
        guardrails: [guardrail],
        exhaustionPolicy: 'throw',
      });

      const events = collectEvents(runtime);

      await expect(runtime.turn('Give me JSON')).rejects.toThrow(
        GuardrailExhaustionError
      );

      // Should have emitted guardrail-exhausted event
      const exhausted = events.filter(e => e.kind === 'guardrail-exhausted');
      expect(exhausted).toHaveLength(1);
      expect(exhausted[0]).toMatchObject({
        kind: 'guardrail-exhausted',
        name: 'json-schema',
      });

      // Should have had 3 LLM calls (initial + 2 retries)
      expect(llm.calls).toHaveLength(3);
    });
  });

  describe('Guardrail exhaustion with last-response policy', () => {
    it('returns the last invalid response instead of throwing', async () => {
      const output = compileMinimal();
      const llm = new ScriptedLlm([
        { text: 'bad1' },
        { text: 'bad2' },
        { text: 'still bad' },
      ]);

      const guardrail = jsonSchemaGuardrail({
        schema: { type: 'object', properties: {} },
        maxRetries: 2,
      });

      const runtime = new Runtime({
        doc: output,
        llm,
        tools: new ToolRegistry(),
        guardrails: [guardrail],
        exhaustionPolicy: 'last-response',
      });

      const events = collectEvents(runtime);
      const result = await runtime.turn('Give me JSON');

      // Should return the last (invalid) response
      expect(result.assistantText).toBe('still bad');

      // Should have emitted guardrail-exhausted event
      const exhausted = events.filter(e => e.kind === 'guardrail-exhausted');
      expect(exhausted).toHaveLength(1);
    });
  });

  describe('Multiple guardrails — all must pass', () => {
    it('retries when second guardrail fails even if first passes', async () => {
      const output = compileMinimal();
      // First response passes JSON check but fails content policy
      // Second response passes both
      const llm = new ScriptedLlm([
        { text: '{"message": "you are stupid"}' },
        { text: '{"message": "have a nice day"}' },
      ]);

      const jsonGuard = jsonSchemaGuardrail({
        schema: {
          type: 'object',
          required: ['message'],
          properties: { message: { type: 'string' } },
        },
        maxRetries: 2,
      });

      const contentGuard = contentPolicyGuardrail({
        blocklist: ['stupid', 'idiot'],
        maxRetries: 2,
      });

      const runtime = new Runtime({
        doc: output,
        llm,
        tools: new ToolRegistry(),
        guardrails: [jsonGuard, contentGuard],
      });

      const events = collectEvents(runtime);
      const result = await runtime.turn('Say something');

      expect(result.assistantText).toBe('{"message": "have a nice day"}');

      // First guardrail passes on both attempts
      const passes = events.filter(e => e.kind === 'guardrail-pass');
      expect(passes.length).toBeGreaterThanOrEqual(2);

      // Content policy fails on first attempt
      const fails = events.filter(e => e.kind === 'guardrail-fail');
      expect(fails).toHaveLength(1);
      expect(fails[0]).toMatchObject({
        kind: 'guardrail-fail',
        name: 'content-policy',
      });
    });
  });

  describe('Content policy blocks harmful output', () => {
    it('detects blocked words in LLM output', async () => {
      const output = compileMinimal();
      const llm = new ScriptedLlm([
        { text: 'You should kill the process immediately' },
        { text: 'You should stop the process immediately' },
      ]);

      const guardrail = contentPolicyGuardrail({
        blocklist: ['kill', 'destroy', 'harm'],
        maxRetries: 2,
      });

      const runtime = new Runtime({
        doc: output,
        llm,
        tools: new ToolRegistry(),
        guardrails: [guardrail],
      });

      const events = collectEvents(runtime);
      const result = await runtime.turn('How to stop a process?');

      expect(result.assistantText).toBe(
        'You should stop the process immediately'
      );

      const fails = events.filter(e => e.kind === 'guardrail-fail');
      expect(fails).toHaveLength(1);
      expect(fails[0]).toMatchObject({
        kind: 'guardrail-fail',
        name: 'content-policy',
      });
      expect((fails[0] as { error: string }).error).toContain(
        'Blocked content detected'
      );
      expect((fails[0] as { error: string }).error).toContain('kill');
    });
  });

  describe('Regex guardrail with invert mode', () => {
    it('fails when output matches forbidden pattern', async () => {
      const output = compileMinimal();
      // First response contains an email (forbidden)
      // Second response does not
      const llm = new ScriptedLlm([
        { text: 'Contact me at user@example.com for help' },
        { text: 'Contact support for help' },
      ]);

      const guardrail = regexGuardrail({
        name: 'no-email',
        pattern: /[\w.-]+@[\w.-]+\.\w+/,
        invert: true, // MUST NOT match
        maxRetries: 2,
      });

      const runtime = new Runtime({
        doc: output,
        llm,
        tools: new ToolRegistry(),
        guardrails: [guardrail],
      });

      const events = collectEvents(runtime);
      const result = await runtime.turn('How to get help?');

      expect(result.assistantText).toBe('Contact support for help');

      const fails = events.filter(e => e.kind === 'guardrail-fail');
      expect(fails).toHaveLength(1);
      expect(fails[0]).toMatchObject({
        kind: 'guardrail-fail',
        name: 'no-email',
      });
      expect((fails[0] as { error: string }).error).toContain('must NOT match');
    });
  });

  describe('Guardrail with feedbackTemplate', () => {
    it('uses the template with {error} placeholder in retry message', async () => {
      const output = compileMinimal();
      const llm = new ScriptedLlm([
        { text: 'not json' },
        { text: '{"ok": true}' },
      ]);

      const guardrail = jsonSchemaGuardrail({
        schema: { type: 'object', properties: {} },
        maxRetries: 2,
        feedbackTemplate:
          'CUSTOM FEEDBACK: The error was: {error}. Fix it now.',
      });

      const runtime = new Runtime({
        doc: output,
        llm,
        tools: new ToolRegistry(),
        guardrails: [guardrail],
      });

      await runtime.turn('Give JSON');

      // Verify the second LLM call received the custom feedback template
      expect(llm.calls).toHaveLength(2);
      const secondCall = llm.calls[1];
      const userMessages = secondCall.messages.filter(m => m.role === 'user');
      const feedback = userMessages.find(
        m =>
          'content' in m &&
          typeof m.content === 'string' &&
          m.content.includes('CUSTOM FEEDBACK')
      );
      expect(feedback).toBeDefined();
      expect((feedback as { content: string }).content).toContain(
        'The error was: Invalid JSON'
      );
      expect((feedback as { content: string }).content).toContain(
        'Fix it now.'
      );
    });
  });

  describe('Target filtering', () => {
    it('text guardrail does not fire when LLM returns only tool calls', async () => {
      const output = compileMinimal();
      // LLM returns tool calls with no text, then text on second call
      const validateCalls: Array<{ text: string; toolCallCount: number }> = [];
      const llm = new ScriptedLlm([
        {
          toolCalls: [
            { id: 'tc1', name: 'some_tool', arguments: { input: 'hello' } },
          ],
        },
        { text: 'Done.' },
      ]);

      // This guardrail targets text only — should NOT fire on tool-call-only responses
      const guardrail = customGuardrail(
        'text-only-guard',
        out => {
          validateCalls.push({
            text: out.text,
            toolCallCount: out.toolCalls.length,
          });
          // Pass on text responses, fail should never be reached for tool-only
          return { valid: true };
        },
        { target: 'text', maxRetries: 0 }
      );

      const runtime = new Runtime({
        doc: output,
        llm,
        tools: new ToolRegistry(),
        guardrails: [guardrail],
      });

      const events = collectEvents(runtime);
      await runtime.turn('Do something');

      // The first LLM step returns only tool calls — guardrail should skip (emit pass)
      // The validate function should only be called for the text-producing LLM step
      // For the tool-call-only step, the guardrail is skipped (pass emitted without calling validate)
      const passEvents = events.filter(
        e => e.kind === 'guardrail-pass' && e.name === 'text-only-guard'
      );
      expect(passEvents.length).toBeGreaterThanOrEqual(1);

      // validate() should have been called only for the text-producing step(s),
      // never for the tool-call-only step
      for (const call of validateCalls) {
        expect(call.text.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Middleware-injected guardrails', () => {
    it('applies guardrails added via beforeLlmStep middleware hook', async () => {
      const output = compileMinimal();
      // First response fails the dynamic guardrail, second passes
      const llm = new ScriptedLlm([
        { text: 'short' },
        { text: 'This is a longer response that passes validation' },
      ]);

      const middleware: Middleware = {
        name: 'inject-guardrail',
        beforeLlmStep() {
          return {
            guardrails: [
              customGuardrail(
                'min-length',
                out => {
                  if (out.text.length < 10) {
                    return {
                      valid: false,
                      reason: 'Response too short (min 10 chars)',
                    };
                  }
                  return { valid: true };
                },
                { target: 'text', maxRetries: 2 }
              ),
            ],
          };
        },
      };

      const runtime = new Runtime({
        doc: output,
        llm,
        tools: new ToolRegistry(),
        middleware: [middleware],
      });

      const events = collectEvents(runtime);
      const result = await runtime.turn('Say something long');

      expect(result.assistantText).toBe(
        'This is a longer response that passes validation'
      );

      const fails = events.filter(e => e.kind === 'guardrail-fail');
      expect(fails).toHaveLength(1);
      expect(fails[0]).toMatchObject({
        kind: 'guardrail-fail',
        name: 'min-length',
      });

      const passes = events.filter(e => e.kind === 'guardrail-pass');
      expect(passes.some(p => p.name === 'min-length')).toBe(true);
    });
  });

  describe('Guardrail + abort signal', () => {
    it('abort during retry does not hang', async () => {
      const output = compileMinimal();
      // Provide many responses so the test could hang without abort
      const llm = new ScriptedLlm([
        { text: 'bad1' },
        { text: 'bad2' },
        { text: 'bad3' },
        { text: 'bad4' },
        { text: 'bad5' },
        { text: 'bad6' },
        { text: 'bad7' },
        { text: 'bad8' },
        { text: 'bad9' },
        { text: 'bad10' },
        { text: 'bad11' },
      ]);

      const controller = new AbortController();

      // Guardrail that aborts on the 3rd attempt
      let attempts = 0;
      const guardrail = customGuardrail(
        'abort-on-third',
        () => {
          attempts++;
          if (attempts >= 3) {
            // Trigger abort mid-retry
            controller.abort('test abort');
          }
          return { valid: false, reason: 'always fails' };
        },
        { target: 'text', maxRetries: 10 }
      );

      const runtime = new Runtime({
        doc: output,
        llm,
        tools: new ToolRegistry(),
        guardrails: [guardrail],
      });

      await expect(
        runtime.turn('test', { signal: controller.signal })
      ).rejects.toThrow();

      // Should have aborted early — well before exhausting all retries
      expect(llm.calls.length).toBeLessThan(10);
      expect(attempts).toBeGreaterThanOrEqual(3);
    });
  });

  describe('T1.2 — regex guardrail retry isolation', () => {
    // Regression coverage: the rejected attempt and synthetic feedback used to
    // leak into canonical history. Lock that down with a regex-driven retry.

    it('single turn: rejected attempt and feedback never persist in history', async () => {
      const output = compileMinimal();
      const llm = new ScriptedLlm([
        { text: 'FORBIDDEN_TOKEN here' },
        { text: 'clean response' },
      ]);

      const guardrail = regexGuardrail({
        pattern: /FORBIDDEN_TOKEN/,
        invert: true,
        maxRetries: 1,
      });

      const runtime = new Runtime({
        doc: output,
        llm,
        tools: new ToolRegistry(),
        guardrails: [guardrail],
      });

      const result = await runtime.turn('please respond');
      expect(result.assistantText).toBe('clean response');

      const checkpoint = runtime.checkpoint();
      const assistantMessages = checkpoint.history.filter(
        m => m.role === 'assistant'
      );
      expect(assistantMessages).toHaveLength(1);
      expect((assistantMessages[0] as { content: string }).content).toBe(
        'clean response'
      );

      // Nothing in the canonical history mentions the rejected token or
      // any synthetic guardrail feedback.
      for (const msg of checkpoint.history) {
        if ('content' in msg && typeof msg.content === 'string') {
          expect(msg.content).not.toContain('FORBIDDEN_TOKEN');
          expect(msg.content).not.toContain('must NOT match pattern');
          expect(msg.content).not.toMatch(/failed validation/i);
        }
      }
    });

    it('cross-turn: turn 2 LLM input never sees turn 1 feedback', async () => {
      const output = compileMinimal();
      const llm = new ScriptedLlm([
        // Turn 1, attempt 1 — fails the guardrail.
        { text: 'FORBIDDEN_TOKEN bad' },
        // Turn 1, attempt 2 — passes.
        { text: 'ok one' },
        // Turn 2, attempt 1 — passes immediately.
        { text: 'ok two' },
      ]);

      const guardrail = regexGuardrail({
        pattern: /FORBIDDEN_TOKEN/,
        invert: true,
        maxRetries: 1,
      });

      const runtime = new Runtime({
        doc: output,
        llm,
        tools: new ToolRegistry(),
        guardrails: [guardrail],
      });

      const r1 = await runtime.turn('first');
      expect(r1.assistantText).toBe('ok one');

      const r2 = await runtime.turn('second');
      expect(r2.assistantText).toBe('ok two');

      const checkpoint = runtime.checkpoint();
      const userMessages = checkpoint.history.filter(m => m.role === 'user');
      const assistantMessages = checkpoint.history.filter(
        m => m.role === 'assistant'
      );

      // History is exactly [user:first, assistant:ok one, user:second, assistant:ok two].
      expect(userMessages).toHaveLength(2);
      expect(assistantMessages).toHaveLength(2);
      expect((userMessages[0] as { content: string }).content).toBe('first');
      expect((userMessages[1] as { content: string }).content).toBe('second');
      expect((assistantMessages[0] as { content: string }).content).toBe(
        'ok one'
      );
      expect((assistantMessages[1] as { content: string }).content).toBe(
        'ok two'
      );

      // The third LLM call (turn-2-attempt-1) must not see any feedback or
      // rejected attempt content from turn 1.
      expect(llm.calls).toHaveLength(3);
      const turn2Call = llm.calls[2];
      for (const msg of turn2Call.messages) {
        if ('content' in msg && typeof msg.content === 'string') {
          expect(msg.content).not.toContain('FORBIDDEN_TOKEN');
          expect(msg.content).not.toContain('must NOT match pattern');
          expect(msg.content).not.toMatch(/failed validation/i);
        }
      }

      // Bonus: a fresh runtime restored from the checkpoint between turns
      // also sees clean history when running turn 2.
      const midCheckpointLlm = new ScriptedLlm([
        { text: 'FORBIDDEN_TOKEN bad' },
        { text: 'ok one' },
      ]);
      const rt1 = new Runtime({
        doc: output,
        llm: midCheckpointLlm,
        tools: new ToolRegistry(),
        guardrails: [guardrail],
      });
      await rt1.turn('first');
      const mid = rt1.checkpoint();

      const rt2Llm = new ScriptedLlm([{ text: 'ok two' }]);
      const rt2 = Runtime.fromCheckpoint(
        {
          doc: output,
          llm: rt2Llm,
          tools: new ToolRegistry(),
          guardrails: [guardrail],
        },
        mid
      );
      await rt2.turn('second');

      expect(rt2Llm.calls).toHaveLength(1);
      for (const msg of rt2Llm.calls[0].messages) {
        if ('content' in msg && typeof msg.content === 'string') {
          expect(msg.content).not.toContain('FORBIDDEN_TOKEN');
          expect(msg.content).not.toContain('must NOT match pattern');
          expect(msg.content).not.toMatch(/failed validation/i);
        }
      }
    });
  });

  describe('composeGuardrails utility', () => {
    it('composed guardrail fails if any child fails', async () => {
      const output = compileMinimal();
      const llm = new ScriptedLlm([
        { text: '{"value": "bad word here"}' },
        { text: '{"value": "good content"}' },
      ]);

      const composed = composeGuardrails({
        name: 'composed-check',
        maxRetries: 2,
        guardrails: [
          jsonSchemaGuardrail({
            schema: {
              type: 'object',
              required: ['value'],
              properties: { value: { type: 'string' } },
            },
          }),
          contentPolicyGuardrail({
            blocklist: ['bad word'],
          }),
        ],
      });

      const runtime = new Runtime({
        doc: output,
        llm,
        tools: new ToolRegistry(),
        guardrails: [composed],
      });

      const events = collectEvents(runtime);
      const result = await runtime.turn('Generate JSON');

      expect(result.assistantText).toBe('{"value": "good content"}');

      const fails = events.filter(e => e.kind === 'guardrail-fail');
      expect(fails).toHaveLength(1);
      expect(fails[0]).toMatchObject({
        kind: 'guardrail-fail',
        name: 'composed-check',
      });
      expect((fails[0] as { error: string }).error).toContain(
        'Blocked content'
      );
    });
  });
});
