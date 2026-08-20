/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, test } from 'vitest';
import { resolveDialect } from '@agentscript/language';
import { defaultDialects } from './dialect-registry.js';

describe('default dialect registry', () => {
  test('registers and resolves the Agentforce plugin dialect', () => {
    expect(defaultDialects.map(dialect => dialect.name)).toContain(
      'agentforce-plugin'
    );

    const result = resolveDialect(
      '# @dialect: agentforce-plugin\nsystem:\n    instructions: "Plugin"',
      { dialects: defaultDialects }
    );

    expect(result.dialect.name).toBe('agentforce-plugin');
    expect(result.unknownDialect).toBeUndefined();
  });
});
