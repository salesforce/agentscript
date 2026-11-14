/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { expect, test } from 'vitest';
import {
  AGENTSCRIPT_PRIMITIVE_TYPES,
  SubscriptExpression,
} from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import { AgentScriptSchema } from '../schema.js';
import { parseWithDiagnostics } from './test-utils.js';

function parseListType(parameter: string) {
  const result = parseWithDiagnostics(
    `variables:
    items: mutable list[${parameter}]
`,
    AgentScriptSchema
  );
  expect(result.value.variables?.get('items')?.type).toBeInstanceOf(
    SubscriptExpression
  );
  expect(result.diagnostics.filter(d => d.code === 'syntax-error')).toEqual([]);
  return result.diagnostics;
}

test.each(['1', 'True', '"string"', '@variables.other', 'string + number'])(
  'rejects a non-type list parameter: %s',
  parameter => {
    const errors = parseListType(parameter).filter(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('invalid-type-parameter');
    expect(errors[0].message).toContain('Expected a primitive type');
    expect(errors[0].range).toEqual({
      start: { line: 1, character: 24 },
      end: { line: 1, character: 24 + parameter.length },
    });
  }
);

test.each(AGENTSCRIPT_PRIMITIVE_TYPES.map(type => type.keyword))(
  'accepts a supported list element type: %s',
  parameter => {
    expect(
      parseListType(parameter).filter(
        d => d.severity === DiagnosticSeverity.Error
      )
    ).toEqual([]);
  }
);

test('still rejects an unknown list element type', () => {
  const errors = parseListType('missing').filter(
    d => d.severity === DiagnosticSeverity.Error
  );
  expect(errors).toHaveLength(1);
  expect(errors[0].code).toBe('unknown-type');
});

test('still rejects a nested list element type', () => {
  const errors = parseListType('list[string]').filter(
    d => d.severity === DiagnosticSeverity.Error
  );
  expect(errors).toHaveLength(1);
  expect(errors[0].code).toBe('nested-list-type');
});
