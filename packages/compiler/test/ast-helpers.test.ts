/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { DiagnosticSeverity } from '@agentscript/types';
import {
  type Expression,
  AtIdentifier,
  Identifier,
  MemberExpression,
} from '@agentscript/language';
import { resolveAtReference } from '../src/ast-helpers.js';
import { CompilerContext } from '../src/compiler-context.js';

let ctx: CompilerContext;

beforeEach(() => {
  ctx = new CompilerContext();
});

describe('resolveAtReference', () => {
  it('should resolve @namespace.property to the property name', () => {
    const expr = new MemberExpression(new AtIdentifier('actions'), 'do_thing');
    expect(resolveAtReference(expr, 'actions', ctx, 'action target')).toBe(
      'do_thing'
    );
  });

  it('should resolve a bare Identifier to its name', () => {
    const expr = new Identifier('do_thing');
    expect(resolveAtReference(expr, 'actions', ctx, 'action target')).toBe(
      'do_thing'
    );
  });

  it('should resolve a bare AtIdentifier to its name', () => {
    const expr = new AtIdentifier('do_thing');
    expect(resolveAtReference(expr, 'actions', ctx, 'action target')).toBe(
      'do_thing'
    );
  });

  it('should not throw when expression is null', () => {
    expect(() =>
      resolveAtReference(
        null as unknown as Expression,
        'actions',
        ctx,
        'action target'
      )
    ).not.toThrow();
  });

  it('should emit UNRESOLVED_REFERENCE diagnostic for null expression', () => {
    const result = resolveAtReference(
      null as unknown as Expression,
      'actions',
      ctx,
      'action target'
    );
    expect(result).toBeUndefined();
    expect(
      ctx.diagnostics.some(
        d =>
          d.severity === DiagnosticSeverity.Error &&
          d.code === 'UNRESOLVED_REFERENCE'
      )
    ).toBe(true);
  });
});
