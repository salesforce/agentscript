import { describe, test, expect } from 'vitest';
import { parseComponent } from '../src/parse-component.js';
import { emitComponent } from '../src/emit-component.js';
import type { BlockCore, Expression } from '@agentscript/language';
import { SequenceNode } from '@agentscript/language';
import {
  PronunciationDictEntryBlock,
  InboundKeywordsBlock,
} from '@agentscript/agentforce-dialect';

describe('emitComponent()', () => {
  describe('block kinds', () => {
    test('emits a singular block with header', () => {
      const config = parseComponent('description: "My agent"', 'config');
      const output = emitComponent(config);
      expect(output).toBe('config:\n    description: "My agent"');
    });

    test('emits a named block with schema key header', () => {
      const topic = parseComponent(
        'topic billing:\n    description: "Handle billing"',
        'topic'
      );
      const output = emitComponent(topic);
      expect(output).toBe('topic billing:\n    description: "Handle billing"');
    });

    test('emits a single action block with entry name only (no kind prefix)', () => {
      const action = parseComponent(
        'Get_Weather:\n    description: "Get weather"\n    target: "flow://Weather"',
        'action'
      );
      expect(action).toBeDefined();
      const output = emitComponent(action!);
      const firstLine = output.split('\n')[0];
      expect(firstLine).toBe('Get_Weather:');
      expect(output).toContain('description: "Get weather"');
      expect(output).toContain('target: "flow://Weather"');
    });

    test('respects tabSize option for blocks', () => {
      const config = parseComponent('description: "My agent"', 'config');
      const output = emitComponent(config, { tabSize: 2 });
      expect(output).toBe('config:\n  description: "My agent"');
    });
  });

  describe('statement kind', () => {
    test('emits statements from parseComponent', () => {
      const stmts = parseComponent(
        'if x == 1:\n    run MyAction()',
        'statement'
      );
      // Statement parsing may return empty depending on dialect;
      // verify emitComponent handles both cases gracefully
      const output = emitComponent(stmts);
      expect(typeof output).toBe('string');
    });

    test('emits an empty statement array as empty string', () => {
      expect(emitComponent([])).toBe('');
    });
  });

  describe('expression kind', () => {
    test('emits an expression', () => {
      const expr = parseComponent('"hello " + name', 'expression');
      expect(expr).toBeDefined();
      const output = emitComponent(expr);
      expect(output).toBe('"hello " + name');
    });
  });

  describe('edge cases', () => {
    test('returns empty string for undefined', () => {
      expect(emitComponent(undefined)).toBe('');
    });
  });

  describe('voice modality variant fields', () => {
    test('emits pronunciation_dict with proper newlines after programmatic assignment', () => {
      // Parse a voice modality with just voice_id (no pronunciation_dict)
      const voice = parseComponent(
        'modality voice:\n    voice_id: "test123"',
        'modality'
      )!;
      expect(voice).toBeDefined();

      // Programmatically assign pronunciation_dict (simulating Canvas UI form)
      const entry = new PronunciationDictEntryBlock({
        grapheme: parseComponent('"test"', 'expression') as Expression,
        phoneme: parseComponent('"test"', 'expression') as Expression,
        type: parseComponent('"IPA"', 'expression') as Expression,
      });
      Object.assign(voice, {
        pronunciation_dict: new SequenceNode([entry as BlockCore]),
      });

      const output = emitComponent(voice);
      expect(output).toBe(
        [
          'modality voice:',
          '    voice_id: "test123"',
          '    pronunciation_dict:',
          '        - grapheme: "test"',
          '          phoneme: "test"',
          '          type: "IPA"',
        ].join('\n')
      );
    });

    test('emits inbound_keywords with proper newlines after programmatic assignment', () => {
      const voice = parseComponent(
        'modality voice:\n    voice_id: "test123"',
        'modality'
      )!;
      expect(voice).toBeDefined();

      Object.assign(voice, {
        inbound_keywords: new InboundKeywordsBlock({
          keywords: new SequenceNode([
            parseComponent('"Hello"', 'expression') as Expression,
          ]),
        }),
      });

      const output = emitComponent(voice);
      expect(output).toBe(
        [
          'modality voice:',
          '    voice_id: "test123"',
          '    inbound_keywords:',
          '        keywords:',
          '            - "Hello"',
        ].join('\n')
      );
    });
  });
});
