/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { NamedMap } from './block.js';
import { MapEntryChild } from './children.js';
import { createDiagnostic, DiagnosticSeverity } from './diagnostics.js';
import { NAMED_MAP_BRAND, isNamedMap, type Range } from './types.js';

describe('NamedMap runtime contract', () => {
  it('preserves Map semantics for undefined values', () => {
    const map = new NamedMap<string | undefined>('TestMap');
    map.set('present', undefined);

    expect(map.has('present')).toBe(true);
    expect(map.get('present')).toBeUndefined();
    expect([...map.keys()]).toEqual(['present']);
    expect([...map.entries()]).toEqual([['present', undefined]]);
    expect([...map.values()]).toEqual([undefined]);
  });

  it('keeps index and ordered children in sync on delete', () => {
    const map = new NamedMap<string>('TestMap');
    map.set('a', 'A');
    map.set('b', 'B');
    map.delete('a');

    expect(map.has('a')).toBe(false);
    expect([...map.entries()]).toEqual([['b', 'B']]);
  });
});

describe('NamedMap __children as single source of truth', () => {
  it('reflects externally pushed MapEntryChild in get/has/size', () => {
    const map = new NamedMap<string>('TestMap');
    map.set('a', 'A');
    expect(map.size).toBe(1);

    // External mutation: push directly to __children
    map.__children.push(new MapEntryChild<string>('b', 'B'));

    expect(map.has('b')).toBe(true);
    expect(map.get('b')).toBe('B');
    expect(map.size).toBe(2);
  });

  it('reflects externally spliced removal in get/has/size', () => {
    const map = new NamedMap<string>('TestMap');
    map.set('a', 'A');
    map.set('b', 'B');
    expect(map.size).toBe(2);

    // External mutation: splice out the first entry
    map.__children.splice(0, 1);

    expect(map.has('a')).toBe(false);
    expect(map.get('a')).toBeUndefined();
    expect(map.size).toBe(1);
  });

  it('reflects __children array replacement', () => {
    const map = new NamedMap<string>('TestMap');
    map.set('a', 'A');
    map.set('b', 'B');

    // External mutation: replace array entirely
    map.__children = [new MapEntryChild<string>('x', 'X')];

    expect(map.has('a')).toBe(false);
    expect(map.has('b')).toBe(false);
    expect(map.has('x')).toBe(true);
    expect(map.get('x')).toBe('X');
    expect(map.size).toBe(1);
  });

  it('API mutations keep cache warm', () => {
    const map = new NamedMap<string>('TestMap');
    map.set('a', 'A');
    expect(map.get('a')).toBe('A');

    map.set('b', 'B');
    expect(map.get('b')).toBe('B');
    expect(map.size).toBe(2);

    map.delete('a');
    expect(map.has('a')).toBe(false);
    expect(map.size).toBe(1);

    map.clear();
    expect(map.size).toBe(0);

    map.set('c', 'C');
    expect(map.has('c')).toBe(true);
    expect(map.size).toBe(1);
  });
});

describe('NamedMap type guard', () => {
  it('rejects prototype-only brand values', () => {
    const proto = { [NAMED_MAP_BRAND]: true };
    const candidate = Object.create(proto) as object;
    expect(isNamedMap(candidate)).toBe(false);
  });
});

describe('createDiagnostic contract', () => {
  it('throws for unsupported inputs instead of defaulting to (0,0)', () => {
    expect(() =>
      createDiagnostic(
        {} as unknown as Range,
        'bad range',
        DiagnosticSeverity.Error
      )
    ).toThrow(
      'createDiagnostic: expected Range, SyntaxNode, or Parsed node with __cst'
    );
  });
});
