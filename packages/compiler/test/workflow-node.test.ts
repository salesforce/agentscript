/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import type { WorkflowNode } from '../src/types.js';
import { parseSource } from './test-utils.js';
import { DiagnosticSeverity } from '@agentscript/types';

const HEADER = `
config:
    developer_name: "WorkflowAgent"

variables:
    order_id: mutable string = ""
        description: "Order id"
    is_vip: mutable boolean = False
        description: "VIP flag"
    session_id: linked string
        source: @MessagingSession.Id
        description: "Session id"

start_agent main:
    description: "Entry point"
    reasoning:
        instructions: ->
            | Route.
        actions:
            go_flow: @utils.transition to @workflow.flow

subagent support:
    description: "Support"
    reasoning:
        instructions: ->
            | Help.
`;

function compileSource(source: string) {
  const result = compile(parseSource(source));
  const errorDiagnostics = result.diagnostics.filter(
    d => d.severity === DiagnosticSeverity.Error
  );
  const errors = errorDiagnostics.map(d => d.message);
  const codes = errorDiagnostics.map(d => d.code);
  const workflow = result.output.agent_version.nodes.find(
    (n): n is WorkflowNode => n.type === 'workflow'
  );
  return { result, errors, codes, workflow };
}

/** Compile `workflow flow:` with `body`, adding the required description if absent. */
function compileWorkflow(body: string, header = HEADER) {
  const description = body.includes('\n    description:')
    ? ''
    : '\n    description: "Test workflow"';
  return compileSource(`${header}\nworkflow flow:${description}\n${body}`);
}

describe('workflow node compilation', () => {
  it('compiles template instructions on ask-for directives', () => {
    const { errors, workflow } = compileWorkflow(`
    step collect: ->
        ask for @variables.order_id
            instructions: |
                Confirm the order for VIP {!@variables.is_vip}.
`);
    expect(errors).toEqual([]);
    expect(workflow?.steps[0].directives[0]).toMatchObject({
      type: 'ask_for',
      instructions: 'Confirm the order for VIP {{state.is_vip}}.',
    });
  });

  it('compiles named steps in source order with identity fields', () => {
    const { errors, workflow } = compileWorkflow(`
    description: "A flow"
    step greet: ->
        say "Hello {!@variables.order_id}"
    step collect: ->
        ask for @variables.order_id
            instructions: "Ask for the order id."
`);

    expect(errors).toEqual([]);
    expect(workflow).toMatchObject({
      type: 'workflow',
      developer_name: 'flow',
      label: 'Flow',
      description: 'A flow',
      steps: [
        {
          name: 'greet',
          directives: [
            {
              type: 'say',
              text: 'Hello {{state.order_id}}',
              developer_name: 'flow_greet_say_01',
            },
          ],
        },
        {
          name: 'collect',
          directives: [
            {
              type: 'ask_for',
              llm_inputs: ['order_id'],
              instructions: 'Ask for the order id.',
              developer_name: 'flow_collect_ask_for_01',
            },
          ],
        },
      ],
    });
  });

  it('uses an explicit label when provided', () => {
    const { workflow } = compileWorkflow(`
    label: "Order Flow"
    step greet: ->
        say "Hi"
`);
    expect(workflow?.label).toBe('Order Flow');
  });

  it('compiles an unnamed steps block as a single step named main', () => {
    const { errors, workflow } = compileWorkflow(`
    steps: ->
        say "Hi"
        escalate
`);
    expect(errors).toEqual([]);
    expect(workflow?.steps).toEqual([
      {
        name: 'main',
        directives: [
          { type: 'say', text: 'Hi', developer_name: 'flow_main_say_01' },
          {
            type: 'handoff',
            target: '__human__',
            developer_name: 'flow_main_handoff_02',
          },
        ],
      },
    ]);
  });

  it('lowers set, run, and transition to action and handoff directives', () => {
    const { errors, workflow } = compileWorkflow(`
    actions:
        lookup:
            description: "Look up"
            inputs:
                orderId: string
            outputs:
                found: boolean
            target: "flow://Lookup"
    step work: ->
        set @variables.order_id = "A1"
        run @actions.lookup
            with orderId = @variables.order_id
            set @variables.is_vip = @outputs.found
        transition to @subagent.support
`);

    expect(errors).toEqual([]);
    expect(workflow?.steps[0].directives).toEqual([
      {
        type: 'action',
        target: '__state_update_action__',
        state_updates: [{ order_id: '"A1"' }],
        developer_name: 'flow_work_action_01',
      },
      {
        type: 'action',
        target: 'lookup',
        bound_inputs: { orderId: 'state.order_id' },
        state_updates: [{ is_vip: 'result.found' }],
        developer_name: 'flow_work_action_02',
      },
      {
        type: 'handoff',
        target: 'support',
        developer_name: 'flow_work_handoff_03',
      },
    ]);
    expect(workflow?.action_definitions?.map(d => d.developer_name)).toEqual([
      'lookup',
    ]);
  });

  it('gates if / else if / else bodies with composed enabled conditions', () => {
    const { errors, workflow } = compileWorkflow(`
    step decide: ->
        say "Start"
        if @variables.order_id == "A1":
            say "First"
            escalate
        else if @variables.is_vip:
            say "Second"
        else:
            say "Third"
`);

    expect(errors).toEqual([]);
    const directives = workflow?.steps[0].directives ?? [];
    expect(directives.map(d => [d.developer_name, d.enabled])).toEqual([
      ['flow_decide_say_01', undefined],
      ['flow_decide_say_02', 'state.order_id == "A1"'],
      ['flow_decide_handoff_03', 'state.order_id == "A1"'],
      [
        'flow_decide_say_04',
        '(not (state.order_id == "A1")) and (state.is_vip)',
      ],
      [
        'flow_decide_say_05',
        '(not (state.order_id == "A1")) and (not (state.is_vip))',
      ],
    ]);
  });

  it('routes @utils.transition to a workflow node', () => {
    const { result } = compileWorkflow(`
    description: "Workflow description"
    step greet: ->
        say "Hi"
`);
    const startAgent = result.output.agent_version.nodes.find(
      n => n.developer_name === 'main'
    );
    expect(JSON.stringify(startAgent)).toContain('"target":"flow"');
    expect(JSON.stringify(startAgent)).toContain(
      '"description":"Workflow description"'
    );
  });

  it('runs only workflow actions, never top-level ones', () => {
    const source = `
config:
    developer_name: "GbaAgent"
    agent_type: "GoalBasedAgent"

actions:
    shared:
        description: "Top-level shared"
        target: "flow://top_shared"
    top_only:
        description: "Top-level only"
        target: "flow://top_only"
    unused:
        description: "Never referenced"
        target: "flow://unused"

orchestrator agent:
    reasoning:
        instructions: ->
            | Help.

workflow flow:
    actions:
        shared:
            description: "Local shared"
            target: "flow://local_shared"
    step work: ->
        run @actions.shared
        run @actions.top_only
`;
    const { errors, codes, workflow } = compileSource(source);
    expect(codes).toEqual(['workflow-unknown-action']);
    expect(errors[0]).toContain("'top_only'");
    expect(
      workflow?.action_definitions?.map(d => [
        d.developer_name,
        d.invocation_target_name,
      ])
    ).toEqual([['shared', 'local_shared']]);
    expect(workflow?.steps[0].directives).toHaveLength(1);
  });

  describe('unsupported constructs', () => {
    it.each([
      [
        'transition to a step',
        `
    step a: ->
        say "Hi"
    step b: ->
        transition to @step.a
`,
        'Transitioning to a workflow step is not supported',
      ],
      [
        'end_session',
        `
    step a: ->
        end_session
`,
        'end_session is not supported inside a workflow',
      ],
      [
        'running a non-action target',
        `
    step a: ->
        run @utils.escalate
`,
        "'run @utils.escalate' is not supported inside a workflow",
      ],
      [
        'instruction template lines',
        `
    step a: ->
        | Say hello.
`,
        "Instruction lines ('|') are not supported inside a workflow",
      ],
      [
        'ask for on a linked variable',
        `
    step a: ->
        ask for @variables.session_id
            instructions: "Ask."
`,
        "'ask for' in a workflow must target a mutable variable",
      ],
    ])('rejects %s', (_label, body, message) => {
      const { errors } = compileWorkflow(body);
      expect(errors.some(e => e.includes(message))).toBe(true);
    });

    it('rejects a workflow with no compilable directives', () => {
      const { errors } = compileWorkflow(`
    step a: ->
        end_session
`);
      expect(errors.some(e => e.includes('has no compilable directives'))).toBe(
        true
      );
    });

    it('rejects a generated directive name longer than 80 characters once per step', () => {
      const { errors } = compileWorkflow(`
    step ${'s'.repeat(70)}: ->
        say "Hi"
        say "Again"
`);
      expect(
        errors.filter(e => e.includes('exceeds 80 characters'))
      ).toHaveLength(1);
    });

    it.each([
      ['say', 'say ""', 'workflow-empty-say'],
      [
        'ask for',
        `ask for @variables.order_id
            instructions: ""`,
        'workflow-ask-for-missing-instructions',
      ],
    ])(
      'rejects empty %s text without a generic schema error',
      (_label, stmt, code) => {
        const { codes } = compileWorkflow(`
    step a: ->
        ${stmt}
        escalate
`);
        expect(codes).toContain(code);
        expect(codes).not.toContain('schema-validation');
      }
    );
  });

  describe('directive names', () => {
    it.each([
      ['flow__name', 'work'],
      ['flow_', 'work'],
      ['flow', 'work__name'],
      ['flow', 'work_'],
    ])(
      'reports invalid generated names for workflow %s / step %s',
      (name, step) => {
        const { errors, codes } = compileSource(`${HEADER}
workflow ${name}:
    description: "Flow"
    step ${step}: ->
        say "Hi"
        say "Again"
`);
        expect(
          codes.filter(code => code === 'workflow-invalid-directive-name')
        ).toHaveLength(1);
        expect(errors).toContainEqual(
          expect.stringContaining('is not a valid developer name')
        );
      }
    );

    it('accepts single underscores in workflow and step names', () => {
      const { errors, workflow } = compileSource(`${HEADER}
workflow return_order:
    description: "Return"
    step check_order: ->
        say "Hi"
`);
      expect(errors).toEqual([]);
      expect(workflow?.steps[0].directives[0].developer_name).toBe(
        'return_order_check_order_say_01'
      );
    });

    it('are unique across steps and number every directive in a step, including branches', () => {
      const { errors, workflow } = compileWorkflow(`
    step first: ->
        say "Hi"
        if @variables.is_vip:
            say "VIP"
        else:
            escalate
    step second: ->
        say "Hi"
`);
      expect(errors).toEqual([]);
      const names = (workflow?.steps ?? []).flatMap(step =>
        step.directives.map(d => d.developer_name)
      );
      expect(names).toEqual([
        'flow_first_say_01',
        'flow_first_say_02',
        'flow_first_handoff_03',
        'flow_second_say_01',
      ]);
      expect(new Set(names).size).toBe(names.length);
    });
  });

  describe('agent-wide model configuration', () => {
    it.each([
      [
        'model and parameters',
        '    model: "model://test_model"\n    params:\n        temperature: 0.2\n        max_tokens: 2000',
        {
          model_ref: 'test_model',
          configuration: { temperature: 0.2, max_tokens: 2000 },
        },
      ],
      [
        'parameters only',
        '    params:\n        temperature: 0.2',
        { model_ref: null, configuration: { temperature: 0.2 } },
      ],
    ])(
      'inherits %s on the compiled workflow node',
      (_label, config, expected) => {
        const { errors, workflow } = compileWorkflow(
          '\n    step greet: ->\n        say "Hi"',
          `${HEADER}\nmodel_config:\n${config}\n`
        );
        expect(errors).toEqual([]);
        expect(workflow?.model_configuration).toEqual(expected);
      }
    );

    it('omits model configuration when no agent-wide defaults are authored', () => {
      const { errors, workflow } = compileWorkflow(
        '\n    step greet: ->\n        say "Hi"'
      );
      expect(errors).toEqual([]);
      expect(workflow).not.toHaveProperty('model_configuration');
    });
  });

  describe('condition variables written inside a branch', () => {
    it('rejects a write followed by another directive under the same if/else', () => {
      const { codes } = compileWorkflow(`
    step a: ->
        if @variables.order_id == "":
            ask for @variables.order_id
                instructions: "Ask for the order id."
            say "Thanks"
        else:
            say "Using the existing order"
`);
      expect(codes).toEqual(['workflow-condition-written-in-branch']);
    });

    it.each([
      [
        'set in the if body with an else',
        `
        if @variables.is_vip:
            set @variables.is_vip = False
        else:
            say "Not VIP"`,
      ],
      [
        'run with set inside an else',
        `
        if @variables.is_vip:
            say "VIP"
        else:
            run @actions.lookup
                with orderId = @variables.order_id
                set @variables.is_vip = @outputs.found
            say "Checked"`,
      ],
      [
        'a write to a variable read by an outer condition',
        `
        if @variables.is_vip:
            if @variables.order_id == "":
                set @variables.is_vip = False
            say "Done"`,
      ],
    ])('rejects %s', (_label, body) => {
      const { codes } = compileWorkflow(`
    actions:
        lookup:
            description: "Look up"
            inputs:
                orderId: string
            outputs:
                found: boolean
            target: "flow://Lookup"
    step a: ->${body}
`);
      expect(codes).toEqual(['workflow-condition-written-in-branch']);
    });

    it.each([
      [
        'the write is the last directive of the if/else',
        `
        if @variables.order_id == "":
            say "Need an order"
            ask for @variables.order_id
                instructions: "Ask for the order id."
        say "Thanks"`,
      ],
      [
        'the written variable is not read by the condition',
        `
        if @variables.is_vip:
            set @variables.order_id = "VIP"
            say "Hi"`,
      ],
      [
        'a nested condition reads a variable written before it',
        `
        if @variables.order_id == "":
            set @variables.is_vip = True
            if @variables.is_vip:
                say "VIP"`,
      ],
    ])('allows it when %s', (_label, body) => {
      const { errors } = compileWorkflow(`
    step a: ->${body}
`);
      expect(errors).toEqual([]);
    });
  });

  describe('action input bindings', () => {
    const lookupAction = (inputs: string, extra = '') => `
    actions:
        lookup:
            description: "Look up"${extra}
            inputs:
${inputs}
            target: "flow://Lookup"`;

    /** Diagnostics other than the follow-on errors for an empty workflow. */
    function actionDiagnostics(
      result: ReturnType<typeof compileWorkflow>['result']
    ) {
      return result.diagnostics
        .filter(
          d =>
            d.code !== 'workflow-no-directives' &&
            d.code !== 'schema-validation'
        )
        .map(d => [d.severity, d.code]);
    }

    it('rejects an ellipsis slot at compile time and drops the directive', () => {
      const { codes, workflow } = compileWorkflow(`${lookupAction(
        `                orderId: string
                region: string`
      )}
    step a: ->
        run @actions.lookup
            with orderId = ...
            with region = "US"
`);
      expect(codes).toContain('workflow-with-ellipsis');
      expect(workflow?.steps).toEqual([]);
    });

    it('rejects an unknown action and an unknown input', () => {
      const unknownAction = compileWorkflow(`
    step a: ->
        run @actions.missing
`);
      expect(unknownAction.codes).toContain('workflow-unknown-action');

      const unknownInput = compileWorkflow(`${lookupAction(
        '                orderId: string'
      )}
    step a: ->
        run @actions.lookup
            with orderId = "A1"
            with typo = "x"
`);
      expect(unknownInput.codes).toContain('action-unknown-input');
    });

    it('requires only inputs marked is_required: True without a default', () => {
      const { result, errors } = compileWorkflow(`${lookupAction(
        `                orderId: string
                    is_required: True
                region: string
                note: string
                    is_required: False`
      )}
    step a: ->
        run @actions.lookup
            with region = "US"
`);
      expect(actionDiagnostics(result)).toEqual([
        [DiagnosticSeverity.Error, 'workflow-action-missing-input'],
      ]);
      expect(errors.join('\n')).toContain("'orderId'");
      expect(errors.join('\n')).not.toContain("'region'");
      expect(errors.join('\n')).not.toContain("'note'");
    });

    it('binds unbound inputs that have a definition default', () => {
      const { errors, workflow } = compileWorkflow(`${lookupAction(
        `                orderId: string = @variables.order_id
                    is_required: True
                limit: number = 0
                strict: boolean = False
                note: string = ""
                region: string = "EU"`
      )}
    step a: ->
        run @actions.lookup
            with region = "US"
`);
      expect(errors).toEqual([]);
      expect(workflow?.steps[0].directives[0]).toMatchObject({
        type: 'action',
        target: 'lookup',
        bound_inputs: {
          region: '"US"',
          orderId: 'state.order_id',
          limit: '0',
          strict: 'False',
          note: '""',
        },
      });
    });

    it('validates against the workflow action, not a same-named top-level one', () => {
      const { codes } = compileSource(`
config:
    developer_name: "GbaAgent"
    agent_type: "GoalBasedAgent"

actions:
    lookup:
        description: "Top-level"
        inputs:
            topOnly: string
        target: "flow://Top"

orchestrator agent:
    reasoning:
        instructions: ->
            | Help.

workflow flow:
    description: "Test workflow"
    actions:
        lookup:
            description: "Local"
            inputs:
                localOnly: string
            target: "flow://Local"
    step a: ->
        run @actions.lookup
            with topOnly = "x"
`);
      expect(codes).toContain('action-unknown-input');
    });

    it('warns, but still emits the action, when require_user_confirmation is True', () => {
      const confirmed = compileWorkflow(`${lookupAction(
        '                orderId: string',
        '\n            require_user_confirmation: True'
      )}
    step a: ->
        run @actions.lookup
            with orderId = "A1"
`);
      expect(actionDiagnostics(confirmed.result)).toEqual([
        [DiagnosticSeverity.Warning, 'workflow-action-confirmation-ignored'],
      ]);
      expect(confirmed.workflow?.steps[0].directives[0]).toMatchObject({
        type: 'action',
        target: 'lookup',
      });

      for (const extra of [
        '',
        '\n            require_user_confirmation: False',
      ]) {
        const { result } = compileWorkflow(`${lookupAction(
          '                orderId: string',
          extra
        )}
    step a: ->
        run @actions.lookup
            with orderId = "A1"
`);
        expect(actionDiagnostics(result)).toEqual([]);
      }
    });
  });

  it('rejects a workflow named like another node', () => {
    const { codes, errors, result } = compileWorkflow(
      `
    step a: ->
        say "Hi"
`,
      HEADER.replace('subagent support:', 'subagent flow:')
    );
    expect(codes).toContain('workflow-duplicate-node-name');
    expect(errors.join('\n')).toContain("subagent 'flow'");
    expect(
      result.output.agent_version.nodes.filter(n => n.developer_name === 'flow')
    ).toHaveLength(1);
  });
});
