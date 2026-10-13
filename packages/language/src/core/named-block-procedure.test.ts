/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, test } from 'vitest';

import { NamedBlock } from './named-block-factory.js';
import { isNamedBlockValue } from './children.js';
import { AtIdentifier, MemberExpression } from './expressions.js';
import { ExpressionValue, ProcedureValue } from './primitives.js';
import { RunStatement } from './statements.js';

const ctx = { indent: 0 };

describe('NamedBlock direct procedure bodies', () => {
  test('emits arrows for named and keyed body-only blocks', () => {
    const ProcedureBlock = NamedBlock(
      'ProcedureBlock',
      {},
      {
        body: ProcedureValue,
      }
    );
    const procedure = new ProcedureBlock('main', {});
    procedure.statements = [
      new RunStatement(
        new MemberExpression(new AtIdentifier('actions'), 'echo'),
        []
      ),
    ];

    expect(procedure.__emit(ctx)).toBe('main: ->\n    run @actions.echo');
    expect(isNamedBlockValue(procedure)).toBe(true);
    if (!isNamedBlockValue(procedure)) throw new Error('Expected named block');
    expect(procedure.emitWithKey('step', ctx)).toBe(
      'step main: ->\n    run @actions.echo'
    );
  });

  test('emits an arrow for an empty body-only block', () => {
    const ProcedureBlock = NamedBlock(
      'ProcedureBlock',
      {},
      {
        body: ProcedureValue,
      }
    );

    expect(new ProcedureBlock('empty', {}).__emit(ctx)).toBe('empty: ->');
  });

  test('keeps colinear procedure blocks unchanged', () => {
    const ColinearBlock = NamedBlock(
      'ColinearBlock',
      {},
      {
        colinear: ExpressionValue,
        body: ProcedureValue,
      }
    );
    const action = new ColinearBlock('lookup', {});
    action.value = new MemberExpression(new AtIdentifier('actions'), 'lookup');

    expect(action.__emit(ctx)).toBe('lookup: @actions.lookup');
  });
});
