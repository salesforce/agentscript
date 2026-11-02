/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, test } from 'vitest';
import {
  AtIdentifier,
  MemberExpression,
  TemplateInterpolation,
  TemplateText,
} from './expressions.js';
import { SayStatement } from './statements.js';

describe('SayStatement', () => {
  test('emits double-quoted text with direct reference interpolation', () => {
    const statement = new SayStatement([
      new TemplateText('Order "'),
      new TemplateInterpolation(
        new MemberExpression(new AtIdentifier('variables'), 'order_id')
      ),
      new TemplateText('"\nconfirmed'),
    ]);

    expect(statement.__emit({ indent: 1 })).toBe(
      '    say "Order \\"{!@variables.order_id}\\"\\nconfirmed"'
    );
  });
});
