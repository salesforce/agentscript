/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { parse } from '@agentscript/parser';
import { Dialect } from '../core/dialect.js';
import { Block, NamedBlock, NamedCollectionBlock } from '../core/block.js';
import { StringValue } from '../core/primitives.js';
import { LintEngine } from '../core/analysis/lint.js';
import { createSchemaContext } from '../core/analysis/scope.js';
import { duplicateKeyPass } from './duplicate-keys.js';

const ItemBlock = NamedBlock('ItemBlock', {
  description: StringValue.describe('Description'),
  label: StringValue.describe('Label'),
});

const ItemsCollection = NamedCollectionBlock(ItemBlock);

const ContainerBlock = Block('ContainerBlock', {
  items: ItemsCollection.describe('Named items'),
});

const TestSchema = {
  things: ItemsCollection,
  container: ContainerBlock,
};

const schemaCtx = createSchemaContext({ schema: TestSchema, aliases: {} });

function getDuplicateKeyDiagnostics(source: string) {
  const { rootNode: root } = parse(source);
  const mappingNode =
    root.namedChildren.find(n => n.type === 'mapping') ?? root;

  const dialect = new Dialect();
  const result = dialect.parse(mappingNode, TestSchema);

  const engine = new LintEngine({
    passes: [duplicateKeyPass()],
    source: 'test',
  });
  const { diagnostics } = engine.run(result.value, schemaCtx);
  return diagnostics.filter(d => d.code === 'duplicate-key');
}

describe('duplicate-key lint pass', () => {
  describe('NamedMap duplicates', () => {
    it('detects duplicate keys in a nested NamedMap (container field)', () => {
      const diags = getDuplicateKeyDiagnostics(`
container:
    items:
        foo:
            description: "First"
        foo:
            description: "Second"
`);
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain("Duplicate key 'foo'");
    });

    it('detects duplicate named entries at the top level', () => {
      const diags = getDuplicateKeyDiagnostics(`
things foo:
    description: "First"
things foo:
    description: "Second"
`);
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain("Duplicate key 'things foo'");
    });

    it('does not flag unique keys in a NamedMap', () => {
      const diags = getDuplicateKeyDiagnostics(`
container:
    items:
        foo:
            description: "First"
        bar:
            description: "Second"
`);
      expect(diags).toHaveLength(0);
    });

    it('does not flag distinct named entries as type-key duplicates', () => {
      const diags = getDuplicateKeyDiagnostics(`
things alpha:
    description: "First"
things beta:
    description: "Second"
things gamma:
    description: "Third"
`);
      expect(diags).toHaveLength(0);
    });
  });

  describe('block field duplicates', () => {
    it('detects duplicate fields inside a block instance', () => {
      const diags = getDuplicateKeyDiagnostics(`
things alpha:
    description: "First description"
    description: "Second description"
`);
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain("Duplicate key 'description'");
    });

    it('does not flag distinct fields inside a block', () => {
      const diags = getDuplicateKeyDiagnostics(`
things alpha:
    description: "A description"
    label: "A label"
`);
      expect(diags).toHaveLength(0);
    });
  });
});
