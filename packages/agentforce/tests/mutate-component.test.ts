/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, test, expect } from 'vitest';
import { parseComponent } from '../src/parse-component.js';
import { emitComponent } from '../src/emit-component.js';
import {
  mutateComponent,
  validateStrictSchema,
} from '../src/mutate-component.js';
import { StringLiteral, NamedMap } from '@agentscript/language';

function assertDefined<T>(val: T | undefined | null): asserts val is T {
  expect(val).toBeDefined();
}

describe('direct mutation + emitComponent (auto-sync)', () => {
  test('updates an existing field via direct assignment', () => {
    const config = parseComponent('description: "My agent"', 'config');
    assertDefined(config);
    config.description = new StringLiteral('Updated agent');
    const output = emitComponent(config);
    expect(output).toContain('Updated agent');
  });

  test('adds a new schema field via direct assignment — no explicit sync needed', () => {
    const config = parseComponent('description: "My agent"', 'config');
    assertDefined(config);
    config.developer_name = new StringLiteral('My_Agent');
    const output = emitComponent(config);
    expect(output).toContain('description: "My agent"');
    expect(output).toContain('developer_name: "My_Agent"');
  });

  test('adds a non-schema field via direct assignment — no explicit sync needed', () => {
    const config = parseComponent('description: "My agent"', 'config');
    assertDefined(config);
    config.custom_field = new StringLiteral('custom value');
    const output = emitComponent(config);
    expect(output).toContain('custom_field: "custom value"');
  });

  test('mutate + emit round-trip on action block preserves entry name', () => {
    const action = parseComponent(
      'Get_Weather:\n    description: "Get weather"\n    target: "flow://Weather"',
      'action'
    );
    assertDefined(action);
    action.description = new StringLiteral('Updated weather');
    const output = emitComponent(action);
    const firstLine = output.split('\n')[0];
    expect(firstLine).toBe('Get_Weather:');
    expect(output).toContain('description: "Updated weather"');
  });

  test('works with named blocks too', () => {
    const topic = parseComponent(
      'topic billing:\n    description: "Handle billing"',
      'topic'
    );
    assertDefined(topic);
    topic.source = new StringLiteral('billing_v2');
    const output = emitComponent(topic);
    expect(output).toContain('source: "billing_v2"');
    expect(output).toContain('description: "Handle billing"');
  });

  test('new field accessor works after auto-sync', () => {
    const config = parseComponent('description: "My agent"', 'config');
    assertDefined(config);
    config.developer_name = new StringLiteral('First');
    // Trigger auto-sync via emitComponent
    emitComponent(config);
    // Now update via accessor — should go through FieldChild
    config.developer_name = new StringLiteral('Second');
    const output = emitComponent(config);
    expect(output).toContain('developer_name: "Second"');
    expect(output).not.toContain('First');
  });

  test('__-prefixed properties are not emitted', () => {
    const config = parseComponent('description: "My agent"', 'config');
    assertDefined(config);
    config.__custom = 'ignored';
    const output = emitComponent(config);
    expect(output).not.toContain('__custom');
    expect(output).toContain('description: "My agent"');
  });
});

describe('auto-sync idempotency', () => {
  test('emitting multiple times is safe and idempotent', () => {
    const config = parseComponent('description: "My agent"', 'config');
    assertDefined(config);
    config.developer_name = new StringLiteral('Test');
    emitComponent(config);
    emitComponent(config);
    const output = emitComponent(config);
    // Should only appear once, not duplicated
    const count = output.split('developer_name').length - 1;
    expect(count).toBe(1);
  });
});

describe('mutateComponent() — for removal and NamedMap ops', () => {
  test('removes a field via helpers.removeField', () => {
    const config = parseComponent(
      'description: "My agent"\ndeveloper_name: "Agent"',
      'config'
    );
    assertDefined(config);
    mutateComponent(config, (_block, helpers) => {
      helpers.removeField('developer_name');
    });
    const output = emitComponent(config);
    expect(output).toContain('description: "My agent"');
    expect(output).not.toContain('developer_name');
  });

  test('sets a field via helpers.setField', () => {
    const config = parseComponent('description: "My agent"', 'config');
    assertDefined(config);
    mutateComponent(config, (_block, helpers) => {
      helpers.setField('developer_name', new StringLiteral('Via helper'));
    });
    const output = emitComponent(config);
    expect(output).toContain('developer_name: "Via helper"');
  });

  test('returns the block for chaining', () => {
    const config = parseComponent('description: "My agent"', 'config');
    assertDefined(config);
    const result = mutateComponent(config, () => {});
    expect(result).toBe(config);
  });

  test('addEntry deduplicates when called twice with the same key and name', () => {
    const config = parseComponent('description: "My agent"', 'config');
    const topic = parseComponent(
      'topic billing:\n    description: "Handle billing"',
      'topic'
    );
    assertDefined(config);
    assertDefined(topic);
    mutateComponent(config, (_block, helpers) => {
      helpers.addEntry('topic', 'billing', topic);
      helpers.addEntry('topic', 'billing', topic);
    });
    // Check __children directly — should have exactly one container-level FieldChild for topic
    assertDefined(config.__children);
    const children = config.__children as Array<{
      __type: string;
      key?: string;
      entryName?: string;
    }>;
    const topicContainers = children.filter(
      c => c.__type === 'field' && c.key === 'topic' && !c.entryName
    );
    expect(topicContainers).toHaveLength(1);
    // The NamedMap itself should have exactly one entry
    const map = (config as unknown as Record<string, unknown>)
      .topic as InstanceType<typeof import('@agentscript/language').NamedMap>;
    expect(map.size).toBe(1);
    expect(map.has('billing')).toBe(true);
  });
});

describe('strict mode', () => {
  describe('emitComponent({ strict: true })', () => {
    test('allows schema-only fields', () => {
      const config = parseComponent('description: "My agent"', 'config');
      assertDefined(config);
      expect(() => emitComponent(config, { strict: true })).not.toThrow();
    });

    test('throws on non-schema fields', () => {
      const config = parseComponent('description: "My agent"', 'config');
      assertDefined(config);
      config.custom_field = new StringLiteral('bad');
      expect(() => emitComponent(config, { strict: true })).toThrow(
        /Strict mode: field "custom_field" is not defined in the schema/
      );
    });

    test('does not throw without strict option', () => {
      const config = parseComponent('description: "My agent"', 'config');
      assertDefined(config);
      config.custom_field = new StringLiteral('fine');
      expect(() => emitComponent(config)).not.toThrow();
    });
  });

  describe('validateStrictSchema', () => {
    test('allows schema fields', () => {
      const config = parseComponent('description: "My agent"', 'config');
      assertDefined(config);
      config.developer_name = new StringLiteral('Ok');
      expect(() => validateStrictSchema(config)).not.toThrow();
    });

    test('throws on non-schema fields', () => {
      const config = parseComponent('description: "My agent"', 'config');
      assertDefined(config);
      config.custom_field = new StringLiteral('bad');
      expect(() => validateStrictSchema(config)).toThrow(
        /Strict mode: field "custom_field" is not defined in the schema/
      );
    });
  });

  describe('mutateComponent with strict', () => {
    test('throws on non-schema fields set in callback', () => {
      const config = parseComponent('description: "My agent"', 'config');
      assertDefined(config);
      expect(() =>
        mutateComponent(
          config,
          block => {
            block.custom_field = new StringLiteral('bad');
          },
          { strict: true }
        )
      ).toThrow(
        /Strict mode: field "custom_field" is not defined in the schema/
      );
    });

    test('allows schema fields in strict mode', () => {
      const config = parseComponent('description: "My agent"', 'config');
      assertDefined(config);
      expect(() =>
        mutateComponent(
          config,
          (_block, helpers) => {
            helpers.setField('developer_name', new StringLiteral('Strict OK'));
          },
          { strict: true }
        )
      ).not.toThrow();
    });
  });

  describe('removeField + re-add via setField', () => {
    test('accessor works correctly after removeField then setField', () => {
      const config = parseComponent(
        'description: "My agent"\ndeveloper_name: "Agent"',
        'config'
      );
      assertDefined(config);

      // Remove the field (deletes accessor + FieldChild)
      mutateComponent(config, (_block, helpers) => {
        helpers.removeField('developer_name');
      });
      expect(emitComponent(config)).not.toContain('developer_name');

      // Re-add via setField (should re-create FieldChild + accessor)
      mutateComponent(config, (_block, helpers) => {
        helpers.setField('developer_name', new StringLiteral('Restored'));
      });
      const output1 = emitComponent(config);
      expect(output1).toContain('developer_name: "Restored"');

      // Verify the accessor still works for subsequent updates
      config.developer_name = new StringLiteral('Updated again');
      const output2 = emitComponent(config);
      expect(output2).toContain('developer_name: "Updated again"');
      expect(output2).not.toContain('Restored');
    });
  });

  describe('NamedMap + FieldChild consistency', () => {
    test('addEntry then removeEntry keeps NamedMap and __children in sync', () => {
      const config = parseComponent('description: "My agent"', 'config');
      const topic = parseComponent(
        'topic billing:\n    description: "Handle billing"',
        'topic'
      );
      assertDefined(config);
      assertDefined(topic);

      mutateComponent(config, (_block, helpers) => {
        helpers.addEntry('topic', 'billing', topic);
      });

      // NamedMap should have the entry, block should have a container-level FieldChild
      const map = (config as unknown as Record<string, unknown>)
        .topic as InstanceType<typeof import('@agentscript/language').NamedMap>;
      expect(map.has('billing')).toBe(true);
      expect(map.size).toBe(1);
      const containerChildren = (
        config.__children as Array<{
          __type: string;
          key?: string;
          entryName?: string;
        }>
      ).filter(c => c.__type === 'field' && c.key === 'topic' && !c.entryName);
      expect(containerChildren).toHaveLength(1);

      // Now remove
      mutateComponent(config, (_block, helpers) => {
        helpers.removeEntry('topic', 'billing');
      });

      // NamedMap should be empty, container FieldChild stays (emits nothing)
      expect(map.has('billing')).toBe(false);
      expect(map.size).toBe(0);
    });
  });

  describe('direct assignment then mutateComponent interaction', () => {
    test('emitComponent works after direct assignment followed by mutateComponent', () => {
      const config = parseComponent(
        'description: "My agent"\ndeveloper_name: "Agent"',
        'config'
      );
      assertDefined(config);

      // First: direct assignment
      config.description = new StringLiteral('Directly assigned');
      config.source = new StringLiteral('new field');

      // Second: mutate via mutateComponent
      mutateComponent(config, (_block, helpers) => {
        helpers.setField('developer_name', new StringLiteral('Via helper'));
        helpers.removeField('source');
      });

      const output = emitComponent(config);
      expect(output).toContain('description: "Directly assigned"');
      expect(output).toContain('developer_name: "Via helper"');
      expect(output).not.toContain('source');
      // Ensure no duplicates
      const descCount = output.split('description').length - 1;
      expect(descCount).toBe(1);
    });
  });

  describe('mutateComponent then direct assignment interaction', () => {
    test('emitComponent works after mutateComponent followed by direct assignment', () => {
      const config = parseComponent(
        'description: "My agent"\ndeveloper_name: "Agent"',
        'config'
      );
      assertDefined(config);

      // First: mutate via mutateComponent
      mutateComponent(config, (_block, helpers) => {
        helpers.setField('description', new StringLiteral('Mutated'));
        helpers.removeField('developer_name');
      });

      // Second: mutate via direct assignment (the "two strategies interact" scenario)
      config.description = new StringLiteral('Directly assigned');
      config.developer_name = new StringLiteral('Re-added directly');

      const output = emitComponent(config);
      expect(output).toContain('description: "Directly assigned"');
      expect(output).toContain('developer_name: "Re-added directly"');
      // Ensure no duplicates
      const descCount = output.split('description').length - 1;
      expect(descCount).toBe(1);
    });
  });

  describe('addEntry/removeEntry edge cases', () => {
    test('removeEntry is a no-op when the entry does not exist', () => {
      const config = parseComponent('description: "My agent"', 'config');
      assertDefined(config);
      // Should not throw when removing a non-existent entry
      expect(() =>
        mutateComponent(config, (_block, helpers) => {
          helpers.removeEntry('topic', 'nonexistent');
        })
      ).not.toThrow();
      const output = emitComponent(config);
      expect(output).toContain('description: "My agent"');
    });

    test('removeEntry from an existing NamedMap for a name that is not in the map', () => {
      const config = parseComponent('description: "My agent"', 'config');
      const topic = parseComponent(
        'topic billing:\n    description: "Handle billing"',
        'topic'
      );
      assertDefined(config);
      assertDefined(topic);
      mutateComponent(config, (_block, helpers) => {
        helpers.addEntry('topic', 'billing', topic);
      });
      // Removing a different name should leave the existing entry intact
      expect(() =>
        mutateComponent(config, (_block, helpers) => {
          helpers.removeEntry('topic', 'nonexistent');
        })
      ).not.toThrow();
      const map = (config as unknown as Record<string, unknown>)
        .topic as InstanceType<typeof import('@agentscript/language').NamedMap>;
      expect(map.has('billing')).toBe(true);
    });

    test('addEntry overwrites a non-NamedMap value with a new NamedMap', () => {
      const config = parseComponent('description: "My agent"', 'config');
      const topic = parseComponent(
        'topic billing:\n    description: "Handle billing"',
        'topic'
      );
      assertDefined(config);
      assertDefined(topic);
      // Set a plain scalar value on the key first
      config.topic = new StringLiteral('not a map');
      // addEntry should replace it with a NamedMap
      mutateComponent(config, (_block, helpers) => {
        helpers.addEntry('topic', 'billing', topic);
      });
      const map = (config as unknown as Record<string, unknown>)
        .topic as InstanceType<typeof import('@agentscript/language').NamedMap>;
      expect(map).toBeInstanceOf(NamedMap);
      expect(map.has('billing')).toBe(true);
    });
  });

  describe('validateStrictSchema()', () => {
    test('throws for non-schema property on block', () => {
      const config = parseComponent('description: "My agent"', 'config');
      assertDefined(config);
      config.bogus = new StringLiteral('nope');
      expect(() => validateStrictSchema(config)).toThrow(
        /Strict mode: field "bogus" is not defined in the schema/
      );
    });

    test('does not throw for schema-only fields', () => {
      const config = parseComponent('description: "My agent"', 'config');
      assertDefined(config);
      expect(() => validateStrictSchema(config)).not.toThrow();
    });
  });
});
