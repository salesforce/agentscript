import { describe, it, expect } from 'vitest';
import {
  normalizeId,
  iterateCollection,
  combineGlobalSystemInstructions,
  normalizeTemplate,
  toPlainData,
} from '../compiler/utils.js';
import {
  SpreadExpression,
  CallExpression,
  MemberExpression,
  AtIdentifier,
  Identifier,
} from '@agentscript/language';

describe('compiler utils', () => {
  it('normalizeId converts kebab-case to snake_case', () => {
    expect(normalizeId('my-node')).toBe('my_node');
    expect(normalizeId('a-b-c')).toBe('a_b_c');
  });

  it('iterateCollection reads native Map', () => {
    const m = new Map<string, Record<string, unknown>>([['a', { x: 1 }]]);
    expect(iterateCollection(m)).toEqual([['a', { x: 1 }]]);
  });

  it('combineGlobalSystemInstructions prefers node text over global', () => {
    expect(combineGlobalSystemInstructions('Global line.', 'Node line.')).toBe(
      'Node line.'
    );
  });

  it('combineGlobalSystemInstructions returns node-only when global empty', () => {
    expect(combineGlobalSystemInstructions('', 'Only node')).toBe('Only node');
    expect(combineGlobalSystemInstructions(undefined, 'Only node')).toBe(
      'Only node'
    );
  });

  it('combineGlobalSystemInstructions returns global-only when node empty', () => {
    expect(combineGlobalSystemInstructions('Global only', '')).toBe(
      'Global only'
    );
    expect(combineGlobalSystemInstructions('Global only', '   ')).toBe(
      'Global only'
    );
  });

  it('normalizeTemplate rewrites {!@request.*} to {{state.request.*}}', () => {
    expect(
      normalizeTemplate('| {!@request.payload.message.parts[0].text}')
    ).toBe('| {{state.request.payload.message.parts[0].text}}');
  });

  it('normalizeTemplate rewrites {!@variables.*} to {{state.*}}', () => {
    expect(normalizeTemplate('| {!@variables.customerMessage}')).toBe(
      '| {{state.customerMessage}}'
    );
  });

  it('normalizeTemplate rewrites bare @generator.<name>.output without parse_json', () => {
    expect(
      normalizeTemplate('{{@generator.generateHrSlackUpdateMessage.output}}')
    ).toBe("{{system.node_outputs['generateHrSlackUpdateMessage']}}");
  });

  it('normalizeTemplate wraps @generator.<name>.output.<attr> with parse_json', () => {
    expect(normalizeTemplate('{{@generator.myNode.output.summary}}')).toBe(
      "{{parse_json(system.node_outputs['myNode']).summary}}"
    );
  });

  it('normalizeTemplate wraps @subagent.<name>.output with nested attrs via parse_json', () => {
    expect(
      normalizeTemplate('{{@subagent.analysis.output.field.nested}}')
    ).toBe("{{parse_json(system.node_outputs['analysis']).field.nested}}");
  });

  it('normalizeTemplate rewrites @executor.<name>.output to state.outputs', () => {
    expect(normalizeTemplate('{{@executor.execStep.output}}')).toBe(
      "{{state.outputs['execStep']}}"
    );
  });

  it('normalizeTemplate does not wrap @executor.<name>.output.<attr> with parse_json', () => {
    expect(normalizeTemplate('{{@executor.execStep.output.field}}')).toBe(
      "{{state.outputs['execStep'].field}}"
    );
  });

  it('normalizeTemplate marks deprecated @outputs alias as error marker', () => {
    expect(
      normalizeTemplate('{{@outputs.generateHrSlackUpdateMessage}}')
    ).toContain('__ERROR__outputs_alias_not_supported__');
  });

  it('normalizeTemplate rewrites @echo.<name>.input to state._node_input', () => {
    expect(normalizeTemplate('{{@echo.send_response.input}}')).toBe(
      '{{state._node_input}}'
    );
  });

  it('normalizeTemplate rewrites @executor.<name>.input to state._node_input', () => {
    expect(normalizeTemplate('{{@executor.billing_handler.input}}')).toBe(
      '{{state._node_input}}'
    );
  });

  it('normalizeTemplate rewrites @generator.<name>.input to state._node_input', () => {
    expect(normalizeTemplate('{{@generator.responder.input}}')).toBe(
      '{{state._node_input}}'
    );
  });

  it('normalizeTemplate rewrites @orchestrator.<name>.input to state._node_input', () => {
    expect(normalizeTemplate('{{@orchestrator.main.input}}')).toBe(
      '{{state._node_input}}'
    );
  });

  it('normalizeTemplate rewrites @router.<name>.input to state._node_input', () => {
    expect(normalizeTemplate('{{@router.classify.input}}')).toBe(
      '{{state._node_input}}'
    );
  });
});

describe('toPlainData', () => {
  it('emits SpreadExpression via __emit', () => {
    const spread = new SpreadExpression(
      new MemberExpression(new AtIdentifier('variables'), 'artifacts')
    );
    expect(toPlainData(spread)).toBe('*@variables.artifacts');
  });

  it('emits CallExpression with spread arg via __emit', () => {
    const call = new CallExpression(new Identifier('a2a_parts'), [
      new SpreadExpression(
        new MemberExpression(new AtIdentifier('variables'), 'artifacts')
      ),
    ]);
    expect(toPlainData(call)).toBe('a2a_parts(*@variables.artifacts)');
  });

  it('emits plain CallExpression with named args via __emit', () => {
    const call = new CallExpression(new Identifier('a2a_task'), [
      new Identifier('state'),
    ]);
    expect(toPlainData(call)).toBe('a2a_task(state)');
  });
});
