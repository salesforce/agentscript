/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, test } from 'vitest';
import { parse } from '@agentscript/parser';
import {
  DiagnosticSeverity,
  SymbolKind,
  findDefinitionAtPosition,
  getAvailableNamespaces,
  getCompletionCandidates,
  getDocumentSymbols,
  getFieldCompletions,
  isNamedMap,
  parseAndLint,
} from '@agentscript/language';
import type { Statement } from '@agentscript/language';

import { agentscriptDialect } from '../index.js';
import { emitDocument, parseDocument, testSchemaCtx } from './test-utils.js';

function lint(source: string) {
  return parseAndLint(parse(source).rootNode, agentscriptDialect).diagnostics;
}

function codes(source: string): string[] {
  return lint(source).map(diagnostic => diagnostic.code ?? '');
}

function findPosition(source: string, substring: string) {
  const offset = source.indexOf(substring);
  if (offset < 0) throw new Error(`Substring not found: ${substring}`);
  const lines = source.slice(0, offset).split('\n');
  return {
    line: lines.length - 1,
    character: lines[lines.length - 1].length,
  };
}

describe('workflow procedures', () => {
  test('parses an unnamed steps flow', () => {
    const document = parseDocument(
      [
        'workflow handle_return:',
        '    description: "Collect and process a return."',
        '    steps:',
        '        ask for @variables.order_id',
        '            instructions: "Ask for the order number."',
        '        run @actions.process_return',
        '        transition to @subagent.order_desk',
      ].join('\n')
    );

    expect(isNamedMap(document.workflow)).toBe(true);
    const workflow = document.workflow?.get('handle_return');
    expect(
      workflow?.steps?.statements.map(
        (statement: Statement) => statement.__kind
      )
    ).toEqual(['CollectClause', 'RunStatement', 'TransitionStatement']);
  });

  test('preserves named step order', () => {
    const document = parseDocument(
      [
        'workflow handle_return:',
        '    description: "Collect and process a return."',
        '    step collect: ->',
        '        ask for @variables.order_id',
        '            instructions: "Ask for the order number."',
        '    step close: ->',
        '        run @actions.process_return',
        '        transition to @subagent.order_desk',
      ].join('\n')
    );

    const workflow = document.workflow?.get('handle_return');
    expect([...workflow!.step!.keys()]).toEqual(['collect', 'close']);
    expect(
      workflow?.step
        ?.get('collect')
        ?.statements?.map((statement: Statement) => statement.__kind)
    ).toEqual(['CollectClause']);
    expect(
      workflow?.step
        ?.get('close')
        ?.statements?.map((statement: Statement) => statement.__kind)
    ).toEqual(['RunStatement', 'TransitionStatement']);
  });

  test('parses colon and arrow step forms into the same statement shape', () => {
    const forms = [
      {
        colon: '    steps:',
        arrow: '    steps: ->',
        read: (source: string) =>
          parseDocument(source).workflow?.get('example')?.steps?.statements,
      },
      {
        colon: '    step main:',
        arrow: '    step main: ->',
        read: (source: string) =>
          parseDocument(source).workflow?.get('example')?.step?.get('main')
            ?.statements,
      },
    ];

    for (const form of forms) {
      const source = (header: string) =>
        [
          'workflow example:',
          '    description: "Example"',
          header,
          '        run @actions.process_return',
          '        transition to @subagent.order_desk',
        ].join('\n');
      const kinds = (header: string) =>
        form
          .read(source(header))
          ?.map((statement: Statement) => statement.__kind);

      expect(kinds(form.colon)).toEqual(kinds(form.arrow));
      expect(kinds(form.arrow)).toEqual([
        'RunStatement',
        'TransitionStatement',
      ]);
    }
  });

  test('normalizes unnamed and named step separators to procedure syntax', () => {
    const cases = [
      { name: 'unnamed_colon', header: 'steps:' },
      { name: 'unnamed_arrow', header: 'steps: ->' },
      { name: 'named_colon', header: 'step main:' },
      { name: 'named_arrow', header: 'step main: ->' },
    ];

    for (const { name, header } of cases) {
      const source = [
        `workflow ${name}:`,
        '    description: "Example"',
        `    ${header}`,
        '        run @actions.process_return',
      ].join('\n');
      const emitted = emitDocument(parseDocument(source));
      const reparsed = parseDocument(emitted);
      expect(reparsed.workflow?.get(name)).toBeDefined();
      const canonicalHeader = header.endsWith(' ->') ? header : `${header} ->`;
      expect(emitted.split('\n')).toContain(`    ${canonicalHeader}`);
    }
  });

  test('round-trips parsed say text using its original spelling', () => {
    const source = [
      'variables:',
      '    order_id: mutable string',
      '',
      'workflow confirmation:',
      '    description: "Confirm the order"',
      '    steps: ->',
      '        say "Order \\"{!@variables.order_id}\\"\\nconfirmed."',
    ].join('\n');

    expect(emitDocument(parseDocument(source))).toBe(source);
  });

  test('validates variable references inside say interpolation', () => {
    const source = [
      'variables:',
      '    order_id: mutable string',
      'workflow confirmation:',
      '    description: "Confirm the order"',
      '    steps: ->',
      '        say "Order {!@variables.typo}"',
    ].join('\n');

    expect(lint(source)).toContainEqual(
      expect.objectContaining({
        code: 'undefined-reference',
        message: "'typo' is not defined in variables",
      })
    );
    expect(
      lint(source.replace('@variables.typo', '@variables.order_id')).filter(
        diagnostic => diagnostic.code === 'undefined-reference'
      )
    ).toEqual([]);
  });

  test('requires a description', () => {
    const missingDescription = lint(
      [
        'workflow missing_description:',
        '    steps:',
        '        say "Done"',
      ].join('\n')
    );
    expect(
      missingDescription.some(
        diagnostic =>
          diagnostic.code === 'missing-required-field' &&
          diagnostic.message.includes('description')
      )
    ).toBe(true);
    expect(missingDescription.map(diagnostic => diagnostic.code)).not.toContain(
      'workflow-step-form-required'
    );
  });

  test('accepts a template expression description', () => {
    const source = [
      'variables:',
      '    order_id: mutable string = ""',
      '',
      'workflow handle_return:',
      '    description: | Return order {!@variables.order_id}',
      '    steps: ->',
      '        say "Done"',
    ].join('\n');

    const description = parseDocument(source).workflow?.get('handle_return')
      ?.description as { __kind?: string } | undefined;
    expect(description?.__kind).toBe('TemplateExpression');
    expect(
      lint(source).filter(
        diagnostic => diagnostic.severity === DiagnosticSeverity.Error
      )
    ).toEqual([]);
    expect(emitDocument(parseDocument(source))).toBe(source);
  });

  test('accepts an optional display label', () => {
    const source = [
      'workflow handle_return:',
      '    label: "Handle Return"',
      '    description: "Return workflow"',
      '    steps: ->',
      '        say "Done"',
    ].join('\n');

    expect(
      parseDocument(source).workflow?.get('handle_return')?.label?.value
    ).toBe('Handle Return');
    expect(codes(source)).not.toContain('unknown-field');
    expect(emitDocument(parseDocument(source))).toBe(source);
  });

  test('registers workflows as transition targets', () => {
    expect(testSchemaCtx.transitionTargetNamespaces.has('workflow')).toBe(true);

    const source = [
      'subagent router:',
      '    description: "Router"',
      '    reasoning:',
      '        instructions: ->',
      '            | Route the request.',
      '        actions:',
      '            start_return: @utils.transition to @workflow.handle_return',
      '    after_reasoning: ->',
      '        transition to @workflow.handle_return',
      'workflow handle_return:',
      '    description: "Return workflow"',
      '    steps: ->',
      '        transition to @subagent.router',
    ].join('\n');
    expect(
      lint(source).filter(
        diagnostic => diagnostic.severity === DiagnosticSeverity.Error
      )
    ).toEqual([]);
  });

  test('reports an authored type field as unknown', () => {
    const result = codes(
      [
        'workflow handle_return:',
        '    type: steps',
        '    description: "Return workflow"',
        '    steps: ->',
        '        say "Done"',
      ].join('\n')
    );

    expect(result).toContain('unknown-field');
  });

  test('requires exactly one steps flow form', () => {
    expect(
      codes(['workflow missing:', '    description: "Missing flow"'].join('\n'))
    ).toContain('workflow-step-form-required');

    expect(
      codes(
        [
          'workflow mixed:',
          '    description: "Mixed flow"',
          '    steps:',
          '        say "Done"',
          '    step close:',
          '        transition to @subagent.order_desk',
        ].join('\n')
      )
    ).toContain('workflow-step-form-conflict');
  });

  test('reports empty unnamed and named step flows', () => {
    expect(
      codes(
        [
          'workflow empty_flow:',
          '    description: "Empty flow"',
          '    steps:',
        ].join('\n')
      )
    ).toContain('workflow-empty-steps');

    expect(
      codes(
        [
          'workflow empty_named:',
          '    description: "Empty named flow"',
          '    step blank_step:',
        ].join('\n')
      )
    ).toContain('workflow-empty-step');
  });

  test('runs existing procedure and semantic linting inside workflows', () => {
    const source = [
      'config:',
      '    agent_type: "GoalBasedAgent"',
      'variables:',
      '    order_id: mutable string',
      '    ready: mutable boolean = True',
      'connected_subagent order_desk:',
      '    target: "agent://order_desk"',
      '    description: "Order desk"',
      'workflow handle_return:',
      '    description: "Collect and process a return."',
      '    actions:',
      '        process_return:',
      '            description: "Process the return"',
      '            target: "flow://process_return"',
      '    steps:',
      '        if @variables.ready == True:',
      '            ask for @variables.order_id',
      '                instructions: "Ask for the order number."',
      '        run @actions.process_return',
      '        set @variables.ready = False',
      '        transition to @connected_subagent.order_desk',
    ].join('\n');

    const errors = lint(source).filter(
      diagnostic => diagnostic.severity === DiagnosticSeverity.Error
    );
    expect(errors).toEqual([]);

    const invalidTransition = codes(
      [
        'workflow broken:',
        '    description: "Broken transition"',
        '    steps:',
        '        transition',
      ].join('\n')
    );
    expect(invalidTransition).toContain('transition-missing-target');
  });

  describe('action input bindings', () => {
    const workflowWith = (steps: string[]) =>
      [
        'variables:',
        '    order_id: mutable string = ""',
        '    ready: mutable boolean = True',
        'workflow handle_return:',
        '    description: "Process a return."',
        '    actions:',
        '        lookup:',
        '            description: "Look up"',
        '            target: "flow://lookup"',
        '            inputs:',
        '                orderId: string',
        '                    is_required: True',
        '                region: string',
        '                    is_required: True',
        '                limit: number = 10',
        '                    is_required: True',
        '                note: string',
        '    steps: ->',
        ...steps,
      ].join('\n');

    const inputErrors = (source: string) =>
      lint(source).filter(
        diagnostic =>
          diagnostic.code === 'workflow-action-missing-input' ||
          diagnostic.code === 'workflow-with-ellipsis' ||
          diagnostic.code === 'action-unknown-input' ||
          diagnostic.code === 'action-missing-input'
      );

    test('reports unbound required inputs with workflow messaging', () => {
      const errors = inputErrors(workflowWith(['        run @actions.lookup']));
      expect(errors).toEqual([
        expect.objectContaining({
          code: 'workflow-action-missing-input',
          severity: DiagnosticSeverity.Error,
          message: expect.stringContaining(
            "unbound required inputs 'orderId', 'region'. Workflow actions have no LLM to fill inputs"
          ),
        }),
      ]);
    });

    test('accepts a run that binds every required input without a default', () => {
      expect(
        inputErrors(
          workflowWith([
            '        run @actions.lookup',
            '            with orderId = @variables.order_id',
            '            with region = "US"',
          ])
        )
      ).toEqual([]);
    });

    test('rejects an ellipsis slot without also reporting it unbound', () => {
      expect(
        inputErrors(
          workflowWith([
            '        run @actions.lookup',
            '            with orderId = ...',
            '            with region = "US"',
          ])
        ).map(diagnostic => [diagnostic.code, diagnostic.severity])
      ).toEqual([['workflow-with-ellipsis', DiagnosticSeverity.Error]]);
    });

    test('rejects unknown inputs with a suggestion and the parameter range', () => {
      const source = workflowWith([
        '        run @actions.lookup',
        '            with orderId = "A1"',
        '            with region = "US"',
        '            with oderId = "typo"',
      ]);
      const line = source.split('\n').length - 1;
      expect(inputErrors(source)).toEqual([
        expect.objectContaining({
          code: 'action-unknown-input',
          severity: DiagnosticSeverity.Error,
          message: "'oderId' is not a defined input of action 'lookup'",
          data: expect.objectContaining({ suggestion: 'orderId' }),
          range: {
            start: { line, character: 17 },
            end: { line, character: 23 },
          },
        }),
      ]);
    });

    test('a misspelled binding does not satisfy the required input', () => {
      expect(
        inputErrors(
          workflowWith([
            '        run @actions.lookup',
            '            with oderId = "A1"',
            '            with region = "US"',
          ])
        ).map(diagnostic => diagnostic.code)
      ).toEqual(['workflow-action-missing-input', 'action-unknown-input']);
    });

    test('checks unknown inputs in nested if and else branches', () => {
      expect(
        inputErrors(
          workflowWith([
            '        if @variables.ready:',
            '            if @variables.ready:',
            '                run @actions.lookup',
            '                    with orderId = "A1"',
            '                    with region = "US"',
            '                    with typo = "x"',
            '            else:',
            '                run @actions.lookup',
            '                    with orderId = "A1"',
            '                    with region = "US"',
            '                    with typo = "y"',
          ])
        ).map(diagnostic => diagnostic.code)
      ).toEqual(['action-unknown-input', 'action-unknown-input']);
    });

    test('preserves ellipsis validation for an unresolved action without unknown-input noise', () => {
      const source = workflowWith([
        '        run @actions.missing',
        '            with typo = ...',
      ]);
      expect(inputErrors(source).map(diagnostic => diagnostic.code)).toEqual([
        'workflow-with-ellipsis',
      ]);
      expect(codes(source)).toContain('undefined-reference');
    });

    test.each(['steps: ->', 'step work: ->'])(
      'validates inputs against workflow actions only in %s',
      step => {
        const source = `
config:
    agent_type: "GoalBasedAgent"
actions:
    lookup:
        description: "Top-level lookup"
        target: "flow://lookup"
        inputs:
            orderId: string
    shadowed:
        description: "Top-level shadowed"
        target: "flow://top_shadowed"
        inputs:
            topOnly: string
workflow handle_return:
    description: "Return"
    actions:
        shadowed:
            description: "Local shadowed"
            target: "flow://local_shadowed"
            inputs:
                localOnly: string
        no_inputs:
            description: "No inputs"
            target: "flow://no_inputs"
    ${step}
        run @actions.lookup
            with orderId = "A1"
            with typo = "x"
        run @actions.shadowed
            with localOnly = "valid"
            with topOnly = "invalid"
        run @actions.no_inputs
            with typo = "x"
`;
        expect(
          inputErrors(source).map(diagnostic => diagnostic.message)
        ).toEqual([
          "'topOnly' is not a defined input of action 'shadowed'",
          "'typo' is not a defined input of action 'no_inputs'",
        ]);
        expect(codes(source)).toContain('workflow-unknown-action');
      }
    );

    test('checks runs inside if and else branches', () => {
      expect(
        codes(
          workflowWith([
            '        if @variables.ready:',
            '            run @actions.lookup',
            '                with region = "US"',
            '        else:',
            '            run @actions.lookup',
            '                with orderId = ...',
            '                with region = "US"',
          ])
        ).filter(code => code.startsWith('workflow-'))
      ).toEqual(['workflow-action-missing-input', 'workflow-with-ellipsis']);
    });

    test('rejects a top-level action the workflow does not define', () => {
      const source = [
        'config:',
        '    agent_type: "GoalBasedAgent"',
        'actions:',
        '    lookup:',
        '        description: "Top-level lookup"',
        '        target: "flow://top_lookup"',
        '        inputs:',
        '            orderId: string',
        '                is_required: True',
        '    shadowed:',
        '        description: "Top-level shadowed"',
        '        target: "flow://top_shadowed"',
        '        inputs:',
        '            orderId: string',
        '                is_required: True',
        'workflow handle_return:',
        '    description: "Process a return."',
        '    actions:',
        '        shadowed:',
        '            description: "Local shadowed"',
        '            target: "flow://local_shadowed"',
        '    steps: ->',
        '        run @actions.lookup',
        '        run @actions.shadowed',
      ].join('\n');
      expect(inputErrors(source)).toEqual([]);
      expect(
        lint(source).filter(
          diagnostic =>
            diagnostic.code === 'workflow-unknown-action' ||
            diagnostic.code === 'undefined-reference'
        )
      ).toEqual([
        expect.objectContaining({
          code: 'workflow-unknown-action',
          severity: DiagnosticSeverity.Error,
          message: expect.stringContaining("'lookup'"),
        }),
      ]);
    });
  });

  test.each(['subagent', 'connected_subagent'])(
    'rejects a workflow named like a %s',
    namespace => {
      const other =
        namespace === 'subagent'
          ? [
              'subagent handle_return:',
              '    description: "Returns"',
              '    reasoning:',
              '        instructions: ->',
              '            | Help.',
            ]
          : [
              'connected_subagent handle_return:',
              '    description: "Returns"',
              '    target: "agent://Returns"',
            ];
      const source = [
        ...other,
        'workflow handle_return:',
        '    description: "Process a return."',
        '    steps: ->',
        '        say "Hi"',
      ].join('\n');
      expect(
        lint(source).filter(d => d.code === 'workflow-duplicate-node-name')
      ).toEqual([
        expect.objectContaining({
          severity: DiagnosticSeverity.Error,
          message: expect.stringContaining(`${namespace} 'handle_return'`),
        }),
      ]);
    }
  );

  test('surfaces workflow schema completions', () => {
    const rootAst = parseDocument('');
    expect(
      getFieldCompletions(rootAst, 0, 0, testSchemaCtx).map(
        candidate => candidate.name
      )
    ).toContain('workflow');

    const workflowSource = [
      'workflow handle_return:',
      '    description: "Return workflow"',
      '    ',
    ].join('\n');
    const workflowAst = parseDocument(workflowSource);
    const fieldCandidates = getFieldCompletions(
      workflowAst,
      2,
      4,
      testSchemaCtx,
      workflowSource
    );
    const fieldNames = fieldCandidates.map(candidate => candidate.name);
    expect(fieldNames).toContain('steps');
    expect(fieldNames).toContain('step');
    expect(
      fieldCandidates.find(candidate => candidate.name === 'steps')?.snippet
    ).toContain('steps: ->');
    expect(
      fieldCandidates.find(candidate => candidate.name === 'step')?.snippet
    ).toContain(': ->');
  });

  test('resolves singular workflow references without making them invocation targets', () => {
    const source = [
      'workflow handle_return:',
      '    description: "Return workflow"',
      '    steps: ->',
      '        say "Done"',
      'workflow caller:',
      '    description: "Caller"',
      '    steps: ->',
      '        run @workflow.handle_return',
    ].join('\n');
    const document = parseDocument(source);

    expect(
      getAvailableNamespaces(testSchemaCtx).map(candidate => candidate.name)
    ).toContain('workflow');
    expect(
      getCompletionCandidates(document, 'workflow', testSchemaCtx)
    ).toContainEqual(expect.objectContaining({ name: 'handle_return' }));
    expect(testSchemaCtx.invocationTargetNamespaces.has('workflow')).toBe(
      false
    );

    expect(
      lint(source).filter(
        diagnostic => diagnostic.code === 'undefined-reference'
      )
    ).toEqual([]);

    const position = findPosition(source, '@workflow.handle_return');
    const definition = findDefinitionAtPosition(
      document,
      position.line,
      position.character,
      testSchemaCtx
    );
    expect(definition.definition?.name).toBe('handle_return');

    expect(
      lint(source.replace('@workflow.handle_return', '@workflow.missing'))
    ).toContainEqual(
      expect.objectContaining({
        code: 'undefined-reference',
      })
    );
  });

  test('exposes workflow procedures and named steps as document symbols', () => {
    const symbols = getDocumentSymbols(
      parseDocument(
        [
          'workflow handle_return:',
          '    description: "Return workflow"',
          '    step collect:',
          '        run @actions.process_return',
        ].join('\n')
      )
    );

    const workflow = symbols.find(
      symbol => symbol.name === 'workflow handle_return'
    );
    expect(workflow?.kind).toBe(SymbolKind.Method);
    const stepContainer = workflow?.children?.find(
      child => child.name === 'step'
    );
    expect(stepContainer?.children?.map(child => child.name)).toContain(
      'collect'
    );
  });

  test('keeps singular workflow and plural workflows namespaces independent', () => {
    const source = [
      'workflows:',
      '    shared:',
      '        prompt: "Legacy workflow"',
      'workflow shared:',
      '    description: "Modern workflow"',
      '    step main: ->',
      '        run @workflows.shared',
      '        run @workflow.shared',
      'workflow duplicate_steps:',
      '    description: "Duplicate step names"',
      '    step duplicate: ->',
      '        say "Done"',
      '    step duplicate: ->',
      '        say "Done"',
    ].join('\n');
    const document = parseDocument(source);

    expect(document.workflows?.get('shared')).toBeDefined();
    expect(document.workflow?.get('shared')).toBeDefined();
    expect(
      getCompletionCandidates(document, 'workflow', testSchemaCtx)
    ).toContainEqual(expect.objectContaining({ name: 'shared' }));
    expect(
      getCompletionCandidates(document, 'workflows', testSchemaCtx)
    ).toContainEqual(expect.objectContaining({ name: 'shared' }));
    expect(
      lint(source).filter(
        diagnostic => diagnostic.code === 'undefined-reference'
      )
    ).toEqual([]);
    expect(codes(source)).toContain('duplicate-key');
  });
});
