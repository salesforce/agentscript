/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { getNodeMemberAccessCompletions } from '@agentscript/language';
import { AgentFabricSchemaInfo } from '../schema.js';
import { parseDocument, testSchemaCtx } from './test-utils.js';

/**
 * Member-access completion on a node reference inside an expression, e.g.
 *
 *   set @variables.pepe = @orchestrator.crossPlatformTriage.<here>
 *   set @variables.pepe = @orchestrator.crossPlatformTriage.output.<here>
 *
 * These exercise the single production entry `getNodeMemberAccessCompletions`,
 * which the LSP feeds the dot-separated `@`-expression parts. The last part is
 * the partial being typed; the segments between the node name and that partial
 * are the committed member chain:
 *
 *   LEVEL 1 — `[ns, node, '']`            → offer the node member names.
 *   LEVEL 2 — `[ns, node, 'output', '']`  → enumerate output properties.
 *   nested  — `[ns, node, 'output', X, '']` → descend into nested objects.
 */
describe('node member-access completions (agentfabric)', () => {
  // An orchestrator node carrying reasoning.outputs.properties — the
  // canonical structured-output shape for orchestrator/subagent nodes.
  const orchestratorSource = [
    '# @dialect: AGENTFABRIC=1.0-BETA',
    'config:',
    '  agent_name: "test"',
    'orchestrator crossPlatformTriage:',
    '  reasoning:',
    '    instructions: "investigate"',
    '    outputs:',
    '      properties:',
    '        category:',
    '          type: "string"',
    '        priority:',
    '          type: "number"',
    '  on_exit: ->',
    '    transition to @echo.done',
    'echo done:',
    '  kind: "a2a:status_update_event"',
  ].join('\n');

  // A generator node carrying top-level outputs.properties.
  const generatorSource = [
    '# @dialect: AGENTFABRIC=1.0-BETA',
    'config:',
    '  agent_name: "test"',
    'generator classifySeverity:',
    '  prompt: ->',
    '    | classify',
    '  outputs:',
    '    properties:',
    '      ticket_id:',
    '        type: "string"',
    '      severity:',
    '        type: "string"',
    '  on_exit: ->',
    '    transition to @echo.done',
    'echo done:',
    '  kind: "a2a:status_update_event"',
  ].join('\n');

  describe('LEVEL 1 — node member access offers input/output', () => {
    // Member names originate in the dialect's SchemaInfo descriptor, not a
    // core literal. The LEVEL-1 candidates must equal the declared members.
    it('offers exactly the member names declared by the dialect', () => {
      const declared = AgentFabricSchemaInfo.nodeMemberAccess?.members;
      expect(declared).toBeDefined();

      const ast = parseDocument(orchestratorSource);
      const candidates = getNodeMemberAccessCompletions(
        ast,
        ['orchestrator', 'crossPlatformTriage', ''],
        testSchemaCtx
      );
      expect(candidates.map(c => c.name).sort()).toEqual(
        [...(declared ?? [])].sort()
      );
    });

    it('offers input and output for an orchestrator node reference', () => {
      const ast = parseDocument(orchestratorSource);
      const candidates = getNodeMemberAccessCompletions(
        ast,
        ['orchestrator', 'crossPlatformTriage', ''],
        testSchemaCtx
      );
      expect(candidates.map(c => c.name).sort()).toEqual(['input', 'output']);
    });

    it('offers input and output for a generator node reference', () => {
      const ast = parseDocument(generatorSource);
      const candidates = getNodeMemberAccessCompletions(
        ast,
        ['generator', 'classifySeverity', ''],
        testSchemaCtx
      );
      expect(candidates.map(c => c.name).sort()).toEqual(['input', 'output']);
    });

    it('returns nothing for an unknown node name', () => {
      const ast = parseDocument(orchestratorSource);
      const candidates = getNodeMemberAccessCompletions(
        ast,
        ['orchestrator', 'doesNotExist', ''],
        testSchemaCtx
      );
      expect(candidates).toEqual([]);
    });
  });

  describe('LEVEL 2 — output member access enumerates schema output properties', () => {
    it('enumerates orchestrator reasoning.outputs.properties', () => {
      const ast = parseDocument(orchestratorSource);
      const candidates = getNodeMemberAccessCompletions(
        ast,
        ['orchestrator', 'crossPlatformTriage', 'output', ''],
        testSchemaCtx
      );
      expect(candidates.map(c => c.name).sort()).toEqual([
        'category',
        'priority',
      ]);
      const category = candidates.find(c => c.name === 'category');
      expect(category?.detail).toContain('string');
    });

    it('enumerates generator top-level outputs.properties', () => {
      const ast = parseDocument(generatorSource);
      const candidates = getNodeMemberAccessCompletions(
        ast,
        ['generator', 'classifySeverity', 'output', ''],
        testSchemaCtx
      );
      expect(candidates.map(c => c.name).sort()).toEqual([
        'severity',
        'ticket_id',
      ]);
    });

    // Schema-driven location: core does not hardcode `reasoning.outputs` vs
    // top-level `outputs`. It finds the field marked `structuredOutputField`
    // wherever the dialect nests it. The orchestrator nests it under
    // `reasoning`; the generator at the top level. Both enumerate, proving
    // core reads the marker, not a fixed path.
    it('enumerates from the schema-marked output field regardless of nesting', () => {
      const orchestratorAst = parseDocument(orchestratorSource);
      const generatorAst = parseDocument(generatorSource);

      const orchestratorOut = getNodeMemberAccessCompletions(
        orchestratorAst,
        ['orchestrator', 'crossPlatformTriage', 'output', ''],
        testSchemaCtx
      );
      const generatorOut = getNodeMemberAccessCompletions(
        generatorAst,
        ['generator', 'classifySeverity', 'output', ''],
        testSchemaCtx
      );

      // Differently-nested output fields both resolve via the schema marker.
      expect(orchestratorOut.map(c => c.name).sort()).toEqual([
        'category',
        'priority',
      ]);
      expect(generatorOut.map(c => c.name).sort()).toEqual([
        'severity',
        'ticket_id',
      ]);
    });

    it('returns nothing when the node declares no outputs', () => {
      const source = [
        '# @dialect: AGENTFABRIC=1.0-BETA',
        'config:',
        '  agent_name: "test"',
        'executor doWork:',
        '  do: ->',
        '    set @variables.x = 1',
        '  on_exit: ->',
        '    transition to @echo.done',
        'echo done:',
        '  kind: "a2a:status_update_event"',
      ].join('\n');
      const ast = parseDocument(source);
      const candidates = getNodeMemberAccessCompletions(
        ast,
        ['executor', 'doWork', 'output', ''],
        testSchemaCtx
      );
      expect(candidates).toEqual([]);
    });
  });

  describe('nested output objects — arbitrary-depth member descent', () => {
    // A generator whose `outputs` declares a property (`ticket`) that is itself
    // a structured object with its own `properties`. `OutputPropertyBlock`
    // self-references via `properties`, so nesting is expressible in schema.
    // This pins `descendOutputProperties` + the parts-slicing math at depth 5:
    // `@generator.classifyTicket.output.ticket.` enumerates `id` / `score`.
    const nestedSource = [
      '# @dialect: AGENTFABRIC=1.0-BETA',
      'config:',
      '  agent_name: "test"',
      'generator classifyTicket:',
      '  prompt: ->',
      '    | classify',
      '  outputs:',
      '    properties:',
      '      ticket:',
      '        type: "object"',
      '        properties:',
      '          id:',
      '            type: "string"',
      '          score:',
      '            type: "number"',
      '  on_exit: ->',
      '    transition to @echo.done',
      'echo done:',
      '  kind: "a2a:status_update_event"',
    ].join('\n');

    it('enumerates a nested output object property at depth', () => {
      const ast = parseDocument(nestedSource);

      // First confirm the object property itself is offered at LEVEL 2.
      const level2 = getNodeMemberAccessCompletions(
        ast,
        ['generator', 'classifyTicket', 'output', ''],
        testSchemaCtx
      );
      expect(level2.map(c => c.name)).toContain('ticket');

      // Then descend into it: `@generator.classifyTicket.output.ticket.`
      const nested = getNodeMemberAccessCompletions(
        ast,
        ['generator', 'classifyTicket', 'output', 'ticket', ''],
        testSchemaCtx
      );
      expect(nested.map(c => c.name).sort()).toEqual(['id', 'score']);
      const id = nested.find(c => c.name === 'id');
      expect(id?.detail).toContain('string');
      const score = nested.find(c => c.name === 'score');
      expect(score?.detail).toContain('number');
    });

    it('returns nothing when descending into a non-object property', () => {
      const ast = parseDocument(nestedSource);
      // `id` is a scalar string — it has no nested `properties` to enumerate.
      const candidates = getNodeMemberAccessCompletions(
        ast,
        ['generator', 'classifyTicket', 'output', 'ticket', 'id', ''],
        testSchemaCtx
      );
      expect(candidates).toEqual([]);
    });
  });
});
