/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Conditional statement compilation tests — ported from Python:
 * - test_conditionals.py
 *
 * Tests if/else compilation with runtime condition capture,
 * template concatenation, sequential if reuse, nested if detection,
 * transitions in conditionals, and action calls in conditionals.
 *
 * Uses .agent source syntax with parseSource -> compile -> assert pattern.
 */
import { describe, it, expect } from 'vitest';
import { compile, type CompileOptions } from '../src/compile.js';
import { parseSource, findNode } from './test-utils.js';
import {
  STATE_UPDATE_ACTION,
  RUNTIME_CONDITION_VARIABLE,
  NEXT_TOPIC_VARIABLE,
  EMPTY_TOPIC_VALUE,
  AGENT_INSTRUCTIONS_VARIABLE,
} from '../src/constants.js';

/** Slot 1 — used by plain `if`/`else` and chain heads. */
const CONDITION_SLOT_1 = `${RUNTIME_CONDITION_VARIABLE}_1`;
import {
  isHandOffAction,
  type Action,
  type HandOffAction,
  type SubAgentNode,
} from '../src/types.js';

/**
 * Helper: extract the before_reasoning_iteration actions from a compiled node.
 */
function getBriActions(
  source: string,
  nodeName: string,
  options?: CompileOptions
): (Action | HandOffAction)[] {
  const { output } = compile(parseSource(source), options);
  const node = findNode(output, nodeName, 'subagent');
  return (node.before_reasoning_iteration ?? []) as (Action | HandOffAction)[];
}

/**
 * Helper: extract after_reasoning actions from a compiled node.
 */
function getAfterReasoningActions(
  source: string,
  nodeName: string
): (Action | HandOffAction)[] {
  const { output } = compile(parseSource(source));
  const node = output.agent_version.nodes.find(
    n => n.developer_name === nodeName
  )! as SubAgentNode;
  expect(node).toBeDefined();
  return (node.after_reasoning ?? []) as (Action | HandOffAction)[];
}

// ---------------------------------------------------------------------------
// Python: TestBasicConditionals.test_simple_if_else_with_variable_assignment
// ---------------------------------------------------------------------------

describe('simple if-else with variable assignment in reasoning', () => {
  it('should compile if-else with set to condition capture + gated state updates', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    x: mutable boolean = True
    y: mutable boolean = False

start_agent main:
    description: "Test"
    reasoning:
        instructions: ->
            if @variables.x:
                set @variables.x = False
            else:
                set @variables.y = True
            | Do something
`;
    const bri = getBriActions(source, 'main');

    // Should have: reset + condition capture + then-set + else-set + template
    expect(bri.length).toBeGreaterThanOrEqual(4);

    // Find the condition capture action (sets condition_1, the slot used by
    // plain if/else and shared with sequential plain ifs).
    const condCapture = bri.find((a: Record<string, unknown>) => {
      const updates = a.state_updates as Array<Record<string, string>>;
      return updates?.some(u => CONDITION_SLOT_1 in u);
    }) as Action;
    expect(condCapture).toBeDefined();
    expect(condCapture.target).toBe(STATE_UPDATE_ACTION);
    const condUpdate = condCapture.state_updates!.find(
      u => CONDITION_SLOT_1 in u
    ) as Record<string, string>;
    expect(condUpdate[CONDITION_SLOT_1]).toContain('x');

    // Then block: sets x = False, should be gated on condition being positive
    const thenAction = bri.find((a: Record<string, unknown>) => {
      const updates = a.state_updates as Array<Record<string, string>>;
      return updates?.some(u => 'x' in u && u['x'] === 'False');
    }) as Action;
    expect(thenAction).toBeDefined();
    expect(thenAction.enabled).toBeDefined();
    expect(thenAction.enabled).toContain(`state.${CONDITION_SLOT_1}`);
    // Should NOT contain 'not' — this is the positive branch
    expect(thenAction.enabled).not.toContain('not');

    // Else block: sets y = True, should be gated on condition being negative
    const elseAction = bri.find((a: Record<string, unknown>) => {
      const updates = a.state_updates as Array<Record<string, string>>;
      return updates?.some(u => 'y' in u && u['y'] === 'True');
    }) as Action;
    expect(elseAction).toBeDefined();
    expect(elseAction.enabled).toBeDefined();
    expect(elseAction.enabled).toContain(`not (state.${CONDITION_SLOT_1})`);
  });
});

// ---------------------------------------------------------------------------
// Python: TestBasicConditionals.test_if_statement_without_else
// ---------------------------------------------------------------------------

describe('if statement without else', () => {
  it('should compile if-only to condition capture + then block (no else actions)', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    is_admin: mutable boolean = False
    access: mutable string = "denied"

start_agent main:
    description: "Test"
    reasoning:
        instructions: ->
            if @variables.is_admin:
                set @variables.access = "granted"
            | Continue
`;
    const bri = getBriActions(source, 'main');

    // Should have: reset + condition capture + then-set + template
    expect(bri.length).toBeGreaterThanOrEqual(3);

    // Find the condition capture
    const condCapture = bri.find((a: Record<string, unknown>) => {
      const updates = a.state_updates as Array<Record<string, string>>;
      return updates?.some(u => CONDITION_SLOT_1 in u);
    }) as Action;
    expect(condCapture).toBeDefined();
    const condUpdate = condCapture.state_updates!.find(
      u => CONDITION_SLOT_1 in u
    ) as Record<string, string>;
    expect(condUpdate[CONDITION_SLOT_1]).toContain('is_admin');

    // Then block: set access = "granted"
    const thenAction = bri.find((a: Record<string, unknown>) => {
      const updates = a.state_updates as Array<Record<string, string>>;
      return updates?.some(u => 'access' in u);
    }) as Action;
    expect(thenAction).toBeDefined();
    expect(thenAction.enabled).toContain(`state.${CONDITION_SLOT_1}`);

    // No else actions — there should be no action with 'not' condition
    const elseActions = bri.filter((a: Record<string, unknown>) => {
      const enabled = a.enabled as string | undefined;
      return enabled?.includes(`not (state.${CONDITION_SLOT_1})`) ?? false;
    });
    expect(elseActions.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Python: TestBasicConditionals.test_if_else_with_template_concatenation
// ---------------------------------------------------------------------------

describe('if-else with template concatenation', () => {
  it('should compile template appends with condition guards', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    show_greeting: mutable boolean = True

start_agent main:
    description: "Test"
    reasoning:
        instructions: ->
            if @variables.show_greeting:
                | Hello there!
            else:
                | Goodbye!
`;
    const bri = getBriActions(source, 'main');

    // Should have: reset + condition capture + then template + else template
    expect(bri.length).toBeGreaterThanOrEqual(3);

    // Then block template append: "Hello there!" with positive condition
    const thenTemplate = bri.find((a: Record<string, unknown>) => {
      const updates = a.state_updates as Array<Record<string, string>>;
      return updates?.some(
        u =>
          AGENT_INSTRUCTIONS_VARIABLE in u &&
          u[AGENT_INSTRUCTIONS_VARIABLE].includes('Hello there!')
      );
    }) as Action;
    expect(thenTemplate).toBeDefined();
    expect(thenTemplate.enabled).toContain(`state.${CONDITION_SLOT_1}`);
    expect(thenTemplate.enabled).not.toContain('not');

    // Else block template append: "Goodbye!" with negative condition
    const elseTemplate = bri.find((a: Record<string, unknown>) => {
      const updates = a.state_updates as Array<Record<string, string>>;
      return updates?.some(
        u =>
          AGENT_INSTRUCTIONS_VARIABLE in u &&
          u[AGENT_INSTRUCTIONS_VARIABLE].includes('Goodbye!')
      );
    }) as Action;
    expect(elseTemplate).toBeDefined();
    expect(elseTemplate.enabled).toContain(`not (state.${CONDITION_SLOT_1})`);
  });
});

// ---------------------------------------------------------------------------
// Python: TestSequentialConditionals.test_multiple_sequential_if_statements
// ---------------------------------------------------------------------------

describe('multiple sequential if statements reuse condition_1 slot', () => {
  it('should emit two condition captures each writing condition_1', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    check1: mutable boolean = False
    check2: mutable boolean = False
    result1: mutable boolean = False
    result2: mutable boolean = False

start_agent main:
    description: "Test"
    reasoning:
        instructions: ->
            if @variables.check1:
                set @variables.result1 = True
            if @variables.check2:
                set @variables.result2 = True
            | Done
`;
    const bri = getBriActions(source, 'main');

    // Find all condition capture actions
    const condCaptures = bri.filter((a: Record<string, unknown>) => {
      const updates = a.state_updates as Array<Record<string, string>>;
      return updates?.some(u => CONDITION_SLOT_1 in u);
    }) as Action[];

    // Two sequential plain ifs should produce two condition captures, both
    // writing to the SAME slot (condition_1). Reuse is safe because each
    // plain if writes its slot before its body executes — no later read
    // crosses the boundary.
    expect(condCaptures.length).toBe(2);

    const firstCondValue = (
      condCaptures[0].state_updates!.find(u => CONDITION_SLOT_1 in u) as Record<
        string,
        string
      >
    )[CONDITION_SLOT_1];
    const secondCondValue = (
      condCaptures[1].state_updates!.find(u => CONDITION_SLOT_1 in u) as Record<
        string,
        string
      >
    )[CONDITION_SLOT_1];

    expect(firstCondValue).toContain('check1');
    expect(secondCondValue).toContain('check2');

    // First if then block
    const result1Set = bri.find((a: Record<string, unknown>) => {
      const updates = a.state_updates as Array<Record<string, string>>;
      return updates?.some(u => 'result1' in u);
    }) as Action;
    expect(result1Set).toBeDefined();
    expect(result1Set.enabled).toContain(`state.${CONDITION_SLOT_1}`);

    // Second if then block
    const result2Set = bri.find((a: Record<string, unknown>) => {
      const updates = a.state_updates as Array<Record<string, string>>;
      return updates?.some(u => 'result2' in u);
    }) as Action;
    expect(result2Set).toBeDefined();
    expect(result2Set.enabled).toContain(`state.${CONDITION_SLOT_1}`);
  });
});

// ---------------------------------------------------------------------------
// Python: TestNestedConditionals.test_nested_if_statements_error
// ---------------------------------------------------------------------------

describe('nested if/else', () => {
  it('should compile the nested if/else into its own slot without a warning', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    outer: mutable boolean = True
    inner: mutable boolean = True
    inner_var: mutable boolean = False

start_agent main:
    description: "Test"
    reasoning:
        instructions: ->
            if @variables.outer:
                if @variables.inner:
                    set @variables.inner_var = True
                else:
                    | skip
            | Done
`;
    const { output, diagnostics } = compile(parseSource(source));
    expect(output.agent_version.nodes.length).toBe(1);

    const nestedWarning = diagnostics.find(
      d =>
        d.message.toLowerCase().includes('nested') &&
        d.message.toLowerCase().includes('if')
    );
    expect(nestedWarning).toBeUndefined();

    // The inner else reads slot 2, so the outer slot 1 is never clobbered.
    const bri = getBriActions(source, 'main') as Action[];
    const slot1Writes = bri.filter(a =>
      a.state_updates?.some(u => CONDITION_SLOT_1 in u)
    );
    expect(slot1Writes).toHaveLength(1);
    const innerElse = bri.find(
      a =>
        typeof a.enabled === 'string' &&
        a.enabled.includes(`not (state.${RUNTIME_CONDITION_VARIABLE}_2)`)
    );
    expect(innerElse?.enabled).toContain(`state.${CONDITION_SLOT_1}`);
  });
});

// ---------------------------------------------------------------------------
// `else if` chain links — supported syntax, must NOT trigger nested-if warning
// ---------------------------------------------------------------------------

function findNestedIfWarning(diagnostics: { message: string }[]) {
  return diagnostics.find(
    d =>
      d.message.toLowerCase().includes('nested') &&
      d.message.toLowerCase().includes('if')
  );
}

describe('else if chain links', () => {
  it('should compile a single else if to per-link suffixed condition slots', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    x: mutable string = "a"
    seen_a: mutable boolean = False
    seen_b: mutable boolean = False

start_agent main:
    description: "Test"
    reasoning:
        instructions: ->
            if @variables.x == "a":
                set @variables.seen_a = True
            else if @variables.x == "b":
                set @variables.seen_b = True
            | Done
`;
    const { output, diagnostics } = compile(parseSource(source));

    expect(output.agent_version.nodes.length).toBe(1);
    expect(findNestedIfWarning(diagnostics)).toBeUndefined();

    const bri = getBriActions(source, 'main');

    // Two condition-write actions, one per chain link, into condition_1
    // and condition_2 slots (per-node counter starts at 1).
    const slot1Write = bri.find((a: Record<string, unknown>) => {
      const updates = a.state_updates as Array<Record<string, string>>;
      return updates?.some(u => `${RUNTIME_CONDITION_VARIABLE}_1` in u);
    }) as Action;
    expect(slot1Write).toBeDefined();
    const slot1Cond = (
      slot1Write.state_updates!.find(
        u => `${RUNTIME_CONDITION_VARIABLE}_1` in u
      ) as Record<string, string>
    )[`${RUNTIME_CONDITION_VARIABLE}_1`];
    expect(slot1Cond).toContain('state.x == "a"');

    const slot2Write = bri.find((a: Record<string, unknown>) => {
      const updates = a.state_updates as Array<Record<string, string>>;
      return updates?.some(u => `${RUNTIME_CONDITION_VARIABLE}_2` in u);
    }) as Action;
    expect(slot2Write).toBeDefined();
    const slot2Cond = (
      slot2Write.state_updates!.find(
        u => `${RUNTIME_CONDITION_VARIABLE}_2` in u
      ) as Record<string, string>
    )[`${RUNTIME_CONDITION_VARIABLE}_2`];
    expect(slot2Cond).toContain('state.x == "b"');

    // Branch-a body: gated on slot 1 positive.
    const branchA = bri.find((a: Record<string, unknown>) => {
      const updates = a.state_updates as Array<Record<string, string>>;
      return updates?.some(u => 'seen_a' in u && u['seen_a'] === 'True');
    }) as Action;
    expect(branchA).toBeDefined();
    expect(branchA.enabled).toContain(`state.${RUNTIME_CONDITION_VARIABLE}_1`);
    expect(branchA.enabled).not.toContain('not');

    // Branch-b body: gated on slot 1 negated AND slot 2 positive. The shared
    // (unsuffixed) runtime variable is NOT used by else-if conditions.
    const branchB = bri.find((a: Record<string, unknown>) => {
      const updates = a.state_updates as Array<Record<string, string>>;
      return updates?.some(u => 'seen_b' in u && u['seen_b'] === 'True');
    }) as Action;
    expect(branchB).toBeDefined();
    expect(branchB.enabled).toContain(
      `not (state.${RUNTIME_CONDITION_VARIABLE}_1)`
    );
    expect(branchB.enabled).toContain(`state.${RUNTIME_CONDITION_VARIABLE}_2`);
  });

  it('should compile a multi-link if/else if/else if/else chain', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    x: mutable string = "a"
    branch: mutable string = ""

start_agent main:
    description: "Test"
    reasoning:
        instructions: ->
            if @variables.x == "a":
                set @variables.branch = "a"
            else if @variables.x == "b":
                set @variables.branch = "b"
            else if @variables.x == "c":
                set @variables.branch = "c"
            else:
                set @variables.branch = "other"
            | Done
`;
    const { output, diagnostics } = compile(parseSource(source));

    expect(output.agent_version.nodes.length).toBe(1);
    expect(findNestedIfWarning(diagnostics)).toBeUndefined();

    const bri = getBriActions(source, 'main');
    const branchActions = bri.filter((a: Record<string, unknown>) => {
      const updates = a.state_updates as Array<Record<string, string>>;
      return updates?.some(u => 'branch' in u);
    }) as Action[];
    expect(branchActions).toHaveLength(4);

    // The trailing `else:` body negates every prior chain slot.
    const elseAction = branchActions.find(a =>
      (a.state_updates ?? []).some(
        u => 'branch' in u && u['branch'] === '"other"'
      )
    ) as Action;
    expect(elseAction).toBeDefined();
    expect(elseAction.enabled).toContain(
      `not (state.${RUNTIME_CONDITION_VARIABLE}_1)`
    );
    expect(elseAction.enabled).toContain(
      `not (state.${RUNTIME_CONDITION_VARIABLE}_2)`
    );
    expect(elseAction.enabled).toContain(
      `not (state.${RUNTIME_CONDITION_VARIABLE}_3)`
    );

    // The agent declares condition_1, _2, _3 in state_variables, declared on
    // demand based on the deepest chain encountered.
    const stateVarNames = (output.agent_version.state_variables ?? []).map(
      v => v.developer_name
    );
    expect(stateVarNames).toContain(`${RUNTIME_CONDITION_VARIABLE}_1`);
    expect(stateVarNames).toContain(`${RUNTIME_CONDITION_VARIABLE}_2`);
    expect(stateVarNames).toContain(`${RUNTIME_CONDITION_VARIABLE}_3`);
  });

  it('should compile a real `if` nested inside an else: branch as a nested if', () => {
    // Regression guard: only CST else_if_clause links form a chain, not any
    // IfStatement that happens to live in another IfStatement's orelse. The
    // nested if gets its own slot, gated under the outer else.
    const source = `
config:
    agent_name: "TestBot"

variables:
    outer: mutable boolean = True
    inner: mutable boolean = True
    flag: mutable boolean = False

start_agent main:
    description: "Test"
    reasoning:
        instructions: ->
            if @variables.outer:
                | outer branch
            else:
                if @variables.inner:
                    set @variables.flag = True
                else:
                    | inner else
            | Done
`;
    const { diagnostics } = compile(parseSource(source));
    expect(findNestedIfWarning(diagnostics)).toBeUndefined();

    const bri = getBriActions(source, 'main') as Action[];
    const innerWrite = bri.find(a =>
      a.state_updates?.some(u => `${RUNTIME_CONDITION_VARIABLE}_2` in u)
    );
    expect(innerWrite?.state_updates).toEqual([
      { [`${RUNTIME_CONDITION_VARIABLE}_2`]: 'state.inner' },
    ]);
    const setFlag = bri.find(a => a.state_updates?.some(u => 'flag' in u));
    expect(setFlag?.enabled).toContain(`not (state.${CONDITION_SLOT_1})`);
    expect(setFlag?.enabled).toContain(`state.${RUNTIME_CONDITION_VARIABLE}_2`);
  });
});

// ---------------------------------------------------------------------------
// Python: TestConditionalWithTransitions.test_if_else_with_transitions
// ---------------------------------------------------------------------------

describe('if-else with transitions', () => {
  it('should compile conditional transitions to gated state updates + handoffs', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    authenticated: mutable boolean = False

start_agent main:
    description: "Test"
    after_reasoning:
        if @variables.authenticated:
            transition to @topic.dashboard
        else:
            transition to @topic.login

topic dashboard:
    description: "Dashboard"
    reasoning:
        instructions: ->
            | Dashboard

topic login:
    description: "Login"
    reasoning:
        instructions: ->
            | Login
`;
    const afterReasoning = getAfterReasoningActions(source, 'main');

    // Should have: reset_next_topic + condition capture + then(state_update + handoff) + else(state_update + handoff)
    expect(afterReasoning.length).toBeGreaterThanOrEqual(5);

    // Condition capture
    const condCapture = afterReasoning.find((a: Record<string, unknown>) => {
      const updates = a.state_updates as Array<Record<string, string>>;
      return updates?.some(u => CONDITION_SLOT_1 in u);
    }) as Action;
    expect(condCapture).toBeDefined();
    const condValue = (
      condCapture.state_updates!.find(u => CONDITION_SLOT_1 in u) as Record<
        string,
        string
      >
    )[CONDITION_SLOT_1];
    expect(condValue).toContain('authenticated');

    // Then block: state update setting next_topic = "dashboard"
    const thenStateUpdate = afterReasoning.find(
      (a: Record<string, unknown>) => {
        const updates = a.state_updates as Array<Record<string, string>>;
        const hasNextTopic = updates?.some(
          u =>
            NEXT_TOPIC_VARIABLE in u && u[NEXT_TOPIC_VARIABLE] === '"dashboard"'
        );
        return hasNextTopic && a.target === STATE_UPDATE_ACTION;
      }
    ) as Action;
    expect(thenStateUpdate).toBeDefined();
    expect(thenStateUpdate.enabled).toContain(`state.${CONDITION_SLOT_1}`);
    expect(thenStateUpdate.enabled).not.toContain('not');

    // Then block: handoff to dashboard
    const thenHandoff = afterReasoning
      .filter(isHandOffAction)
      .find(h => h.target === 'dashboard');
    expect(thenHandoff).toBeDefined();
    expect(thenHandoff?.enabled).toBe(
      `state.${NEXT_TOPIC_VARIABLE}=="dashboard"`
    );
    expect(thenHandoff?.state_updates).toEqual([
      { [NEXT_TOPIC_VARIABLE]: EMPTY_TOPIC_VALUE },
    ]);

    // Else block: state update setting next_topic = "login"
    const elseStateUpdate = afterReasoning.find(
      (a: Record<string, unknown>) => {
        const updates = a.state_updates as Array<Record<string, string>>;
        const hasNextTopic = updates?.some(
          u => NEXT_TOPIC_VARIABLE in u && u[NEXT_TOPIC_VARIABLE] === '"login"'
        );
        return hasNextTopic && a.target === STATE_UPDATE_ACTION;
      }
    ) as Action;
    expect(elseStateUpdate).toBeDefined();
    expect(elseStateUpdate.enabled).toContain(
      `not (state.${CONDITION_SLOT_1})`
    );

    // Else block: handoff to login
    const elseHandoff = afterReasoning
      .filter(isHandOffAction)
      .find(h => h.target === 'login');
    expect(elseHandoff).toBeDefined();
    expect(elseHandoff?.enabled).toBe(`state.${NEXT_TOPIC_VARIABLE}=="login"`);
  });
});

// ---------------------------------------------------------------------------
// Python: TestConditionalWithActionCalls.test_if_else_with_action_calls
// ---------------------------------------------------------------------------

describe('if-else with action calls', () => {
  it('should compile conditional action calls with condition guards', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    should_notify: mutable boolean = True

start_agent main:
    description: "Test"
    actions:
        send_notification:
            description: "Send notification"
            target: "flow://send_notification"
            inputs:
                message: string
        log_event:
            description: "Log event"
            target: "flow://log_event"
            inputs:
                event: string
    after_reasoning:
        if @variables.should_notify:
            run @actions.send_notification
                with message="User notified"
        else:
            run @actions.log_event
                with event="Notification skipped"
    reasoning:
        instructions: ->
            | Handle notifications
`;
    const afterReasoning = getAfterReasoningActions(source, 'main');

    // Should have: reset_next_topic + condition capture + then-action + else-action
    expect(afterReasoning.length).toBeGreaterThanOrEqual(4);

    // Condition capture
    const condCapture = afterReasoning.find((a: Record<string, unknown>) => {
      const updates = a.state_updates as Array<Record<string, string>>;
      return updates?.some(u => CONDITION_SLOT_1 in u);
    }) as Action;
    expect(condCapture).toBeDefined();

    // Then block: run send_notification with positive condition
    const thenAction = afterReasoning.find(
      (a: Record<string, unknown>) => a.target === 'send_notification'
    ) as Action;
    expect(thenAction).toBeDefined();
    expect(thenAction.enabled).toContain(`state.${CONDITION_SLOT_1}`);
    expect(thenAction.enabled).not.toContain('not');
    expect(thenAction.bound_inputs).toEqual({ message: '"User notified"' });

    // Else block: run log_event with negative condition
    const elseAction = afterReasoning.find(
      (a: Record<string, unknown>) => a.target === 'log_event'
    ) as Action;
    expect(elseAction).toBeDefined();
    expect(elseAction.enabled).toContain(`not (state.${CONDITION_SLOT_1})`);
    expect(elseAction.bound_inputs).toEqual({
      event: '"Notification skipped"',
    });
  });
});

// ---------------------------------------------------------------------------

describe('single-read if inlines its condition into the gate (inlineConditionSlots)', () => {
  const GATE_ON: CompileOptions = { inlineConditionSlots: true };

  const HEAD = `
config:
    agent_name: "TestBot"

variables:
    loadedTools: mutable boolean = False
    allowTestDrives: mutable boolean = True
    Tools: mutable string = ""
    count: mutable number = 1
    x: mutable number = 1
    y: mutable boolean = False

subagent other:
    description: "Other"
    reasoning:
        instructions: ->
            | Other
`;

  function compileMain(
    body: string,
    block: 'before_reasoning' | 'after_reasoning' = 'before_reasoning',
    options?: CompileOptions
  ) {
    const { output } = compile(
      parseSource(`${HEAD}
start_agent main:
    description: "Test"
    ${block}:
${body}
    reasoning:
        instructions: ->
            | Main
`),
      { ...GATE_ON, ...options }
    );
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'main'
    )! as SubAgentNode;
    const actions = (node[block] ?? []) as (Action | HandOffAction)[];
    const slotDeclared = (output.agent_version.state_variables ?? []).some(
      v => v.developer_name === CONDITION_SLOT_1
    );
    return { actions, slotDeclared };
  }

  const writesSlot = (actions: (Action | HandOffAction)[]) =>
    actions.some(a =>
      (a as Action).state_updates?.some(u => CONDITION_SLOT_1 in u)
    );

  it('gates a lone set on the condition and declares no slot', () => {
    const { actions, slotDeclared } = compileMain(`
        if not @variables.loadedTools and @variables.allowTestDrives:
            set @variables.Tools = @variables.Tools + ", Scheduling a test drive"`);

    expect(writesSlot(actions)).toBe(false);
    expect(slotDeclared).toBe(false);
    const set = actions.find(a =>
      (a as Action).state_updates?.some(u => 'Tools' in u)
    )!;
    expect(set.enabled).toContain('state.loadedTools');
    expect(set.enabled).toContain('state.allowTestDrives');
    expect(set.enabled).not.toContain(CONDITION_SLOT_1);
  });

  it('gates a single-target transition on the condition; the handoff still gates on next_topic', () => {
    const { actions, slotDeclared } = compileMain(`
        if @variables.y:
            transition to @subagent.other`);

    expect(writesSlot(actions)).toBe(false);
    expect(slotDeclared).toBe(false);
    const setNext = actions.find(a =>
      (a as Action).state_updates?.some(
        u => u[NEXT_TOPIC_VARIABLE] === '"other"'
      )
    )!;
    expect(setNext.enabled).toContain('state.y');
    const handoff = actions.find(a => a.type === 'handoff')!;
    expect(handoff.enabled).toBe(`state.${NEXT_TOPIC_VARIABLE}=="other"`);
  });

  it('merges adjacent same-condition instruction appends once the slot writes are gone', () => {
    const bri = getBriActions(
      `${HEAD}
start_agent main:
    description: "Test"
    reasoning:
        instructions: ->
            if @variables.y:
                | first
            if @variables.y:
                | second
`,
      'main',
      GATE_ON
    );
    const appends = bri.filter(a => a.enabled === 'state.y');
    expect(appends).toHaveLength(1);
    expect(
      (appends[0] as Action).state_updates![0][AGENT_INSTRUCTIONS_VARIABLE]
    ).toContain('first\nsecond');
  });

  it('keeps the slot when a later body statement would re-read a condition an earlier one mutates', () => {
    // Inlined, `| still runs` would gate on `count > 0` AFTER count dropped to 0.
    const bri = getBriActions(
      `${HEAD}
start_agent main:
    description: "Test"
    reasoning:
        instructions: ->
            if @variables.count > 0:
                set @variables.count = @variables.count - 1
                | still runs
`,
      'main',
      GATE_ON
    );
    expect(writesSlot(bri)).toBe(true);
    const append = bri.find(a =>
      (a as Action).state_updates?.some(u => {
        const value = u[AGENT_INSTRUCTIONS_VARIABLE];
        return typeof value === 'string' && value.includes('still runs');
      })
    )!;
    expect(append.enabled).toBe(`state.${CONDITION_SLOT_1}`);
  });

  it('keeps the slot for if/else (the else gate is a second read)', () => {
    const { actions, slotDeclared } = compileMain(`
        if @variables.x == 1:
            set @variables.x = 2
        else:
            set @variables.y = True`);
    expect(writesSlot(actions)).toBe(true);
    expect(slotDeclared).toBe(true);
  });

  it('inlines the last else-if link but keeps the head slot its negation reads', () => {
    const { actions, slotDeclared } = compileMain(`
        if @variables.x == 1:
            set @variables.x = 2
        else if @variables.x == 2:
            set @variables.y = True`);
    // The head slot is read twice (its body, and the second link's negation),
    // so it stays — and that negation keeps the branches exclusive even though
    // the first body sets x = 2.
    expect(writesSlot(actions)).toBe(true);
    expect(slotDeclared).toBe(true);
    expect(
      actions.some(a =>
        (a as Action).state_updates?.some(
          u => `${RUNTIME_CONDITION_VARIABLE}_2` in u
        )
      )
    ).toBe(false);
    const second = actions.find(a =>
      (a as Action).state_updates?.some(u => u['y'] === 'True')
    )!;
    expect(second.enabled).toContain(`not (state.${CONDITION_SLOT_1})`);
    expect(second.enabled).toContain('state.x == 2');
  });

  it('inlines a nested single-read if but keeps the outer slot', () => {
    const { actions, slotDeclared } = compileMain(`
        if @variables.y:
            if @variables.x == 1:
                set @variables.count = 0`);
    // The outer slot is read by both the inner write's gate and the set's.
    expect(writesSlot(actions)).toBe(true);
    expect(slotDeclared).toBe(true);
    const set = actions.find(a =>
      (a as Action).state_updates?.some(u => 'count' in u)
    )!;
    // With the inner write gone, the remaining slot read is the outer condition.
    expect(set.enabled).toContain(`state.${CONDITION_SLOT_1}`);
    expect(set.enabled).toContain('state.x == 1');
  });

  it('inlines a nested if; the sibling after it still gates on the outer slot', () => {
    // The nested if has its own slot, read only by `set count`, so it inlines.
    // The outer slot is read by both, so it stays.
    const { actions } = compileMain(`
        if @variables.y:
            if @variables.x == 1:
                set @variables.count = 0
            set @variables.loadedTools = True`);
    const slotWrites = actions.filter(a =>
      (a as Action).state_updates?.some(u =>
        Object.keys(u).some(k => k.startsWith(RUNTIME_CONDITION_VARIABLE))
      )
    ) as Action[];
    expect(slotWrites.map(a => a.state_updates)).toEqual([
      [{ [CONDITION_SLOT_1]: 'state.y' }],
    ]);
    const setCount = actions.find(a =>
      (a as Action).state_updates?.some(u => 'count' in u)
    )!;
    expect(setCount.enabled).toContain(`state.${CONDITION_SLOT_1}`);
    expect(setCount.enabled).toContain('state.x == 1');
    const setLoaded = actions.find(a =>
      (a as Action).state_updates?.some(u => 'loadedTools' in u)
    )!;
    expect(setLoaded.enabled).toContain(`state.${CONDITION_SLOT_1}`);
    expect(setLoaded.enabled).not.toContain('state.x');
  });

  it('gates a run on the condition even when its set writes a variable the condition reads', () => {
    const { output } = compile(
      parseSource(`${HEAD}
start_agent main:
    description: "Test"
    actions:
        validate:
            description: "Validate"
            inputs:
                ref: string
            outputs:
                is_valid: boolean
            target: "flow://Validate"
    before_reasoning:
        if @variables.y == False:
            run @actions.validate
                with ref=@variables.Tools
                set @variables.y = @outputs.is_valid
    reasoning:
        instructions: ->
            | Main
`),
      GATE_ON
    );
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'main'
    )! as SubAgentNode;
    const actions = (node.before_reasoning ?? []) as (Action | HandOffAction)[];
    expect(writesSlot(actions)).toBe(false);
    // The run is one envelope: its gate reads `y` once, before its own
    // output-driven `set` writes `y`.
    const run = actions.find(a => a.target === 'validate')! as Action;
    expect(run.enabled).toContain('state.y == False');
    expect(run.enabled).not.toContain(CONDITION_SLOT_1);
    expect(JSON.stringify(run.state_updates)).toContain('is_valid');
  });

  it('gates an escalate on the condition; the handoff still gates on next_topic', () => {
    const { actions, slotDeclared } = compileMain(`
        if @variables.y:
            escalate`);
    expect(writesSlot(actions)).toBe(false);
    expect(slotDeclared).toBe(false);
    const handoff = actions.find(a => a.type === 'handoff')!;
    const setNext = actions[actions.indexOf(handoff) - 1];
    expect(setNext.enabled).toContain('state.y');
    expect(handoff.enabled).toBe(
      `state.${NEXT_TOPIC_VARIABLE} == ${(setNext as Action).state_updates![0][NEXT_TOPIC_VARIABLE]}`
    );
  });

  it('keeps the slot for end_session (action and handoff both read the gate)', () => {
    const { actions, slotDeclared } = compileMain(
      `
        if @variables.y:
            end_session`,
      'after_reasoning'
    );
    expect(writesSlot(actions)).toBe(true);
    expect(slotDeclared).toBe(true);
  });

  it('keeps the slot a captured file reference gates on (file refs evaluate the gate later)', () => {
    const source = `
config:
    agent_name: "TestBot"
    file_upload:
        mode: "managed"

variables:
    y: mutable boolean = False

start_agent main:
    description: "Test"
    reasoning:
        instructions: ->
            if @variables.y:
                | Files: {!@system_variables.uploaded_files}
`;
    const { output } = compile(parseSource(source), GATE_ON);
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'main'
    )! as SubAgentNode;
    const bri = (node.before_reasoning_iteration ?? []) as (
      | Action
      | HandOffAction
    )[];
    expect(writesSlot(bri)).toBe(true);
    expect(JSON.stringify(node.file_references)).toContain(CONDITION_SLOT_1);
  });

  it('leaves the slot in place by default (gate off)', () => {
    const { actions, slotDeclared } = compileMain(
      `
        if @variables.y:
            set @variables.x = 2`,
      'before_reasoning',
      { inlineConditionSlots: false }
    );
    expect(writesSlot(actions)).toBe(true);
    expect(slotDeclared).toBe(true);
  });

  it('leaves the slot in place with optimize: false even when the gate is on', () => {
    const { actions, slotDeclared } = compileMain(
      `
        if @variables.y:
            set @variables.x = 2`,
      'before_reasoning',
      { optimize: false }
    );
    expect(writesSlot(actions)).toBe(true);
    expect(slotDeclared).toBe(true);
    const set = actions.find(a =>
      (a as Action).state_updates?.some(u => 'x' in u)
    )!;
    expect(set.enabled).toContain(`state.${CONDITION_SLOT_1}`);
  });
});
