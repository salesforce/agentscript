/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { EventBus } from '../events/types.js';

export interface StateVarSpec {
  name: string;
  dataType:
    | 'boolean'
    | 'number'
    | 'string'
    | 'object'
    | 'date'
    | 'timestamp'
    | 'currency'
    | 'id';
  isList: boolean;
  default?: unknown;
  /** Internal = runtime-scoped; Context = linked (read-only, supplied by caller). */
  visibility: 'Internal' | 'Context';
}

export class StateStore {
  private values = new Map<string, unknown>();
  private specs = new Map<string, StateVarSpec>();

  constructor(
    specs: StateVarSpec[],
    initial: Record<string, unknown> = {},
    private readonly bus?: EventBus
  ) {
    for (const spec of specs) {
      this.specs.set(spec.name, spec);
      if (spec.name in initial) {
        this.values.set(spec.name, initial[spec.name]);
      } else if (spec.default !== undefined) {
        this.values.set(
          spec.name,
          this.coerceDefault(spec.default, spec.dataType)
        );
      } else {
        this.values.set(spec.name, null);
      }
    }
  }

  get(name: string): unknown {
    return this.values.get(name);
  }

  set(name: string, value: unknown): void {
    const spec = this.specs.get(name);
    if (!spec) {
      // Allow transient runtime keys (e.g. internal scratch) to pass through.
      this.values.set(name, value);
      return;
    }
    if (spec.visibility === 'Context') {
      throw new Error(
        `Cannot write to linked variable "${name}" (visibility=Context)`
      );
    }
    const before = this.values.get(name);
    this.values.set(name, value);
    if (before !== value) {
      this.bus?.emit({ kind: 'state-change', name, before, after: value });
    }
  }

  snapshot(): Record<string, unknown> {
    return Object.fromEntries(this.values);
  }

  /**
   * Restore a value without visibility checks. Used internally by checkpoint restore.
   * @internal
   */
  _restoreValue(name: string, value: unknown): void {
    this.values.set(name, value);
  }

  /**
   * Default values in the compiled IR are stored as *expression strings*
   * (e.g. `'"__EMPTY__"'`, `0`, `false`). Strings that look like quoted
   * literals get unwrapped; everything else is returned as-is.
   */
  private coerceDefault(
    raw: unknown,
    dataType: StateVarSpec['dataType']
  ): unknown {
    if (typeof raw !== 'string') return raw;
    const trimmed = raw.trim();
    if (trimmed === '') return dataType === 'string' ? '' : null;
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return trimmed.slice(1, -1);
    }
    if (dataType === 'boolean') return trimmed === 'true' || trimmed === 'True';
    if (dataType === 'number') {
      const n = Number(trimmed);
      return Number.isNaN(n) ? raw : n;
    }
    return raw;
  }
}
