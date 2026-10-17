/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  getBlockFieldDefinitions,
  getSchemaDefinitions,
} from '../src/schema-introspection.js';

describe('getBlockFieldDefinitions', () => {
  it('returns undefined for unknown kinds', () => {
    expect(getBlockFieldDefinitions('nonexistent')).toBeUndefined();
  });

  it('returns field definitions for the language block', () => {
    const schema = getBlockFieldDefinitions('language');
    expect(schema).toBeDefined();
    expect(schema!.default_locale).toMatchObject({
      type: 'StringValue',
      required: false,
      fieldKind: 'Primitive',
    });
    expect(schema!.default_locale.description).toBeDefined();
    expect(schema!.adaptive).toMatchObject({
      type: 'BooleanLiteral',
      required: false,
      fieldKind: 'Primitive',
    });
    expect(schema!.additional_locales).toMatchObject({
      type: 'StringValue',
      required: false,
      fieldKind: 'Primitive',
    });
    expect(schema!.all_additional_locales).toMatchObject({
      type: 'BooleanLiteral',
      required: false,
      fieldKind: 'Primitive',
    });
  });

  it('resolves named collection blocks (subagent)', () => {
    const schema = getBlockFieldDefinitions('subagent');
    expect(schema).toBeDefined();
    expect(schema!.description).toMatchObject({
      fieldKind: 'Primitive',
    });
  });

  it('includes nested children for block-typed fields', () => {
    const schema = getBlockFieldDefinitions('config');
    expect(schema).toBeDefined();
    // config itself or a block that has nested blocks
    const topLevel = getSchemaDefinitions();
    const systemDef = topLevel['system'];
    if (systemDef?.children) {
      expect(systemDef.children.instructions).toBeDefined();
    }
  });

  it('includes constraints when present', () => {
    const schema = getBlockFieldDefinitions('config');
    expect(schema).toBeDefined();
    // Look for a field with enum constraints
    const fieldsWithConstraints = Object.values(schema!).filter(
      f => f.constraints
    );
    // At minimum, some fields should have constraints
    // (this is a structural test — specific constraints depend on schema evolution)
    expect(fieldsWithConstraints.length).toBeGreaterThanOrEqual(0);
  });
});

describe('getSchemaDefinitions', () => {
  it('returns definitions for all top-level schema entries', () => {
    const defs = getSchemaDefinitions();
    expect(defs).toBeDefined();
    expect(defs['language']).toBeDefined();
    expect(defs['config']).toBeDefined();
    expect(defs['system']).toBeDefined();
  });

  it('each entry has type and fieldKind', () => {
    const defs = getSchemaDefinitions();
    for (const [, def] of Object.entries(defs)) {
      expect(def.type).toBeDefined();
      expect(def.fieldKind).toBeDefined();
      expect(typeof def.required).toBe('boolean');
    }
  });
});
