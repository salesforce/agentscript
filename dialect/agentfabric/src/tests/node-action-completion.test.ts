/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  findEnclosingScope,
  getCompletionCandidates,
  getDocumentSymbols,
} from '@agentscript/language';
import { parseDocument, testSchemaCtx } from './test-utils.js';

/**
 * Action DEFINITIONS are declared at the root `actions:` block. An agentic
 * node (orchestrator/subagent) BINDS an action under its
 * `reasoning.actions:` block via an at-prefixed reference `@actions.<Name>`.
 *
 * Both the root definitions block and the nested binding block share the
 * field name `actions`, which registers `actions` as a namespace scoped to
 * the `subagent` scope alias. Completing `@actions.` inside a node should
 * still offer the root-level definition names — the at-prefixed reference is
 * a REFERENCE to invocation-target definitions, not the node-local bindings.
 *
 * The root `actions` block carries the `invocationTarget` capability; the
 * node-local binding block does not (it carries a colinear resolvedType
 * marker instead). That capability metadata is the signal used to resolve
 * the reference to definitions.
 */
describe('@actions completion inside an agentic node', () => {
  const findPosition = (
    source: string,
    substring: string
  ): { line: number; character: number } => {
    const idx = source.indexOf(substring);
    if (idx === -1) throw new Error(`Substring not found: "${substring}"`);
    const before = source.slice(0, idx + substring.length);
    const lines = before.split('\n');
    return {
      line: lines.length - 1,
      character: lines[lines.length - 1].length,
    };
  };

  const sourceWithNode = (nodeKind: 'orchestrator' | 'subagent'): string =>
    [
      '# @dialect: AGENTFABRIC=1.0-BETA',
      'config:',
      '  agent_name: "test"',
      'actions:',
      '  alpha:',
      '    kind: "mcp:tool"',
      '    target: "mcp://conn"',
      '    tool_name: "a"',
      '  beta:',
      '    kind: "a2a:send_message"',
      '    target: "a2a://conn"',
      `${nodeKind}:`,
      '  triage:',
      '    reasoning:',
      '      instructions: "test"',
      '      actions:',
      '        existing_bind: @actions.alpha',
      '    on_exit: ->',
      '      transition to @echo.done',
      'echo:',
      '  done:',
      '    kind: "a2a:status_update_event"',
    ].join('\n');

  it('offers root action definitions inside an orchestrator binding (AST path)', () => {
    const source = sourceWithNode('orchestrator');
    const ast = parseDocument(source);
    const pos = findPosition(source, 'existing_bind: @actions.');
    const scope = findEnclosingScope(
      ast,
      pos.line,
      pos.character,
      undefined,
      source,
      testSchemaCtx
    );

    const names = getCompletionCandidates(
      ast,
      'actions',
      testSchemaCtx,
      scope
    ).map(c => c.name);

    expect(names).toContain('alpha');
    expect(names).toContain('beta');
  });

  it('offers root action definitions inside a subagent binding (AST path)', () => {
    const source = sourceWithNode('subagent');
    const ast = parseDocument(source);
    const pos = findPosition(source, 'existing_bind: @actions.');
    const scope = findEnclosingScope(
      ast,
      pos.line,
      pos.character,
      undefined,
      source,
      testSchemaCtx
    );

    const names = getCompletionCandidates(
      ast,
      'actions',
      testSchemaCtx,
      scope
    ).map(c => c.name);

    expect(names).toContain('alpha');
    expect(names).toContain('beta');
  });

  // Regression guard for the pre-existing symbol-table path. When `symbols` +
  // `position` are supplied, `getCompletionCandidates` resolves the reference
  // via the symbol table (a position-based `skip` mechanism) and returns
  // BEFORE reaching the new capability-gated AST branch. So this test pins the
  // symbol-table path — which resolves `@actions.` independently of the
  // capability metadata — not the new AST-path code. The orchestrator/subagent
  // tests above are the ones that exercise the new branch.
  it('offers root action definitions inside a node (symbol-table path)', () => {
    const source = sourceWithNode('orchestrator');
    const ast = parseDocument(source);
    const symbols = getDocumentSymbols(ast);
    const pos = findPosition(source, 'existing_bind: @actions.');
    const scope = findEnclosingScope(
      ast,
      pos.line,
      pos.character,
      undefined,
      source,
      testSchemaCtx
    );

    const names = getCompletionCandidates(
      ast,
      'actions',
      testSchemaCtx,
      scope,
      symbols,
      pos.line,
      pos.character
    ).map(c => c.name);

    expect(names).toContain('alpha');
    expect(names).toContain('beta');
  });

  it('still offers root action definitions at root scope (regression)', () => {
    const source = [
      '# @dialect: AGENTFABRIC=1.0-BETA',
      'config:',
      '  agent_name: "test"',
      'actions:',
      '  alpha:',
      '    kind: "mcp:tool"',
      '    target: "mcp://conn"',
      '    tool_name: "a"',
      '  beta:',
      '    kind: "a2a:send_message"',
      '    target: "a2a://conn"',
    ].join('\n');
    const ast = parseDocument(source);

    const names = getCompletionCandidates(
      ast,
      'actions',
      testSchemaCtx,
      {}
    ).map(c => c.name);

    expect(names).toContain('alpha');
    expect(names).toContain('beta');
  });
});
