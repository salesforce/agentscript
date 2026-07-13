/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { getNodeMemberAccessCompletions } from '@agentscript/language';
import { AgentScriptSchemaInfo } from '../schema.js';
import { parseDocument, testSchemaCtx } from './test-utils.js';

/**
 * Member-access completion on a node reference inside an expression, e.g.
 *
 *   set @variables.x = @subagent.Order_Management.<here>
 *   set @variables.x = @subagent.Order_Management.output.<here>
 *
 * These exercise the single production entry `getNodeMemberAccessCompletions`,
 * which the LSP feeds the dot-separated `@`-expression parts. The last part is
 * the partial being typed; the segments between the node name and that partial
 * are the committed member chain:
 *
 *   LEVEL 1 — `[ns, node, '']`            → offer the node member names.
 *   LEVEL 2 — `[ns, node, 'output', '']`  → enumerate output properties.
 *
 * UNLIKE agentfabric, the agentscript dialect declares NO `structuredOutputField`
 * marker and no `outputs` / `reasoning.outputs` field on its node blocks. So
 * agentscript exercises LEVEL 1 only — `input` / `output` are offered as the
 * member surface — while LEVEL 2 is intentionally inert: there is no schema-
 * marked output field for core to enumerate, so `output.` returns nothing. This
 * test pins that documented gap so a future regression (e.g. accidentally adding
 * a marker, or LEVEL 1 breaking) is caught.
 */
describe('node member-access completions (agentscript)', () => {
  // A subagent node carrying the transitionTarget capability — resolvable as
  // `@subagent.<Name>`. agentscript subagents declare no structured output
  // field, so only LEVEL 1 produces candidates.
  const subagentSource = [
    'subagent Order_Management:',
    '    reasoning:',
    '        instructions: "handle orders"',
    '        actions:',
    '            lookup: @actions.lookup',
  ].join('\n');

  describe('LEVEL 1 — node member access offers input/output', () => {
    // Member names originate in the dialect's SchemaInfo descriptor, not a
    // core literal. The LEVEL-1 candidates must equal the declared members.
    it('offers exactly the member names declared by the dialect', () => {
      const declared = AgentScriptSchemaInfo.nodeMemberAccess?.members;
      expect(declared).toBeDefined();

      const ast = parseDocument(subagentSource);
      const candidates = getNodeMemberAccessCompletions(
        ast,
        ['subagent', 'Order_Management', ''],
        testSchemaCtx
      );
      expect(candidates.map(c => c.name).sort()).toEqual(
        [...(declared ?? [])].sort()
      );
    });

    it('offers input and output for a subagent node reference', () => {
      const ast = parseDocument(subagentSource);
      const candidates = getNodeMemberAccessCompletions(
        ast,
        ['subagent', 'Order_Management', ''],
        testSchemaCtx
      );
      expect(candidates.map(c => c.name).sort()).toEqual(['input', 'output']);
    });

    it('returns nothing for an unknown node name', () => {
      const ast = parseDocument(subagentSource);
      const candidates = getNodeMemberAccessCompletions(
        ast,
        ['subagent', 'doesNotExist', ''],
        testSchemaCtx
      );
      expect(candidates).toEqual([]);
    });
  });

  describe('LEVEL 2 — output member access (inert for agentscript)', () => {
    // agentscript declares NO `structuredOutputField` marker and no
    // `outputs` / `reasoning.outputs` field on subagent blocks, so
    // `ctx.nodeOutputFieldPaths` has no entry for `subagent`. Core therefore
    // has no schema-marked field to enumerate and `output.` returns nothing.
    // This is the documented divergence from agentfabric, whose orchestrator /
    // generator nodes DO declare enumerable structured outputs.
    it('returns nothing for output member access (agentscript declares no structured output field)', () => {
      const ast = parseDocument(subagentSource);
      const candidates = getNodeMemberAccessCompletions(
        ast,
        ['subagent', 'Order_Management', 'output', ''],
        testSchemaCtx
      );
      expect(candidates).toEqual([]);
    });
  });
});
