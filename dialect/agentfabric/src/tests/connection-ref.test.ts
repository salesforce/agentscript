/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Tests for the `connectionRef` schema marker.
 *
 * Connection-target fields (LLM/action/trigger `target:`) are tagged with an
 * explicit `.connectionRef([...])` schema hint instead of being identified by
 * sniffing the URI scheme (`llm://`) or matching the key name. These pin:
 *   1. the `.connectionRef([...])` builder method records the kinds on
 *      `__metadata.constraints.connectionRef`, and
 *   2. `resolveFieldAtPosition` returns the tagged `target` field for a cursor
 *      sitting on its value line, so a client can read the marker at a position.
 */

import { describe, it, expect } from 'vitest';
import { StringValue, resolveFieldAtPosition } from '@agentscript/language';
import { parseDocument, testSchemaCtx } from './test-utils.js';

const INDENT8 = ' '.repeat(8);

function build(...lines: string[]): string {
  return ['# @dialect: AGENTFABRIC=1.0-BETA', ...lines].join('\n');
}

describe('connectionRef schema marker', () => {
  it('records the connection kinds on the field constraints', () => {
    const constraints = (
      StringValue.connectionRef(['llm']) as unknown as {
        __metadata?: { constraints?: { connectionRef?: readonly string[] } };
      }
    ).__metadata?.constraints?.connectionRef;

    expect(constraints).toEqual(['llm']);
  });

  it('resolveFieldAtPosition returns the llm `target` field with its connectionRef and path', () => {
    // A cursor on the `target:` value line inside an `llm:` entry should
    // resolve to the schema field carrying the `connectionRef(['llm'])` marker.
    const targetLine = `${INDENT8}target: `;
    const source = build('llm:', '    myLLM:', targetLine);
    const ast = parseDocument(source);
    const lines = source.split('\n');
    const lineIdx = lines.findIndex(l => l === targetLine);
    expect(lineIdx).toBeGreaterThan(-1);

    const resolved = resolveFieldAtPosition(
      ast,
      lineIdx,
      targetLine.length,
      testSchemaCtx,
      source
    );

    expect(resolved).not.toBeNull();
    expect(resolved?.path).toEqual(['llm', 'myLLM', 'target']);
    expect(resolved?.field.__metadata?.constraints?.connectionRef).toEqual([
      'llm',
    ]);
  });

  it('resolveFieldAtPosition returns the action `target` field with its multi-kind connectionRef and path', () => {
    // The action `target:` is the only connection field with multiple kinds
    // (['agent','mcp']) AND the only one nested under a CollectionBlock with a
    // `.discriminant('kind')`. This pins that the path-resolution + collection/
    // discriminant interaction surfaces the connectionRef marker correctly.
    const targetLine = `${INDENT8}target: `;
    const source = build('actions:', '    myAction:', targetLine);
    const ast = parseDocument(source);
    const lines = source.split('\n');
    const lineIdx = lines.findIndex(l => l === targetLine);
    expect(lineIdx).toBeGreaterThan(-1);

    const resolved = resolveFieldAtPosition(
      ast,
      lineIdx,
      targetLine.length,
      testSchemaCtx,
      source
    );

    expect(resolved).not.toBeNull();
    expect(resolved?.path).toEqual(['actions', 'myAction', 'target']);
    expect(resolved?.field.__metadata?.constraints?.connectionRef).toEqual([
      'agent',
      'mcp',
    ]);
  });

  it('returns null when the cursor is not on a key: value line', () => {
    const source = build('llm:', '    myLLM:');
    const ast = parseDocument(source);
    const resolved = resolveFieldAtPosition(
      ast,
      1,
      'llm:'.length,
      testSchemaCtx,
      source
    );

    expect(resolved).toBeNull();
  });
});
