/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { parse } from '@agentscript/parser';
import { Dialect } from '../core/dialect.js';
import { LintEngine } from '../core/analysis/lint-engine.js';
import { createSchemaContext } from '../core/analysis/scope.js';
import { ActionsBlock } from '../blocks.js';
import { emptyBlockPass } from './empty-block.js';

const TestSchema = {
  actions: ActionsBlock,
};

const schemaCtx = createSchemaContext({ schema: TestSchema, aliases: {} });

function getDiagnostics(source: string, code?: string) {
  const { rootNode: root } = parse(source);
  const mappingNode =
    root.namedChildren.find(n => n.type === 'mapping') ?? root;

  const dialect = new Dialect();
  const result = dialect.parse(mappingNode, TestSchema);

  const engine = new LintEngine({
    passes: [emptyBlockPass()],
    source: 'test',
  });
  const { diagnostics } = engine.run(result.value, schemaCtx);
  if (!code) return diagnostics;
  return diagnostics.filter(d => d.code === code);
}

describe('empty-block lint pass', () => {
  it('flags a bare `inputs:` with no entries', () => {
    const diags = getDiagnostics(
      `
actions:
  Lookup:
    description: "Look something up"
    target: "flow://Lookup"
    inputs:
`,
      'empty-block'
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('inputs');
  });

  it('does not flag a populated `inputs:` block', () => {
    const diags = getDiagnostics(
      `
actions:
  Lookup:
    description: "Look something up"
    target: "flow://Lookup"
    inputs:
      query: string
`,
      'empty-block'
    );
    expect(diags).toHaveLength(0);
  });

  it('flags a bare `outputs:` with no entries', () => {
    const diags = getDiagnostics(
      `
actions:
  Lookup:
    description: "Look something up"
    target: "flow://Lookup"
    outputs:
`,
      'empty-block'
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('outputs');
  });

  it('reports two diagnostics when both `inputs:` and `outputs:` are empty', () => {
    const diags = getDiagnostics(
      `
actions:
  Lookup:
    description: "x"
    target: "flow://Lookup"
    inputs:
    outputs:
`,
      'empty-block'
    );
    expect(diags).toHaveLength(2);
  });

  it('reports one diagnostic per action when multiple actions have empty blocks', () => {
    const diags = getDiagnostics(
      `
actions:
  Alpha:
    description: "a"
    target: "flow://Alpha"
    inputs:
  Beta:
    description: "b"
    target: "flow://Beta"
    inputs:
      x: string
  Gamma:
    description: "g"
    target: "flow://Gamma"
    outputs:
`,
      'empty-block'
    );
    expect(diags).toHaveLength(2);
  });
});
