import { describe, it, expect } from 'vitest';
import { parseDocument, testSchemaCtx } from './test-utils.js';
import { createLintEngine } from '../lint/index.js';

function getDiagnostics(source: string) {
  const ast = parseDocument(source);
  const engine = createLintEngine();
  const { diagnostics } = engine.run(ast, testSchemaCtx);
  return diagnostics.filter(d => d.code === 'duplicate-name');
}

describe('duplicate-name diagnostic', () => {
  it('flags duplicate with colinear value', () => {
    const diags = getDiagnostics(`
variables:
    name: mutable string
    name: mutable number
subagent main:
    label: "Main"
    reasoning:
        instructions: ->
            |Do something
`);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain(
      "'name' is already defined in variables"
    );
  });

  it('flags duplicate via ERROR recovery path', () => {
    const diags = getDiagnostics(`
variables:
    name: = "hello"
    name: = "world"
subagent main:
    label: "Main"
    reasoning:
        instructions: ->
            |Do something
`);
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toContain(
      "'name' is already defined in variables"
    );
  });
});
