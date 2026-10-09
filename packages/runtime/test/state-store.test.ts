/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tier 2 — focused unit tests for StateStore behaviour: visibility rules,
 * default coercion, ref-equality suppression on no-op writes, and bus
 * emission semantics. Cross-cuts T2.3 (which covers parallel-dispatch
 * state-write order at the runtime level).
 */

import { describe, it, expect } from 'vitest';
import { StateStore } from '../src/state/store.js';
import type { StateVarSpec } from '../src/state/store.js';
import { EventBus } from '../src/events/types.js';
import type { RuntimeEvent } from '../src/index.js';

function spec(
  name: string,
  dataType: StateVarSpec['dataType'],
  visibility: StateVarSpec['visibility'] = 'Internal',
  isList = false,
  defaultVal?: unknown
): StateVarSpec {
  return { name, dataType, visibility, isList, default: defaultVal };
}

describe('StateStore', () => {
  it('coerces quoted-string defaults to plain strings', () => {
    const s = new StateStore([spec('x', 'string', 'Internal', false, '"hi"')]);
    expect(s.get('x')).toBe('hi');
  });

  it('coerces "true"/"false" defaults for booleans', () => {
    const s = new StateStore([
      spec('a', 'boolean', 'Internal', false, 'true'),
      spec('b', 'boolean', 'Internal', false, 'False'),
    ]);
    expect(s.get('a')).toBe(true);
    expect(s.get('b')).toBe(false);
  });

  it('coerces numeric string defaults for numbers', () => {
    const s = new StateStore([spec('n', 'number', 'Internal', false, '42')]);
    expect(s.get('n')).toBe(42);
  });

  it('uses null when no default is given', () => {
    const s = new StateStore([spec('x', 'string')]);
    expect(s.get('x')).toBeNull();
  });

  it('initial values override defaults', () => {
    const s = new StateStore([spec('x', 'string', 'Internal', false, '"hi"')], {
      x: 'override',
    });
    expect(s.get('x')).toBe('override');
  });

  it('throws when writing to a Context (linked) variable', () => {
    const s = new StateStore([spec('tenant', 'string', 'Context')], {
      tenant: 'acme',
    });
    expect(() => s.set('tenant', 'beta')).toThrow(/linked/i);
    expect(s.get('tenant')).toBe('acme');
  });

  it('emits state-change events for value changes (ref-inequality)', () => {
    const bus = new EventBus();
    const events: RuntimeEvent[] = [];
    bus.on(e => events.push(e));

    const s = new StateStore(
      [spec('counter', 'number', 'Internal', false, 0)],
      {},
      bus
    );

    s.set('counter', 1);
    s.set('counter', 2);

    const changes = events.filter(e => e.kind === 'state-change');
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({ name: 'counter', before: 0, after: 1 });
    expect(changes[1]).toMatchObject({ name: 'counter', before: 1, after: 2 });
  });

  it('suppresses state-change when re-writing the same primitive (ref-equality)', () => {
    const bus = new EventBus();
    const events: RuntimeEvent[] = [];
    bus.on(e => events.push(e));

    const s = new StateStore([spec('x', 'number')], { x: 7 }, bus);
    s.set('x', 7);
    s.set('x', 7);

    expect(events.filter(e => e.kind === 'state-change')).toHaveLength(0);
  });

  it('emits state-change for two distinct objects with the same shape', () => {
    const bus = new EventBus();
    const events: RuntimeEvent[] = [];
    bus.on(e => events.push(e));

    const s = new StateStore([spec('o', 'object')], {}, bus);

    const a = { x: 1 };
    const b = { x: 1 };
    s.set('o', a);
    s.set('o', b);

    const changes = events.filter(e => e.kind === 'state-change');
    expect(changes).toHaveLength(2);
    expect(changes[0].after).toBe(a);
    expect(changes[1].after).toBe(b);
  });

  it('snapshot returns a plain record of all values', () => {
    const s = new StateStore(
      [
        spec('a', 'number', 'Internal', false, 1),
        spec('b', 'string', 'Internal', false, '"hi"'),
      ],
      { a: 5 }
    );
    expect(s.snapshot()).toEqual({ a: 5, b: 'hi' });
  });

  it('allows writing transient/unspecced keys without bus emission', () => {
    const bus = new EventBus();
    const events: RuntimeEvent[] = [];
    bus.on(e => events.push(e));

    const s = new StateStore([], {}, bus);
    s.set('AgentScriptInternal_scratch', 'v');
    expect(s.get('AgentScriptInternal_scratch')).toBe('v');
    // No spec means no bus emission
    expect(events.filter(e => e.kind === 'state-change')).toHaveLength(0);
  });

  it('_restoreValue bypasses Context visibility checks', () => {
    const s = new StateStore([spec('tenant', 'string', 'Context')], {
      tenant: 'acme',
    });
    // Direct set throws…
    expect(() => s.set('tenant', 'beta')).toThrow();
    // …but _restoreValue (used by checkpoint restore) does not.
    s._restoreValue('tenant', 'beta');
    expect(s.get('tenant')).toBe('beta');
  });
});
