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
import { requiredFieldPass } from './required-fields.js';

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
    passes: [requiredFieldPass()],
    source: 'test',
  });
  const { diagnostics } = engine.run(result.value, schemaCtx);
  if (!code) return diagnostics;
  return diagnostics.filter(d => d.code === code);
}

describe('required target on ActionBlock', () => {
  it('flags an action that has only a description', () => {
    const diags = getDiagnostics(
      `
actions:
  Notify_Manager:
    description: "Notify the store manager"
`,
      'missing-required-field'
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('target');
  });

  it('does not flag an action that declares target', () => {
    const diags = getDiagnostics(
      `
actions:
  Notify_Manager:
    description: "Notify the store manager"
    target: "flow://Notify_Manager"
`,
      'missing-required-field'
    );
    expect(diags).toHaveLength(0);
  });

  it('flags an action with inputs/outputs but no target', () => {
    const diags = getDiagnostics(
      `
actions:
  Lookup:
    description: "Look something up"
    inputs:
      query: string
    outputs:
      result: string
`,
      'missing-required-field'
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain('target');
  });

  it('reports one diagnostic per action when multiple are missing target', () => {
    const diags = getDiagnostics(
      `
actions:
  Alpha:
    description: "alpha"
  Beta:
    description: "beta"
    target: "flow://Beta"
  Gamma:
    description: "gamma"
`,
      'missing-required-field'
    );
    expect(diags).toHaveLength(2);
  });
});
