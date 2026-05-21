/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { parse } from '@agentscript/parser';
import { Dialect } from '../core/dialect.js';
import { NamedBlock, NamedCollectionBlock } from '../core/block.js';
import { StringValue } from '../core/primitives.js';
import { LintEngine } from '../core/analysis/lint-engine.js';
import { createSchemaContext } from '../core/analysis/scope.js';
import { singularCollectionPass } from './singular-collection.js';

const TopicBlock = NamedBlock('TopicBlock', {
  description: StringValue.describe('Description'),
  label: StringValue.describe('Label'),
});

const TestSchema = {
  start_agent: NamedCollectionBlock(TopicBlock.clone()).singular(),
  topic: NamedCollectionBlock(TopicBlock.clone()),
};

const schemaCtx = createSchemaContext({ schema: TestSchema, aliases: {} });

function getSingularDiagnostics(source: string) {
  const { rootNode: root } = parse(source);
  const mappingNode =
    root.namedChildren.find(n => n.type === 'mapping') ?? root;

  const dialect = new Dialect();
  const result = dialect.parse(mappingNode, TestSchema);

  const engine = new LintEngine({
    passes: [singularCollectionPass()],
    source: 'test',
  });
  const { diagnostics } = engine.run(result.value, schemaCtx);
  return diagnostics.filter(d => d.code === 'singular-collection');
}

describe('singular-collection lint pass', () => {
  it('allows a single start_agent entry', () => {
    const diags = getSingularDiagnostics(`
start_agent greeting:
    description: "Greet the customer"
`);
    expect(diags).toHaveLength(0);
  });

  it('flags multiple start_agent entries', () => {
    const diags = getSingularDiagnostics(`
start_agent greeting:
    description: "Greet the customer"
start_agent hello:
    description: "Another entry"
`);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain("Only one 'start_agent' is allowed");
    expect(diags[0].severity).toBe(1); // Error
  });

  it('flags all extra entries beyond the first', () => {
    const diags = getSingularDiagnostics(`
start_agent a:
    description: "First"
start_agent b:
    description: "Second"
start_agent c:
    description: "Third"
`);
    expect(diags).toHaveLength(2);
  });

  it('allows multiple entries in non-singular collections', () => {
    const diags = getSingularDiagnostics(`
topic one:
    description: "First topic"
topic two:
    description: "Second topic"
`);
    expect(diags).toHaveLength(0);
  });

  it('does not flag when start_agent is empty', () => {
    const diags = getSingularDiagnostics(`
topic one:
    description: "A topic"
`);
    expect(diags).toHaveLength(0);
  });
});
