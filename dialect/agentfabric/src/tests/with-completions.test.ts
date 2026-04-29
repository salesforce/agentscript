import { describe, it, expect } from 'vitest';
import { getWithCompletions } from '@agentscript/language';
import { parseAndLintSource, testSchemaCtx } from './test-utils.js';

describe('getWithCompletions with agentfabric', () => {
  it('suggests root-level action input params (different binding name)', () => {
    const source = [
      '# @dialect: AGENTFABRIC=1.0-BETA',
      'config:',
      '  agent_name: "test"',
      'actions:',
      '  help_center:',
      '    kind: "mcp:tool"',
      '    target: "mcp://conn"',
      '    tool_name: "search"',
      '    inputs:',
      '      param1:',
      '      param2:',
      'subagent:',
      '  greeting:',
      '    reasoning:',
      '      instructions: "test"',
      '      actions:',
      '        search_help: @actions.help_center',
      '          with ',
    ].join('\n');

    const result = parseAndLintSource(source);
    const ast = result.ast;
    const lastLine = source.split('\n').length - 1;

    const candidates = getWithCompletions(
      ast,
      lastLine,
      source.split('\n')[lastLine].length,
      testSchemaCtx,
      source
    );
    expect(candidates.map(c => c.name)).toContain('param1');
    expect(candidates.map(c => c.name)).toContain('param2');
  });

  it('suggests input params when binding name matches definition name', () => {
    // This is the key regression case: when the binding name equals the
    // action definition name, scoped resolution would find the binding
    // (a ReasoningActionBlock with no inputs) instead of the definition.
    const source = [
      '# @dialect: AGENTFABRIC=1.0-BETA',
      'config:',
      '  agent_name: "test"',
      'actions:',
      '  escalate_ticket:',
      '    kind: "mcp:tool"',
      '    target: "mcp://conn"',
      '    tool_name: "escalate"',
      '    inputs:',
      '      input1:',
      'orchestrator:',
      '  triage:',
      '    reasoning:',
      '      instructions: "test"',
      '      actions:',
      '        escalate_ticket: @actions.escalate_ticket',
      '          with ',
      '    outputs:',
      '      properties:',
      '        resolution:',
      '          type: "string"',
      '  on_exit: ->',
      '    transition to @echo.done',
      'echo:',
      '  done:',
      '    kind: "a2a:response"',
    ].join('\n');

    const result = parseAndLintSource(source);
    const ast = result.ast;
    const lines = source.split('\n');
    // Find the `with ` line
    const withLine = lines.findIndex(l => l.trim() === 'with');
    expect(withLine).toBeGreaterThan(0);

    const candidates = getWithCompletions(
      ast,
      withLine,
      lines[withLine].length,
      testSchemaCtx,
      source
    );
    expect(candidates.map(c => c.name)).toContain('input1');
  });
});
