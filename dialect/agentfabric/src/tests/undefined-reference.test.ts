/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import type { Diagnostic } from '@agentscript/language';
import { parseAndLintSource } from './test-utils.js';

function byCode(diagnostics: Diagnostic[], code: string): Diagnostic[] {
  return diagnostics.filter(d => d.code === code);
}

/**
 * Behavioral coverage for the AgentFabric `undefined-reference` lint pass
 * (dialect/agentfabric/src/lint/passes/rules/undefined-reference.ts).
 *
 * The pass validates `@namespace.member` references against the schema's
 * known namespaces and global scopes. In AgentFabric the only document-
 * independent scope is `@request` (payload/interface/headers); the node
 * namespaces (@echo, @subagent, @llm, @actions, …) are schema keys whose
 * membership is enforced by other passes (execute rules, action-binding
 * rules, connection rules), so this pass intentionally stays silent on
 * them — verified by the negative cases below.
 */

function undefinedRefs(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.filter(d => d.code === 'undefined-reference');
}

describe('undefined-reference: unrecognized namespace', () => {
  it('flags a completely unknown namespace', () => {
    const source = `
config:
  agent_name: "unknown-ns"

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: @foobar.nope
`;
    const errors = undefinedRefs(parseAndLintSource(source).diagnostics);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("'@foobar' is not a recognized namespace");
    expect(errors[0].severity).toBe(1);
  });

  it('suggests the closest namespace for a misspelling', () => {
    const source = `
config:
  agent_name: "misspelled-ns"

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: @requst.payload
`;
    const errors = undefinedRefs(parseAndLintSource(source).diagnostics);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe(
      "'@requst' is not a recognized namespace. Did you mean 'request'?"
    );
  });
});

describe('undefined-reference: global-scope members', () => {
  it('flags a member that is not defined in a known global scope', () => {
    const source = `
config:
  agent_name: "bad-request-member"

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: @request.bogus
`;
    const errors = undefinedRefs(parseAndLintSource(source).diagnostics);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("'bogus' is not defined in request");
  });

  it('suggests the closest member for a near-miss', () => {
    const source = `
config:
  agent_name: "near-miss-member"

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: @request.payloadX
`;
    const errors = undefinedRefs(parseAndLintSource(source).diagnostics);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe(
      "'payloadX' is not defined in request. Did you mean 'payload'?"
    );
  });

  it.each(['payload', 'interface', 'headers'])(
    'does not flag valid @request.%s',
    member => {
      const source = `
config:
  agent_name: "valid-request-member"

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: @request.${member}
`;
      const errors = undefinedRefs(parseAndLintSource(source).diagnostics);
      expect(errors).toHaveLength(0);
    }
  );
});

describe('undefined-reference: multiple references', () => {
  it('reports one diagnostic per distinct undefined reference', () => {
    const source = `
config:
  agent_name: "multi-undef"

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: @request.bogus

echo two:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: @nope.here
`;
    const errors = undefinedRefs(parseAndLintSource(source).diagnostics);
    expect(errors).toHaveLength(2);
    const messages = errors.map(d => d.message).sort();
    expect(messages).toEqual([
      "'@nope' is not a recognized namespace",
      "'bogus' is not defined in request",
    ]);
  });
});

describe('undefined-reference: diagnostic metadata', () => {
  it('carries the reference name and expected members in data', () => {
    const source = `
config:
  agent_name: "diag-metadata"

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: @request.bogus
`;
    const errors = undefinedRefs(parseAndLintSource(source).diagnostics);
    expect(errors).toHaveLength(1);
    const data = errors[0].data as {
      referenceName?: string;
      expected?: string[];
    };
    expect(data.referenceName).toBe('@request.bogus');
    expect(data.expected).toEqual(['payload', 'interface', 'headers']);
  });
});

describe('undefined-reference: schema-key namespaces are not flagged here', () => {
  it('does not flag @actions references (validated by execute/binding rules)', () => {
    const source = `
config:
  agent_name: "actions-ns"

actions:
  notify:
    target: "a2a://notify"
    kind: "a2a:send_message"

trigger t:
  target: "brokers://actions-ns/a2a"
  on_message: -> transition to @executor.step

executor step:
  do: ->
    run @actions.notify
      with message = "ok"
  on_exit: -> transition to @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
`;
    const errors = undefinedRefs(parseAndLintSource(source).diagnostics);
    expect(errors).toHaveLength(0);
  });

  it('does not flag node-namespace transition targets (@subagent, @echo, @llm)', () => {
    const source = `
config:
  agent_name: "node-ns"

llm:
  g:
    target: "llm://openai"
    kind: "OpenAI"
    model: "gpt-4o-mini"

trigger t:
  kind: "a2a"
  target: "brokers://node-ns/a2a"
  on_message: -> transition to @subagent.s

subagent s:
  description: "worker"
  llm: @llm.g
  reasoning:
    instructions: -> do work
  on_exit: -> transition to @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
`;
    const errors = undefinedRefs(parseAndLintSource(source).diagnostics);
    expect(errors).toHaveLength(0);
  });

  it('emits no undefined-reference diagnostics for a fully valid document', () => {
    const source = `
config:
  agent_name: "all-valid"

llm:
  g:
    target: "llm://openai"
    kind: "OpenAI"
    model: "gpt-4o-mini"

trigger t:
  kind: "a2a"
  target: "brokers://all-valid/a2a"
  on_message: -> transition to @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: @request.payload
`;
    const errors = undefinedRefs(parseAndLintSource(source).diagnostics);
    expect(errors).toHaveLength(0);
  });
});

describe('undefined-reference: reference surfaces beyond echo fields', () => {
  it('flags an invalid @request member inside a router when-clause', () => {
    const source = `
config:
  agent_name: "router-when-bad-request"

trigger t:
  kind: "a2a"
  target: "brokers://router-when-bad-request/a2a"
  on_message: ->
    transition to @router.r

router r:
  routes:
    - target: @echo.done
      when: @request.bogus == "x"
  otherwise:
    target: @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
`;
    const errors = undefinedRefs(parseAndLintSource(source).diagnostics);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("'bogus' is not defined in request");
  });

  it('flags an unknown namespace inside a router when-clause', () => {
    const source = `
config:
  agent_name: "router-when-unknown-ns"

trigger t:
  kind: "a2a"
  target: "brokers://router-when-unknown-ns/a2a"
  on_message: ->
    transition to @router.r

router r:
  routes:
    - target: @echo.done
      when: @mystery.field == "x"
  otherwise:
    target: @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
`;
    const errors = undefinedRefs(parseAndLintSource(source).diagnostics);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("'@mystery' is not a recognized namespace");
  });

  it('does not flag a valid @request member inside a router when-clause', () => {
    const source = `
config:
  agent_name: "router-when-good-request"

trigger t:
  kind: "a2a"
  target: "brokers://router-when-good-request/a2a"
  on_message: ->
    transition to @router.r

router r:
  routes:
    - target: @echo.done
      when: @request.payload == "x"
  otherwise:
    target: @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
`;
    const errors = undefinedRefs(parseAndLintSource(source).diagnostics);
    expect(errors).toHaveLength(0);
  });

  it('flags an invalid @request member inside an action `with` argument', () => {
    const source = `
config:
  agent_name: "action-with-bad-request"

actions:
  notify:
    target: "mcp://xx"
    kind: "mcp:tool"
    tool_name: "notify"

llm:
  g:
    target: "llm://openai"
    kind: "OpenAI"
    model: "gpt-4o-mini"

trigger t:
  kind: "a2a"
  target: "brokers://action-with-bad-request/a2a"
  on_message: ->
    transition to @subagent.A

subagent A:
  llm: @llm.g
  description: "d"
  reasoning:
    instructions: ->
      | work
    actions:
      alias: @actions.notify
        with msg = @request.bogus
  on_exit: ->
    transition to @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
`;
    const errors = undefinedRefs(parseAndLintSource(source).diagnostics);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("'bogus' is not defined in request");
  });
});

describe('undefined-reference: string-interpolation gap (documented behavior)', () => {
  // The pass validates @-references that appear as first-class expression
  // values (echo message value, router when-clause, action `with` RHS). A
  // reference embedded in a STRING INTERPOLATION — `message: "hi {@request.x}"`
  // — is not surfaced as an expression to this pass, so it stays silent even
  // when the member is invalid. This test locks in that boundary so a future
  // change to interpolation handling is a deliberate, visible decision.
  it('does NOT flag an invalid @request member inside a string interpolation', () => {
    const source = `
config:
  agent_name: "interp-bad-request"

trigger t:
  kind: "a2a"
  target: "brokers://interp-bad-request/a2a"
  on_message: ->
    transition to @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "hello {@request.bogus}"
`;
    const errors = undefinedRefs(parseAndLintSource(source).diagnostics);
    expect(errors).toHaveLength(0);
  });
});

describe('undefined-reference: interplay with unused-node', () => {
  // Undefined-reference (a hard error) and unused-node (an informational
  // hint) are independent passes over different surfaces. A document can
  // legitimately trigger both at once; each should fire exactly once and
  // neither should suppress the other.
  it('reports an undefined @request member and an unused echo independently', () => {
    const source = `
config:
  agent_name: "combined-unused-and-undef"

trigger t:
  kind: "a2a"
  target: "brokers://combined-unused-and-undef/a2a"
  on_message: ->
    transition to @router.r

router r:
  routes:
    - target: @echo.done
      when: @request.bogus == "x"
  otherwise:
    target: @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"

echo orphan:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "never used"
`;
    const { diagnostics } = parseAndLintSource(source);

    const undef = byCode(diagnostics, 'undefined-reference');
    expect(undef).toHaveLength(1);
    expect(undef[0].message).toBe("'bogus' is not defined in request");

    const unused = byCode(diagnostics, 'unused-node');
    expect(unused).toHaveLength(1);
    expect(unused[0].message).toBe(
      "Echo 'orphan' is declared but never referenced"
    );
  });
});

describe('undefined-reference: router when-clause node references', () => {
  // A router `when` clause can compare against two kinds of @-reference:
  //   - @variables.X — validated against the declared `variables:` block.
  //     `@variables` is a schema namespace (not a global scope like
  //     `@request`), and the pass now flags any reference into a namespace
  //     that has NO defined members — including `@variables` when no
  //     `variables:` block is declared. So the fixtures below declare a
  //     `variables:` block for every variable they reference; an undeclared
  //     variable would produce its own `undefined-reference`. See the
  //     dedicated `@variables` describe block below for that behavior.
  //   - @generator.X.output.value — a reference to another node's output. The
  //     node prefix (`@generator.X`) IS statically checkable: if no generator
  //     named X is declared, the pass flags it.

  it('flags a router when-clause that references an undefined generator node', () => {
    const source = `
config:
  agent_name: "expr-router-undefined-generator"

llm:
  g:
    target: "llm://openai"
    kind: "OpenAI"
    model: "gpt-4o-mini"

variables:
  unsetVar: mutable string = ""

trigger t:
  kind: "a2a"
  target: "brokers://expr-router-undefined-generator/a2a"
  on_message: ->
    transition to @router.exprRouter

router exprRouter:
  routes:
    - target: @generator.unsetVarRoute
      when: @variables.unsetVar == "SHOULD_NEVER_MATCH"
      label: "UnsetVar"
    - target: @generator.setVarRoute
      when: @generator.captureInput.output.value == "CAPTURED"
      label: "Captured"
  otherwise:
    target: @generator.otherwiseRoute

generator unsetVarRoute:
  llm: @llm.g
  prompt: ->
    | a
  on_exit: ->
    transition to @echo.done

generator setVarRoute:
  llm: @llm.g
  prompt: ->
    | b
  on_exit: ->
    transition to @echo.done

generator otherwiseRoute:
  llm: @llm.g
  prompt: ->
    | c
  on_exit: ->
    transition to @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
`;
    const errors = undefinedRefs(parseAndLintSource(source).diagnostics);
    // `captureInput` generator is never declared -> flagged. `@variables.unsetVar`
    // resolves against the declared `variables:` block, so it is NOT flagged.
    // Exactly one diagnostic.
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe(
      "'captureInput' is not defined in generator"
    );
  });

  it('does not flag a router when-clause referencing a DEFINED generator output', () => {
    const source = `
config:
  agent_name: "expr-router-defined-generator"

llm:
  g:
    target: "llm://openai"
    kind: "OpenAI"
    model: "gpt-4o-mini"

variables:
  unsetVar: mutable string = ""

trigger t:
  kind: "a2a"
  target: "brokers://expr-router-defined-generator/a2a"
  on_message: ->
    transition to @generator.captureInput

generator captureInput:
  llm: @llm.g
  prompt: ->
    | capture
  on_exit: ->
    transition to @router.exprRouter

router exprRouter:
  routes:
    - target: @generator.unsetVarRoute
      when: @variables.unsetVar == "SHOULD_NEVER_MATCH"
      label: "UnsetVar"
    - target: @generator.setVarRoute
      when: @generator.captureInput.output.value == "CAPTURED"
      label: "Captured"
  otherwise:
    target: @generator.otherwiseRoute

generator unsetVarRoute:
  llm: @llm.g
  prompt: ->
    | a
  on_exit: ->
    transition to @echo.done

generator setVarRoute:
  llm: @llm.g
  prompt: ->
    | b
  on_exit: ->
    transition to @echo.done

generator otherwiseRoute:
  llm: @llm.g
  prompt: ->
    | c
  on_exit: ->
    transition to @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
`;
    const errors = undefinedRefs(parseAndLintSource(source).diagnostics);
    expect(errors).toHaveLength(0);
  });

  it('flags a @variables member in a when-clause when no variables block is declared', () => {
    const source = `
config:
  agent_name: "router-variables-no-block"

trigger t:
  kind: "a2a"
  target: "brokers://router-variables-no-block/a2a"
  on_message: ->
    transition to @router.r

router r:
  routes:
    - target: @echo.done
      when: @variables.unsetVar == "SHOULD_NEVER_MATCH"
  otherwise:
    target: @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
`;
    const errors = undefinedRefs(parseAndLintSource(source).diagnostics);
    // No `variables:` block -> the `variables` namespace has no defined
    // members, so any `@variables.X` reference is undefined and flagged.
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("'unsetVar' is not defined in variables");
  });
});

describe('undefined-reference: @variables against a declared variables block', () => {
  // Unlike `@request` (a global scope with a fixed member set) and unlike the
  // no-block case above, once a `variables:` block is declared the pass DOES
  // validate `@variables.<member>` references against the declared names.

  it('flags a @variables member that is not in the declared variables block', () => {
    const source = `
config:
  agent_name: "variables-declared-miss"

variables:
  known_var: mutable string = "hi"

trigger t:
  kind: "a2a"
  target: "brokers://variables-declared-miss/a2a"
  on_message: ->
    transition to @router.r

router r:
  routes:
    - target: @echo.done
      when: @variables.totallyUndeclared == "x"
  otherwise:
    target: @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "{@variables.known_var}"
`;
    const errors = undefinedRefs(parseAndLintSource(source).diagnostics);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe(
      "'totallyUndeclared' is not defined in variables"
    );
    expect(errors[0].severity).toBe(1);
  });

  it('does not flag a @variables member that IS in the declared variables block', () => {
    const source = `
config:
  agent_name: "variables-declared-hit"

variables:
  known_var: mutable string = "hi"

trigger t:
  kind: "a2a"
  target: "brokers://variables-declared-hit/a2a"
  on_message: ->
    transition to @router.r

router r:
  routes:
    - target: @echo.done
      when: @variables.known_var == "x"
  otherwise:
    target: @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
`;
    const errors = undefinedRefs(parseAndLintSource(source).diagnostics);
    expect(errors).toHaveLength(0);
  });
});

describe('undefined-reference: references into wholly-undefined namespaces', () => {
  // The pass flags a `@namespace.member` reference whenever the namespace is a
  // real schema key but has NO defined members anywhere in the document. This
  // is uniform across every node/data namespace: if you reference
  // `@subagent.X` but declare no subagents, `@subagent.X` is undefined.
  //
  // Exceptions:
  //   - @request is a global scope with a fixed member set (validated against
  //     payload/interface/headers), not a "wholly-undefined" namespace.
  //   - @actions references are owned by the execute/action-binding rules and
  //     stripped by suppressActionsNamespaceUndefinedReferencePass, so they do
  //     not surface here (verified below).

  it('flags a @subagent reference when no subagents are declared', () => {
    const source = `
config:
  agent_name: "no-subagents"

variables:
  x: mutable string = ""

trigger t:
  kind: "a2a"
  target: "brokers://no-subagents/a2a"
  on_message: ->
    transition to @executor.step

executor step:
  do: ->
    set @variables.x = @subagent.missingSub
  on_exit: ->
    transition to @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
`;
    const errors = undefinedRefs(parseAndLintSource(source).diagnostics);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("'missingSub' is not defined in subagent");
  });

  it('flags an undefined transition target into a zero-member namespace', () => {
    const source = `
config:
  agent_name: "bad-transition"

trigger t:
  kind: "a2a"
  target: "brokers://bad-transition/a2a"
  on_message: ->
    transition to @subagent.missingSub
`;
    const errors = undefinedRefs(parseAndLintSource(source).diagnostics);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe("'missingSub' is not defined in subagent");
  });

  it('does NOT flag @actions references (owned/suppressed by action rules)', () => {
    const source = `
config:
  agent_name: "actions-suppressed"

trigger t:
  kind: "a2a"
  target: "brokers://actions-suppressed/a2a"
  on_message: ->
    transition to @executor.step

executor step:
  do: ->
    run @actions.missingAction
  on_exit: ->
    transition to @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
`;
    const diagnostics = parseAndLintSource(source).diagnostics;
    // No undefined-reference for @actions — it is validated by
    // execute-action-def and suppressed for this pass.
    expect(undefinedRefs(diagnostics)).toHaveLength(0);
    // The action IS still caught, just by the dedicated action rule.
    expect(byCode(diagnostics, 'execute-action-def').length).toBeGreaterThan(0);
  });
});

describe('undefined-reference: router route/otherwise target member existence', () => {
  // Router `target:` fields are ReferenceValue fields carrying an
  // `allowedNamespaces` (+ `resolvedType`) constraint. Constraint validation
  // claims these nodes (adds them to validatedRefs) but only checks the
  // NAMESPACE — so a valid-namespace / missing-member target like
  // `@generator.setVarRoute1` (when only `setVarRoute` exists) previously
  // slipped through unflagged. This pass now verifies member existence for
  // constraint-claimed nodes UNLESS constraint validation already attached
  // its own diagnostic (bad namespace / capability), which would duplicate.

  const HEAD = `# @dialect: agentfabric=0.10
config:
  agent_name: "route-target-member"
llm:
  g:
    target: "llm://openai"
    kind: "OpenAI"
    model: "gpt-4o-mini"
variables:
  ready: mutable string = ""
trigger t:
  kind: "a2a"
  target: "brokers://route-target-member/a2a"
  on_message: ->
    transition to @generator.captureInput
generator captureInput:
  llm: @llm.g
  prompt: ->
    | capture
  on_exit: ->
    transition to @router.r
generator setVarRoute:
  llm: @llm.g
  prompt: ->
    | b
  on_exit: ->
    transition to @echo.done
generator otherwiseRoute:
  llm: @llm.g
  prompt: ->
    | c
  on_exit: ->
    transition to @echo.done
echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
`;

  it('flags a route target whose member is undefined (valid namespace)', () => {
    const source =
      HEAD +
      `
router r:
  routes:
    - target: @generator.setVarRoute1
      when: @generator.captureInput.output.value == "CAPTURED"
      label: "Captured"
  otherwise:
    target: @generator.otherwiseRoute
`;
    const errors = undefinedRefs(parseAndLintSource(source).diagnostics);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe(
      "'setVarRoute1' is not defined in generator. Did you mean 'setVarRoute'?"
    );
  });

  it('flags an otherwise target whose member is undefined', () => {
    const source =
      HEAD +
      `
router r:
  routes:
    - target: @generator.setVarRoute
      when: @generator.captureInput.output.value == "CAPTURED"
      label: "Captured"
  otherwise:
    target: @generator.missingOther
`;
    const errors = undefinedRefs(parseAndLintSource(source).diagnostics);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe(
      "'missingOther' is not defined in generator"
    );
  });

  it('does not flag a route target whose member is defined', () => {
    const source =
      HEAD +
      `
router r:
  routes:
    - target: @generator.setVarRoute
      when: @generator.captureInput.output.value == "CAPTURED"
      label: "Captured"
  otherwise:
    target: @generator.otherwiseRoute
`;
    const errors = undefinedRefs(parseAndLintSource(source).diagnostics);
    expect(errors).toHaveLength(0);
  });

  it('does not duplicate: a bad-namespace target yields only the constraint diagnostic', () => {
    const source =
      HEAD +
      `
router r:
  routes:
    - target: @variables.ready
      when: @generator.captureInput.output.value == "CAPTURED"
      label: "Captured"
  otherwise:
    target: @generator.otherwiseRoute
`;
    const diagnostics = parseAndLintSource(source).diagnostics;
    // @variables is not a valid transition target -> constraint-resolved-type
    // fires. undefined-reference must NOT also fire (no duplicate).
    expect(undefinedRefs(diagnostics)).toHaveLength(0);
    expect(
      byCode(diagnostics, 'constraint-resolved-type').length
    ).toBeGreaterThan(0);
  });
});
