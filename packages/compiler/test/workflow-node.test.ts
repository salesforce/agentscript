/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import type { WorkflowDirective, WorkflowNode } from '../src/types.js';
import { parseSource, readFixtureSource } from './test-utils.js';
import { DiagnosticSeverity } from '@agentscript/types';
import { parse } from '@agentscript/parser';
import { dedupeDiagnostics, parseAndLint } from '@agentscript/language';
import { agentforceDialect } from '@agentscript/agentforce-dialect';
import type { ParsedAgentforce } from '@agentscript/agentforce-dialect';

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

/** Name of the workflow condition slot for an `if` at nesting `depth`. */
const slotName = (depth: number) =>
  `AgentScriptInternal_workflow_condition_${depth}`;
/** The guard that reads the slot, or its negation. */
const slotRef = (depth: number) => `state.${slotName(depth)}`;
const notSlotRef = (depth: number) => `not (${slotRef(depth)})`;
/** Evaluate the condition strictly as an input, then copy the echoed result. */
const snapshotFields = (depth: number, condition: string) => ({
  bound_inputs: { condition },
  state_updates: [{ [slotName(depth)]: 'result.condition' }],
});

const WORKFLOW_SLOT_PREFIX = 'AgentScriptInternal_workflow_condition_';

/** Matches a guard built only from workflow condition slots. */
const SLOTS_ONLY =
  /^(?:[()\s]|not|and|state\.AgentScriptInternal_workflow_condition_\d+)+$/;

const WORKFLOW_FIXTURES = [
  'workflow_refund.agent',
  'workflow_unnamed_steps.agent',
  'workflow_do.agent',
];

/** Workflow condition slots declared in `state_variables`, in order. */
function declaredSlots(result: ReturnType<typeof compileSource>['result']) {
  return (result.output.agent_version.state_variables ?? [])
    .map(v => v.developer_name)
    .filter(name => name.startsWith(WORKFLOW_SLOT_PREFIX));
}

/** Every `enabled` guard in a workflow's steps. */
function enabledGuards(workflow: WorkflowNode | undefined) {
  return (workflow?.steps ?? [])
    .flatMap(step => step.directives)
    .flatMap(d => (d.enabled === undefined ? [] : [String(d.enabled)]));
}

/** `[developer_name, enabled]` for each directive. */
function guards(directives: WorkflowDirective[] | undefined) {
  return (directives ?? []).map(d => [d.developer_name, d.enabled]);
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
        chat_history_behavior: { add_to_chat_history: false },
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
    expect(guards(directives)).toEqual([
      ['flow_decide_say_01', undefined],
      ['flow_decide_action_02', undefined],
      ['flow_decide_say_03', slotRef(1)],
      ['flow_decide_handoff_04', slotRef(1)],
      ['flow_decide_action_05', notSlotRef(1)],
      ['flow_decide_say_06', `(${notSlotRef(1)}) and (${slotRef(2)})`],
      ['flow_decide_say_07', `(${notSlotRef(1)}) and (${notSlotRef(2)})`],
    ]);
    expect(directives[1]).toMatchObject({
      ...snapshotFields(1, 'state.order_id == "A1"'),
    });
    expect(directives[4]).toMatchObject({
      ...snapshotFields(2, 'state.is_vip'),
    });
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
        'running a @utils member',
        `
    step a: ->
        run @utils.escalate
`,
        "'run' cannot target '@utils.escalate'. Use 'escalate' instead.",
      ],
      [
        'running a non-action target',
        `
    step a: ->
        run @variables.session_id
`,
        "'run @variables.session_id' is not supported inside a workflow",
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

    it('rejects a workflow with no steps', () => {
      const { codes } = compileWorkflow(`
    actions:
        lookup:
            description: "Look up"
            target: "flow://Lookup"
`);
      expect(codes).toContain('workflow-no-directives');
      expect(codes).not.toContain('schema-validation');
    });

    it('reports only the cause when errors drop every directive', () => {
      const { codes } = compileWorkflow(`
    step a: ->
        end_session
`);
      expect(codes).toEqual(['workflow-unsupported-statement']);
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
        'flow_first_action_02',
        'flow_first_say_03',
        'flow_first_handoff_04',
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

  describe('workflow-level model configuration', () => {
    const STEP = '\n    step greet: ->\n        say "Hi"';

    it('uses the workflow model_config when no agent-wide default is authored', () => {
      const { errors, workflow } = compileWorkflow(
        `    model_config:\n        model: "model://workflow_model"\n        params:\n            temperature: 0.4${STEP}`
      );
      expect(errors).toEqual([]);
      expect(workflow?.model_configuration).toEqual({
        model_ref: 'workflow_model',
        configuration: { temperature: 0.4 },
      });
    });

    it('overrides the agent-wide model and merges params with workflow params winning', () => {
      const { errors, workflow } = compileWorkflow(
        `    model_config:\n        model: "model://workflow_model"\n        params:\n            temperature: 0.9${STEP}`,
        `${HEADER}\nmodel_config:\n    model: "model://agent_model"\n    params:\n        temperature: 0.2\n        max_tokens: 2000\n`
      );
      expect(errors).toEqual([]);
      expect(workflow?.model_configuration).toEqual({
        model_ref: 'workflow_model',
        configuration: { temperature: 0.9, max_tokens: 2000 },
      });
    });

    it('keeps the agent-wide model when the workflow sets params only', () => {
      const { errors, workflow } = compileWorkflow(
        `    model_config:\n        params:\n            temperature: 0.9${STEP}`,
        `${HEADER}\nmodel_config:\n    model: "model://agent_model"\n`
      );
      expect(errors).toEqual([]);
      expect(workflow?.model_configuration).toEqual({
        model_ref: 'agent_model',
        configuration: { temperature: 0.9 },
      });
    });
  });

  describe('if conditions are evaluated once', () => {
    it('stores the condition in a slot and gates the branch on it', () => {
      const { errors, workflow } = compileWorkflow(`
    step a: ->
        if @variables.is_vip:
            say "VIP"
`);
      expect(errors).toEqual([]);
      expect(workflow?.steps[0].directives).toEqual([
        {
          type: 'action',
          target: '__state_update_action__',
          ...snapshotFields(1, 'state.is_vip'),
          chat_history_behavior: { add_to_chat_history: false },
          developer_name: 'flow_a_action_01',
        },
        {
          type: 'say',
          text: 'VIP',
          enabled: slotRef(1),
          developer_name: 'flow_a_say_02',
        },
      ]);
    });

    it('gates the else on the stored condition when the if body changes it', () => {
      const { errors, workflow } = compileWorkflow(`
    step a: ->
        if @variables.order_id == "":
            ask for @variables.order_id
                instructions: "Ask for the order id."
            say "Thanks"
        else:
            say "Using the existing order"
`);
      expect(errors).toEqual([]);
      const directives = workflow?.steps[0].directives ?? [];
      expect(guards(directives)).toEqual([
        ['flow_a_action_01', undefined],
        ['flow_a_ask_for_02', slotRef(1)],
        ['flow_a_say_03', slotRef(1)],
        ['flow_a_say_04', notSlotRef(1)],
      ]);
      expect(directives[0]).toMatchObject({
        ...snapshotFields(1, 'state.order_id == ""'),
      });
    });

    it.each([
      [
        'an ask for changes the condition and another directive follows',
        `
        if @variables.order_id == "":
            ask for @variables.order_id
                instructions: "Ask for the order id."
            say "Thanks"
        else:
            say "Using the existing order"`,
      ],
      [
        'a set in the if body changes the condition and there is an else',
        `
        if @variables.is_vip:
            set @variables.is_vip = False
        else:
            say "Not VIP"`,
      ],
      [
        'a run with set in the else changes the condition',
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
        'a nested write changes a variable an outer condition reads',
        `
        if @variables.is_vip:
            if @variables.order_id == "":
                set @variables.is_vip = False
            say "Done"`,
      ],
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
    ])(
      'compiles when %s, with every guard reading only slots',
      (_label, body) => {
        const { errors, workflow } = compileWorkflow(`
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
        expect(errors).toEqual([]);
        const guarded = enabledGuards(workflow);
        expect(guarded.length).toBeGreaterThan(0);
        for (const guard of guarded) expect(guard).toMatch(SLOTS_ONLY);
      }
    );

    it('stores a condition on a system variable, which can change while an ask for is paused', () => {
      const { errors, result, workflow } = compileWorkflow(`
    step a: ->
        if @system_variables.user_input == "yes":
            ask for @variables.order_id
                instructions: "Ask for the order id."
        else:
            say "Skipped"
`);
      expect(errors).toEqual([]);
      const directives = workflow?.steps[0].directives ?? [];
      expect(guards(directives)).toEqual([
        ['flow_a_action_01', undefined],
        ['flow_a_ask_for_02', slotRef(1)],
        ['flow_a_say_03', notSlotRef(1)],
      ]);
      expect(directives[0]).toMatchObject({
        ...snapshotFields(1, 'system.input_text == "yes"'),
      });
      expect(declaredSlots(result)).toEqual([slotName(1)]);
    });

    it('stores a truthy non-boolean condition as written', () => {
      const { errors, workflow } = compileWorkflow(`
    step a: ->
        if @variables.order_id:
            say "Has an order"
`);
      expect(errors).toEqual([]);
      expect(workflow?.steps[0].directives[0]).toMatchObject({
        ...snapshotFields(1, 'state.order_id'),
      });
    });

    it.each([
      [
        'a missing nested key',
        '@variables.payload.missing',
        'state.payload.missing',
      ],
      ['an invalid comparison', '@variables.amount > 0', 'state.amount > 0'],
      ['a false result', 'False', 'False'],
      ['a None result', 'None', 'None'],
    ])(
      'evaluates %s through strict bound inputs rather than a state update',
      (_label, sourceCondition, compiledCondition) => {
        const { errors, workflow } = compileWorkflow(
          `
    step a: ->
        if ${sourceCondition}:
            say "Body"
        else:
            say "Else"
`,
          HEADER.replace(
            'variables:',
            `variables:
    payload: mutable object = {}
        description: "Payload"
    amount: mutable number
        description: "Amount"`
          )
        );
        expect(errors).toEqual([]);
        // The original expression must only occur in bound_inputs: ActionNode
        // propagates input errors; state_updates skip missing-key errors.
        // The result copy has no False reset that could select the else on error.
        expect(workflow?.steps[0].directives).toEqual([
          {
            type: 'action',
            target: '__state_update_action__',
            bound_inputs: { condition: compiledCondition },
            state_updates: [{ [slotName(1)]: 'result.condition' }],
            chat_history_behavior: { add_to_chat_history: false },
            developer_name: 'flow_a_action_01',
          },
          {
            type: 'say',
            text: 'Body',
            enabled: slotRef(1),
            developer_name: 'flow_a_say_02',
          },
          {
            type: 'say',
            text: 'Else',
            enabled: notSlotRef(1),
            developer_name: 'flow_a_say_03',
          },
        ]);
      }
    );

    describe('nesting', () => {
      it('gates an if in the body on the enclosing slot and keeps the outer else on its own', () => {
        const { errors, workflow } = compileWorkflow(`
    step a: ->
        if @variables.is_vip:
            say "outer"
            if @variables.order_id == "A":
                say "inner yes"
            else:
                say "inner no"
            say "after inner"
        else:
            say "outer else"
`);
        expect(errors).toEqual([]);
        const directives = workflow?.steps[0].directives ?? [];
        expect(guards(directives)).toEqual([
          ['flow_a_action_01', undefined],
          ['flow_a_say_02', slotRef(1)],
          ['flow_a_action_03', slotRef(1)],
          ['flow_a_say_04', `(${slotRef(1)}) and (${slotRef(2)})`],
          ['flow_a_say_05', `(${slotRef(1)}) and (${notSlotRef(2)})`],
          ['flow_a_say_06', slotRef(1)],
          ['flow_a_say_07', notSlotRef(1)],
        ]);
        expect(directives[0]).toMatchObject({
          ...snapshotFields(1, 'state.is_vip'),
        });
        expect(directives[2]).toMatchObject({
          ...snapshotFields(2, 'state.order_id == "A"'),
        });
      });

      it('gates an if in the else on the negated enclosing slot', () => {
        const { errors, workflow } = compileWorkflow(`
    step a: ->
        if @variables.is_vip:
            say "vip"
        else:
            if @variables.order_id == "A":
                say "a"
            say "other"
`);
        expect(errors).toEqual([]);
        expect(guards(workflow?.steps[0].directives)).toEqual([
          ['flow_a_action_01', undefined],
          ['flow_a_say_02', slotRef(1)],
          ['flow_a_action_03', notSlotRef(1)],
          ['flow_a_say_04', `(${notSlotRef(1)}) and (${slotRef(2)})`],
          ['flow_a_say_05', notSlotRef(1)],
        ]);
      });

      it('reuses the inner slot for sibling ifs after a nested if', () => {
        const { errors, result, workflow } = compileWorkflow(`
    step a: ->
        if @variables.is_vip:
            if @variables.order_id == "A":
                say "x"
            if @variables.order_id == "B":
                say "y"
        else:
            say "z"
`);
        expect(errors).toEqual([]);
        const directives = workflow?.steps[0].directives ?? [];
        expect(guards(directives)).toEqual([
          ['flow_a_action_01', undefined],
          ['flow_a_action_02', slotRef(1)],
          ['flow_a_say_03', `(${slotRef(1)}) and (${slotRef(2)})`],
          ['flow_a_action_04', slotRef(1)],
          ['flow_a_say_05', `(${slotRef(1)}) and (${slotRef(2)})`],
          ['flow_a_say_06', notSlotRef(1)],
        ]);
        expect(directives[1]).toMatchObject({
          ...snapshotFields(2, 'state.order_id == "A"'),
        });
        expect(directives[3]).toMatchObject({
          ...snapshotFields(2, 'state.order_id == "B"'),
        });
        expect(declaredSlots(result)).toEqual([slotName(1), slotName(2)]);
      });

      it('declares one slot per nesting level', () => {
        const { errors, result } = compileWorkflow(`
    step a: ->
        if @variables.is_vip:
            if @variables.order_id == "A":
                if @variables.order_id == "B":
                    say "deep"
`);
        expect(errors).toEqual([]);
        const slots = (
          result.output.agent_version.state_variables ?? []
        ).filter(v => v.developer_name.startsWith(WORKFLOW_SLOT_PREFIX));
        expect(slots).toEqual(
          [1, 2, 3].map(depth =>
            expect.objectContaining({
              developer_name: slotName(depth),
              data_type: 'boolean',
              is_list: false,
              visibility: 'Internal',
            })
          )
        );
      });

      it('reuses the first slot for sibling ifs and for ifs in other steps', () => {
        const { errors, result, workflow } = compileWorkflow(`
    step a: ->
        if @variables.is_vip:
            say "1"
        if @variables.order_id == "A":
            say "2"
    step b: ->
        if @variables.is_vip:
            say "3"
`);
        expect(errors).toEqual([]);
        const [stepA, stepB] = workflow?.steps ?? [];
        expect(guards(stepA.directives)).toEqual([
          ['flow_a_action_01', undefined],
          ['flow_a_say_02', slotRef(1)],
          ['flow_a_action_03', undefined],
          ['flow_a_say_04', slotRef(1)],
        ]);
        expect(guards(stepB.directives)).toEqual([
          ['flow_b_action_01', undefined],
          ['flow_b_say_02', slotRef(1)],
        ]);
        expect(declaredSlots(result)).toEqual([slotName(1)]);
      });
    });

    describe('else if chains', () => {
      it('takes the next slot inside an else if link and inside the trailing else', () => {
        const { errors, result, workflow } = compileWorkflow(`
    step a: ->
        if @variables.order_id == "A":
            say "a"
        else if @variables.is_vip:
            if @variables.order_id == "B":
                say "b"
        else:
            if @variables.order_id == "C":
                say "c"
`);
        expect(errors).toEqual([]);
        expect(guards(workflow?.steps[0].directives)).toEqual([
          ['flow_a_action_01', undefined],
          ['flow_a_say_02', slotRef(1)],
          ['flow_a_action_03', notSlotRef(1)],
          ['flow_a_action_04', `(${notSlotRef(1)}) and (${slotRef(2)})`],
          [
            'flow_a_say_05',
            `(${notSlotRef(1)}) and (${slotRef(2)}) and (${slotRef(3)})`,
          ],
          ['flow_a_action_06', `(${notSlotRef(1)}) and (${notSlotRef(2)})`],
          [
            'flow_a_say_07',
            `(${notSlotRef(1)}) and (${notSlotRef(2)}) and (${slotRef(3)})`,
          ],
        ]);
        expect(declaredSlots(result)).toEqual([1, 2, 3].map(slotName));
      });

      it('numbers the links the same when a middle link produces no directive', () => {
        const { codes, result, workflow } = compileWorkflow(`
    step a: ->
        if @variables.order_id == "A":
            say "a"
        else if @variables.is_vip:
            end_session
        else if @variables.order_id == "B":
            say "b"
`);
        expect(codes).toEqual(['workflow-unsupported-statement']);
        expect(guards(workflow?.steps[0].directives)).toEqual([
          ['flow_a_action_01', undefined],
          ['flow_a_say_02', slotRef(1)],
          ['flow_a_action_03', notSlotRef(1)],
          ['flow_a_action_04', `(${notSlotRef(1)}) and (${notSlotRef(2)})`],
          [
            'flow_a_say_05',
            `(${notSlotRef(1)}) and (${notSlotRef(2)}) and (${slotRef(3)})`,
          ],
        ]);
        expect(declaredSlots(result)).toEqual([1, 2, 3].map(slotName));
      });
    });

    describe('branches that produce no directives', () => {
      it('emits no snapshot and declares no slot when neither branch produces a directive', () => {
        const { codes, result, workflow } = compileWorkflow(`
    step a: ->
        say "Hi"
        if @variables.is_vip:
            end_session
`);
        expect(codes).toEqual(['workflow-unsupported-statement']);
        expect(workflow?.steps[0].directives.map(d => d.type)).toEqual(['say']);
        expect(declaredSlots(result)).toEqual([]);
      });

      it('keeps the snapshot when only the else produces a directive', () => {
        const { codes, result, workflow } = compileWorkflow(`
    step a: ->
        if @variables.is_vip:
            end_session
        else:
            say "Fine"
`);
        expect(codes).toEqual(['workflow-unsupported-statement']);
        expect(guards(workflow?.steps[0].directives)).toEqual([
          ['flow_a_action_01', undefined],
          ['flow_a_say_02', notSlotRef(1)],
        ]);
        expect(declaredSlots(result)).toEqual([slotName(1)]);
      });
    });

    describe('slots in the whole agent', () => {
      it('keeps workflow slots apart from subagent chain and system instruction slots', () => {
        const header = [
          'system:',
          '    instructions: ->',
          '        | You are helpful.',
          '        if @variables.is_vip:',
          '            | VIP.',
          '        else:',
          '            | Polite.',
          HEADER.replace(
            '            | Help.',
            [
              '            if @variables.order_id == "A":',
              '                | A.',
              '            else if @variables.order_id == "B":',
              '                | B.',
              '            else if @variables.order_id == "C":',
              '                | C.',
              '            else:',
              '                | Other.',
            ].join('\n')
          ),
          'workflow other:',
          '    description: "Other"',
          '    step b: ->',
          '        if @variables.is_vip:',
          '            if @variables.order_id == "A":',
          '                say "b"',
          '',
        ].join('\n');
        const { errors, result } = compileWorkflow(
          `
    step a: ->
        if @variables.is_vip:
            if @variables.order_id == "A":
                say "a"
`,
          header
        );
        expect(errors).toEqual([]);

        const declared = (
          result.output.agent_version.state_variables ?? []
        ).map(v => v.developer_name);
        expect(new Set(declared).size).toBe(declared.length);
        expect(
          declared.filter(name =>
            name.startsWith('AgentScriptInternal_condition_')
          )
        ).toEqual([1, 2, 3].map(i => `AgentScriptInternal_condition_${i}`));
        expect(declaredSlots(result)).toEqual([slotName(1), slotName(2)]);

        const workflows = result.output.agent_version.nodes.filter(
          (n): n is WorkflowNode => n.type === 'workflow'
        );
        expect(workflows).toHaveLength(2);
        for (const workflow of workflows) {
          const guarded = enabledGuards(workflow);
          expect(guarded.length).toBeGreaterThan(0);
          for (const guard of guarded) expect(guard).toMatch(SLOTS_ONLY);
        }
      });
    });

    it.each(WORKFLOW_FIXTURES)(
      'gates every directive in %s on workflow slots only',
      fixture => {
        const { errors, workflow } = compileSource(readFixtureSource(fixture));
        expect(errors).toEqual([]);
        const guarded = enabledGuards(workflow);
        expect(guarded.length).toBeGreaterThan(0);
        for (const guard of guarded) expect(guard).toMatch(SLOTS_ONLY);
      }
    );

    it('can push a long step name over the directive name limit with the snapshot action', () => {
      // `flow_<step>_say_02` is exactly 80 characters; `_action_01` is 3 longer.
      const step = 'a'.repeat(68);
      const withoutIf = compileWorkflow(`
    step ${step}: ->
        say "Hi"
        say "Hi"
`);
      expect(withoutIf.codes).toEqual([]);

      const withIf = compileWorkflow(`
    step ${step}: ->
        if @variables.is_vip:
            say "Hi"
`);
      expect(
        withIf.codes.filter(code => code === 'workflow-invalid-directive-name')
      ).toHaveLength(1);
      expect(withIf.errors).toContainEqual(
        expect.stringContaining('exceeds 80 characters')
      );
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

    function actionDiagnostics(
      result: ReturnType<typeof compileWorkflow>['result']
    ) {
      return result.diagnostics.map(d => [d.severity, d.code]);
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

    it.each([
      ["a '|' line", '| Say the status.', "A '|' line cannot be inside 'run'"],
      ['a say', 'say "Done"', "Only 'with' and 'set' clauses"],
    ])('rejects %s inside a run body', (_label, stmt, message) => {
      const { errors, codes, workflow } = compileWorkflow(`${lookupAction(
        '                orderId: string'
      )}
    step a: ->
        run @actions.lookup
            with orderId = @variables.order_id
            ${stmt}
`);
      expect(codes).toEqual(['workflow-unsupported-statement']);
      expect(errors[0]).toContain(message);
      expect(workflow?.steps).toEqual([]);
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

    it.each([
      ['True', true],
      ['False', false],
    ])(
      'emits require_user_confirmation: %s on the workflow action definition',
      (value, expected) => {
        const { result, workflow } = compileWorkflow(`${lookupAction(
          '                orderId: string',
          `\n            require_user_confirmation: ${value}`
        )}
    step a: ->
        run @actions.lookup
            with orderId = "A1"
`);
        expect(actionDiagnostics(result)).toEqual([]);
        expect(workflow?.steps[0].directives[0]).toMatchObject({
          type: 'action',
          target: 'lookup',
        });
        expect(workflow?.action_definitions).toEqual([
          expect.objectContaining({
            developer_name: 'lookup',
            require_user_confirmation: expected,
          }),
        ]);
      }
    );
  });

  describe('do directives', () => {
    const ACTIONS = `
    actions:
        lookup:
            description: "Look up"
            inputs:
                order_id: string
                    is_required: True
                note: string
            target: "flow://Lookup"
        refund:
            description: "Refund"
            target: "flow://Refund"`;
    const lookupTool = {
      type: 'action',
      target: 'lookup',
      name: 'lookup',
      llm_inputs: ['order_id'],
    };
    const refundTool = {
      type: 'action',
      target: 'refund',
      name: 'refund',
      llm_inputs: [],
    };

    function compileDo(steps: string) {
      const compiled = compileWorkflow(`${ACTIONS}\n    step a: ->\n${steps}`);
      return {
        ...compiled,
        directives: compiled.workflow?.steps[0]?.directives ?? [],
      };
    }

    it('compiles one line to a do directive with its action as a tool', () => {
      const { errors, directives } = compileDo(`
        | Call {!@actions.lookup} for {!@variables.order_id}.
`);
      expect(errors).toEqual([]);
      expect(directives).toEqual([
        {
          type: 'do',
          developer_name: 'flow_a_do_01',
          instructions: 'Call lookup for {{state.order_id}}.',
          tools: [lookupTool],
        },
      ]);
    });

    it('keeps the line breaks of continuation lines', () => {
      const { errors, directives } = compileDo(`
        | Call {!@actions.lookup}
          and say the result back.
`);
      expect(errors).toEqual([]);
      expect(directives[0]).toMatchObject({
        instructions: 'Call lookup\nand say the result back.',
      });
    });

    it('makes one directive for each | line', () => {
      const { errors, directives } = compileDo(`
        | Call {!@actions.lookup}
          and {!@actions.refund}.
        | Then call {!@actions.refund} and {!@actions.refund} again.
        say "Done"
        | Say goodbye.
`);
      expect(errors).toEqual([]);
      expect(directives).toEqual([
        {
          type: 'do',
          developer_name: 'flow_a_do_01',
          instructions: 'Call lookup\nand refund.',
          tools: [lookupTool, refundTool],
        },
        {
          type: 'do',
          developer_name: 'flow_a_do_02',
          instructions: 'Then call refund and refund again.',
          tools: [refundTool],
        },
        { type: 'say', developer_name: 'flow_a_say_03', text: 'Done' },
        {
          type: 'do',
          developer_name: 'flow_a_do_04',
          instructions: 'Say goodbye.',
        },
      ]);
    });

    it('makes separate directives inside and outside if and else bodies', () => {
      const { errors, directives } = compileDo(`
        | Before.
        if @variables.is_vip:
            | VIP {!@actions.refund}.
            | VIP again.
        else:
            | Regular.
        | After.
`);
      expect(errors).toEqual([]);
      expect(
        directives.map(d => [
          d.type === 'do' ? d.instructions : d.type,
          d.enabled,
        ])
      ).toEqual([
        ['Before.', undefined],
        ['action', undefined],
        ['VIP refund.', slotRef(1)],
        ['VIP again.', slotRef(1)],
        ['Regular.', notSlotRef(1)],
        ['After.', undefined],
      ]);
    });

    it('rejects an action that is not defined in the workflow', () => {
      const { codes, errors, directives } = compileDo(`
        | Call {!@actions.missing}.
        say "Done"
`);
      expect(codes).toEqual(['workflow-unknown-action']);
      expect(errors[0]).toContain("'{!@actions.missing}' in a '|' line");
      expect(directives.map(d => d.type)).toEqual(['say']);
    });

    it('rejects a top-level action', () => {
      const { codes, errors } = compileSource(`
config:
    developer_name: "WorkflowAgent"

actions:
    top_only:
        description: "Top-level only"
        target: "flow://top_only"

start_agent main:
    description: "Entry point"
    reasoning:
        instructions: ->
            | Route.
        actions:
            go_flow: @utils.transition to @workflow.flow

workflow flow:
    description: "Test workflow"
    step a: ->
        | Call {!@actions.top_only}.
`);
      expect(codes).toContain('workflow-unknown-action');
      expect(errors.join('\n')).toContain(
        "'{!@actions.top_only}' in a '|' line"
      );
    });

    it.each(['escalate', 'transition', 'end_session', 'setVariables'])(
      'rejects {!@utils.%s}',
      name => {
        const { result, directives } = compileDo(`
        | If the user is upset, call {!@utils.${name}}.
        say "Done"
`);
        expect(
          result.diagnostics
            .filter(d => d.severity === DiagnosticSeverity.Error)
            .map(d => [d.code, d.message])
        ).toEqual([
          [
            'workflow-do-unsupported-reference',
            expect.stringContaining(`'@utils.${name}'`),
          ],
        ]);
        expect(directives.map(d => d.type)).toEqual(['say']);
      }
    );

    it.each([
      '@outputs.found',
      '@inputs.order',
      '@subagent.support',
      '@workflow.flow',
      '@outputs.order.id',
    ])('rejects {!%s}', reference => {
      const { result, directives } = compileDo(`
        | Use {!${reference}}.
        say "Done"
`);
      expect(
        result.diagnostics
          .filter(d => d.severity === DiagnosticSeverity.Error)
          .map(d => [d.code, d.message])
      ).toEqual([
        [
          'workflow-do-unsupported-reference',
          expect.stringContaining(`'${reference}'`),
        ],
      ]);
      expect(directives.map(d => d.type)).toEqual(['say']);
    });

    it.each([
      ['@outputs.items[0]', '@outputs.items'],
      ['len(@outputs.items)', '@outputs.items'],
      ['@outputs.found if @variables.is_vip else "none"', '@outputs.found'],
      ['@utils.escalate if @variables.is_vip else ""', '@utils.escalate'],
    ])('rejects the reference inside {!%s}', (expression, reference) => {
      const { result, directives } = compileDo(`
        | Use {!${expression}}.
        say "Done"
`);
      expect(
        result.diagnostics
          .filter(d => d.severity === DiagnosticSeverity.Error)
          .map(d => [d.code, d.message])
      ).toEqual([
        [
          'workflow-do-unsupported-reference',
          expect.stringContaining(`'${reference}' is not supported`),
        ],
      ]);
      expect(directives.map(d => d.type)).toEqual(['say']);
    });

    it('rejects an action that is not the entire {! } expression', () => {
      const { result, directives } = compileDo(`
        | Use {!@actions.lookup if @variables.is_vip else ""}.
        say "Done"
`);
      expect(
        result.diagnostics
          .filter(d => d.severity === DiagnosticSeverity.Error)
          .map(d => [d.code, d.message])
      ).toEqual([
        [
          'workflow-do-unsupported-reference',
          "'@actions.lookup' must be the entire '{! }' expression.",
        ],
      ]);
      expect(directives.map(d => d.type)).toEqual(['say']);
    });

    it('accepts expressions over supported references', () => {
      const { errors, directives } = compileDo(`
        | Order {!@variables.order_id[0]}, {!len(@variables.order_id)}, {!"VIP" if @variables.is_vip else "regular"}.
`);
      expect(errors).toEqual([]);
      expect(directives[0]).toMatchObject({
        instructions:
          'Order {{state.order_id[0]}}, {{len(state.order_id)}}, {{"VIP" if state.is_vip else "regular"}}.',
      });
    });

    it('accepts system variables and knowledge', () => {
      const { errors, workflow } = compileWorkflow(
        `
    step a: ->
        | Reply to {!@system_variables.user_input} if {!@knowledge.citations_enabled}.
`,
        `${HEADER}
knowledge:
    citations_enabled: True
`
      );
      expect(errors).toEqual([]);
      expect(workflow?.steps[0].directives).toEqual([
        {
          type: 'do',
          developer_name: 'flow_a_do_01',
          instructions: 'Reply to {{system.input_text}} if {{True}}.',
        },
      ]);
    });

    it('keeps blank continuation lines between lines of text', () => {
      const { errors, directives } = compileDo(`
        | First.

          Second.
`);
      expect(errors).toEqual([]);
      expect(directives).toEqual([
        {
          type: 'do',
          developer_name: 'flow_a_do_01',
          instructions: 'First.\n\nSecond.',
        },
      ]);
    });

    it('rejects a line with no text', () => {
      const { codes, directives } = compileDo(`
        | First.
        |
        | Second.
`);
      expect(codes).toEqual(['workflow-empty-do']);
      expect(directives.map(d => d.type === 'do' && d.instructions)).toEqual([
        'First.',
        'Second.',
      ]);
    });

    it('does not use the tool names of a subagent compiled before it', () => {
      const { errors, workflow } = compileWorkflow(
        `
    actions:
        support:
            description: "Support"
            target: "flow://Support"
    step a: ->
        | Call {!@actions.support}.
`,
        `${HEADER}        actions:
            go_support: @utils.transition to @subagent.support
`
      );
      expect(errors).toEqual([]);
      expect(workflow?.steps[0].directives[0]).toMatchObject({
        instructions: 'Call support.',
        tools: [expect.objectContaining({ name: 'support' })],
      });
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

describe('workflow unknown action with lint and compile', () => {
  it('reports one diagnostic for a top-level action in run', () => {
    const source = `
config:
    developer_name: "WorkflowAgent"
    agent_type: "GoalBasedAgent"

actions:
    top_only:
        description: "Top-level only"
        target: "flow://top_only"

start_agent main:
    description: "Entry point"
    reasoning:
        instructions: ->
            | Route.
        actions:
            go_flow: @utils.transition to @workflow.flow

workflow flow:
    description: "Test workflow"
    step work: ->
        run @actions.top_only
`;
    const linted = parseAndLint(parse(source).rootNode, agentforceDialect);
    const compiled = compile(linted.ast as ParsedAgentforce);
    const diagnostics = dedupeDiagnostics([
      ...linted.diagnostics,
      ...compiled.diagnostics,
    ]).filter(
      d =>
        d.code === 'workflow-unknown-action' || d.code === 'undefined-reference'
    );

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'workflow-unknown-action',
        message: expect.stringContaining("'top_only'"),
      }),
    ]);
  });
});

describe('workflow global system instructions', () => {
  const withSystem = (instructions: string) =>
    `system:\n${instructions}\n${HEADER}`;
  const STATIC_HEADER = withSystem('    instructions: "You are helpful."');
  const SYSTEM = '{{state.AgentScriptInternal_system_instructions}}';

  const systemVariable = (
    result: ReturnType<typeof compileWorkflow>['result']
  ) =>
    result.output.agent_version.state_variables?.find(
      v => v.developer_name === 'AgentScriptInternal_system_instructions'
    );

  it('stores the system instructions in the state variable on entry', () => {
    const { errors, result, workflow } = compileWorkflow(
      `
    step greet: ->
        say "Hi"
`,
      STATIC_HEADER
    );
    expect(errors).toEqual([]);
    expect(workflow?.on_init).toEqual([
      {
        type: 'action',
        target: '__state_update_action__',
        state_updates: [
          {
            AgentScriptInternal_system_instructions:
              'template::You are helpful.',
          },
        ],
      },
    ]);
    expect(systemVariable(result)).toBeDefined();
  });

  it('labels the system instructions on say directives', () => {
    const { errors, workflow } = compileWorkflow(
      `
    step greet: ->
        say "Hello {!@variables.order_id}"
`,
      STATIC_HEADER
    );
    expect(errors).toEqual([]);
    expect(workflow?.steps[0].directives[0]).toMatchObject({
      type: 'say',
      text: `System Prompt:\n\n${SYSTEM}\n\nMessage for the system to follow:\n\nHello {{state.order_id}}`,
    });
  });

  it('prepends the system instructions to ask-for directives', () => {
    const { errors, workflow } = compileWorkflow(
      `
    step collect: ->
        ask for @variables.order_id
            instructions: "Ask for the order id."
`,
      STATIC_HEADER
    );
    expect(errors).toEqual([]);
    expect(workflow?.steps[0].directives[0]).toMatchObject({
      type: 'ask_for',
      instructions: `${SYSTEM}\n\nAsk for the order id.`,
    });
  });

  it('prepends the system instructions to do directives', () => {
    const { errors, workflow } = compileWorkflow(
      `
    step a: ->
        | Greet the customer.
`,
      STATIC_HEADER
    );
    expect(errors).toEqual([]);
    expect(workflow?.steps[0].directives[0]).toMatchObject({
      type: 'do',
      instructions: `${SYSTEM}\n\nGreet the customer.`,
    });
  });

  it('compiles variable references in the system instructions', () => {
    const { errors, workflow } = compileWorkflow(
      `
    step collect: ->
        ask for @variables.order_id
            instructions: "Ask."
`,
      withSystem(`    instructions: ->
        | VIP: {!@variables.is_vip}.`)
    );
    expect(errors).toEqual([]);
    expect(workflow?.on_init?.[0]).toMatchObject({
      state_updates: [
        {
          AgentScriptInternal_system_instructions:
            'template::VIP: {{state.is_vip}}.',
        },
      ],
    });
  });

  it('leaves the workflow unchanged without system instructions', () => {
    const { result, workflow } = compileWorkflow(`
    step a: ->
        say "Hi"
        ask for @variables.order_id
            instructions: "Ask."
`);
    expect(workflow?.on_init).toBeUndefined();
    expect(systemVariable(result)).toBeUndefined();
    expect(workflow?.steps[0].directives).toMatchObject([
      { type: 'say', text: 'Hi' },
      { type: 'ask_for', instructions: 'Ask.' },
    ]);
  });

  it('does not change non-LLM directives', () => {
    const { errors, workflow } = compileWorkflow(
      `
    step a: ->
        set @variables.order_id = "x"
        transition to @subagent.support
`,
      STATIC_HEADER
    );
    expect(errors).toEqual([]);
    expect(workflow?.steps[0].directives).toEqual([
      {
        type: 'action',
        target: '__state_update_action__',
        state_updates: [{ order_id: '"x"' }],
        chat_history_behavior: { add_to_chat_history: false },
        developer_name: 'flow_a_action_01',
      },
      {
        type: 'handoff',
        target: 'support',
        developer_name: 'flow_a_handoff_02',
      },
    ]);
  });

  it('builds conditional system instructions on entry', () => {
    const { errors, result, workflow } = compileWorkflow(
      `
    step a: ->
        say "Hi"
`,
      withSystem(`    instructions: ->
        | You are helpful.
        if @variables.is_vip:
            | Treat the customer as a VIP.
        else:
            | Be polite.`)
    );
    expect(errors).toEqual([]);
    expect(workflow?.on_init).toEqual([
      {
        type: 'action',
        target: '__state_update_action__',
        enabled: 'True',
        state_updates: [
          {
            AgentScriptInternal_system_instructions:
              'template::\nYou are helpful.',
          },
        ],
      },
      {
        type: 'action',
        target: '__state_update_action__',
        enabled: 'True',
        state_updates: [{ AgentScriptInternal_condition_1: 'state.is_vip' }],
      },
      {
        type: 'action',
        target: '__state_update_action__',
        enabled: 'state.AgentScriptInternal_condition_1',
        state_updates: [
          {
            AgentScriptInternal_system_instructions:
              'template::{{state.AgentScriptInternal_system_instructions}}\nTreat the customer as a VIP.',
          },
        ],
      },
      {
        type: 'action',
        target: '__state_update_action__',
        enabled: 'not (state.AgentScriptInternal_condition_1)',
        state_updates: [
          {
            AgentScriptInternal_system_instructions:
              'template::{{state.AgentScriptInternal_system_instructions}}\nBe polite.',
          },
        ],
      },
    ]);
    expect(workflow?.steps[0].directives[0]).toMatchObject({
      type: 'say',
      text: `System Prompt:\n\n${SYSTEM}\n\nMessage for the system to follow:\n\nHi`,
    });
    const declared = result.output.agent_version.state_variables?.map(
      v => v.developer_name
    );
    expect(declared).toContain('AgentScriptInternal_system_instructions');
    expect(declared).toContain('AgentScriptInternal_condition_1');
  });
});
