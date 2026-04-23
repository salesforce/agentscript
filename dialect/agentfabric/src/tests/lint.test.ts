import { describe, it, expect } from 'vitest';
import { parseAndLintSource } from './test-utils.js';

describe('AgentFabric Lint', () => {
  it('reports no diagnostics for valid strict syntax', () => {
    const source = `
# @dialect: AGENTFABRIC=1.0-BETA

config:
  agent_name: "valid-agent"

llm:
  default_llm:
    target: "llm://openai"
    kind: "OpenAI"
    model: "gpt-4o-mini"

actions:
  lookup:
    target: "mcp://knowledge"
    kind: "mcp:tool"
    tool_name: "lookup"

trigger t:
  kind: "a2a"
  target: "brokers://valid-agent/a2a"
  on_message: -> transition to @echo.done

echo done:
  kind: "a2a:response"
  message: "ok"
`;
    const result = parseAndLintSource(source);
    const lintErrors = result.diagnostics.filter(
      d => d.severity === 1 && d.source !== 'parser'
    );
    expect(
      lintErrors.some(
        d =>
          d.code === 'connection-uri' ||
          d.code === 'missing-required-field' ||
          d.code === 'agentic-llm-required' ||
          d.code === 'switch-else-required'
      )
    ).toBe(false);
  });

  it('enforces protocol-specific URI schemes', () => {
    const source = `
config:
  agent_name: "bad-schemes"

llm:
  x:
    target: "connection://openai"
    kind: "OpenAI"
    model: "gpt-4o-mini"

actions:
  t1:
    target: "connection://tools"
    kind: "mcp:tool"
    tool_name: "lookup"
  t2:
    target: "mcp://agent"
    kind: "a2a:send_message"
`;
    const result = parseAndLintSource(source);
    expect(result.diagnostics.some(d => d.code === 'connection-uri')).toBe(
      true
    );
  });

  it('requires tool_name for mcp:tool', () => {
    const source = `
config:
  agent_name: "mcp-no-name"

actions:
  bad:
    target: "mcp://knowledge"
    kind: "mcp:tool"
`;
    const result = parseAndLintSource(source);
    expect(
      result.diagnostics.some(
        d =>
          d.code === 'missing-required-field' &&
          typeof d.message === 'string' &&
          d.message.includes('tool_name')
      )
    ).toBe(true);
  });

  it('reports unknown-variant for invalid actions kind', () => {
    const source = `
config:
  agent_name: "bad-action-kind"

actions:
  bad:
    target: "mcp://knowledge"
    kind: "mcp:unknown"
`;
    const result = parseAndLintSource(source);
    expect(result.diagnostics.some(d => d.code === 'unknown-variant')).toBe(
      true
    );
  });

  it('rejects tool_name on a2a:send_message actions', () => {
    const source = `
config:
  agent_name: "a2a-extra-field"

actions:
  bad:
    target: "a2a://agent"
    kind: "a2a:send_message"
    tool_name: "should-not-exist"
`;
    const result = parseAndLintSource(source);
    expect(result.diagnostics.some(d => d.code === 'unknown-field')).toBe(true);
  });

  it('reports unknown-variant for invalid llm kind', () => {
    const source = `
config:
  agent_name: "bad-llm-kind"

llm:
  x:
    target: "llm://x"
    kind: "claude"
    model: "x"
`;
    const result = parseAndLintSource(source);
    expect(result.diagnostics.some(d => d.code === 'unknown-variant')).toBe(
      true
    );
  });

  it('rejects Gemini-only fields on OpenAI llm entry', () => {
    const source = `
config:
  agent_name: "llm-wrong-fields"

llm:
  x:
    target: "llm://openai"
    kind: "OpenAI"
    model: "gpt-4o-mini"
    thinking_level: "HIGH"
`;
    const result = parseAndLintSource(source);
    expect(result.diagnostics.some(d => d.code === 'unknown-field')).toBe(true);
  });

  it('reports unknown-variant for invalid trigger kind', () => {
    const source = `
config:
  agent_name: "bad-trigger-kind"

trigger t:
  kind: "http"
  target: "brokers://bad-trigger-kind/a2a"
  on_message: -> transition to @echo.done

echo done:
  kind: "a2a:response"
  message: "ok"
`;
    const result = parseAndLintSource(source);
    expect(result.diagnostics.some(d => d.code === 'unknown-variant')).toBe(
      true
    );
  });

  it('reports unknown-variant for invalid echo kind', () => {
    const source = `
config:
  agent_name: "bad-echo-kind"

echo done:
  kind: "raw"
  message: "ok"
`;
    const result = parseAndLintSource(source);
    expect(result.diagnostics.some(d => d.code === 'unknown-variant')).toBe(
      true
    );
  });

  it('requires llm when no config.default_llm', () => {
    const source = `
config:
  agent_name: "llm-required"

trigger t:
  target: "brokers://llm-required/a2a"
  on_message: -> transition to @generator.g

generator g:
  prompt: -> summarize
  on_exit: -> transition to @echo.done

echo done:
  kind: "a2a:response"
  message: "ok"
`;
    const result = parseAndLintSource(source);
    expect(
      result.diagnostics.some(d => d.code === 'agentic-llm-required')
    ).toBe(true);
  });

  it('requires router.otherwise and route when', () => {
    const source = `
config:
  agent_name: "router-rules"

trigger t:
  target: "brokers://router-rules/a2a"
  on_message: -> transition to @router.r

router r:
  routes:
    - target: @echo.done

echo done:
  kind: "a2a:response"
  message: "ok"
`;
    const result = parseAndLintSource(source);
    expect(result.diagnostics.some(d => d.code === 'switch-route-when')).toBe(
      true
    );
    expect(
      result.diagnostics.some(d => d.code === 'switch-else-required')
    ).toBe(true);
  });

  it('rejects MemberExpression in router when', () => {
    const source = `
config:
  agent_name: "router-when-member"

trigger t:
  target: "brokers://router-when-member/a2a"
  on_message: -> transition to @router.r

router r:
  routes:
    - target: @echo.done
      when: @subagent.classifySeverity
  otherwise:
    target: @echo.done

echo done:
  kind: "a2a:response"
  message: "ok"
`;
    const result = parseAndLintSource(source);
    const errors = result.diagnostics.filter(
      d => d.code === 'switch-route-when-not-boolean'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe(
      "router 'r' route 'when' must be a boolean expression (comparison, logical operator, or boolean literal)."
    );
  });

  it('rejects StringLiteral in router when', () => {
    const source = `
config:
  agent_name: "router-when-string"

trigger t:
  target: "brokers://router-when-string/a2a"
  on_message: -> transition to @router.r

router r:
  routes:
    - target: @echo.done
      when: "high"
  otherwise:
    target: @echo.done

echo done:
  kind: "a2a:response"
  message: "ok"
`;
    const result = parseAndLintSource(source);
    const errors = result.diagnostics.filter(
      d => d.code === 'switch-route-when-not-boolean'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe(
      "router 'r' route 'when' must be a boolean expression (comparison, logical operator, or boolean literal)."
    );
  });

  it('rejects arithmetic BinaryExpression in router when', () => {
    const source = `
config:
  agent_name: "router-when-arith"

trigger t:
  target: "brokers://router-when-arith/a2a"
  on_message: -> transition to @router.r

router r:
  routes:
    - target: @echo.done
      when: @subagent.x.output.a + @subagent.x.output.b
  otherwise:
    target: @echo.done

echo done:
  kind: "a2a:response"
  message: "ok"
`;
    const result = parseAndLintSource(source);
    const errors = result.diagnostics.filter(
      d => d.code === 'switch-route-when-not-boolean'
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe(
      "router 'r' route 'when' must be a boolean expression (comparison, logical operator, or boolean literal)."
    );
  });

  it('accepts ComparisonExpression (==) in router when', () => {
    const source = `
config:
  agent_name: "router-when-cmp"

trigger t:
  target: "brokers://router-when-cmp/a2a"
  on_message: -> transition to @router.r

router r:
  routes:
    - target: @echo.done
      when: @subagent.classifySeverity.output.level == "high"
  otherwise:
    target: @echo.done

echo done:
  kind: "a2a:response"
  message: "ok"
`;
    const result = parseAndLintSource(source);
    const errors = result.diagnostics.filter(
      d => d.code === 'switch-route-when-not-boolean'
    );
    expect(errors).toHaveLength(0);
  });

  it('accepts ComparisonExpression (!=) in router when', () => {
    const source = `
config:
  agent_name: "router-when-neq"

trigger t:
  target: "brokers://router-when-neq/a2a"
  on_message: -> transition to @router.r

router r:
  routes:
    - target: @echo.done
      when: @subagent.x.output.status != "done"
  otherwise:
    target: @echo.done

echo done:
  kind: "a2a:response"
  message: "ok"
`;
    const result = parseAndLintSource(source);
    const errors = result.diagnostics.filter(
      d => d.code === 'switch-route-when-not-boolean'
    );
    expect(errors).toHaveLength(0);
  });

  it('accepts BooleanLiteral in router when', () => {
    const source = `
config:
  agent_name: "router-when-bool"

trigger t:
  target: "brokers://router-when-bool/a2a"
  on_message: -> transition to @router.r

router r:
  routes:
    - target: @echo.done
      when: True
  otherwise:
    target: @echo.done

echo done:
  kind: "a2a:response"
  message: "ok"
`;
    const result = parseAndLintSource(source);
    const errors = result.diagnostics.filter(
      d => d.code === 'switch-route-when-not-boolean'
    );
    expect(errors).toHaveLength(0);
  });

  it('accepts logical and in router when', () => {
    const source = `
config:
  agent_name: "router-when-and"

trigger t:
  target: "brokers://router-when-and/a2a"
  on_message: -> transition to @router.r

router r:
  routes:
    - target: @echo.done
      when: @subagent.x.output.a == "1" and @subagent.x.output.b == "2"
  otherwise:
    target: @echo.done

echo done:
  kind: "a2a:response"
  message: "ok"
`;
    const result = parseAndLintSource(source);
    const errors = result.diagnostics.filter(
      d => d.code === 'switch-route-when-not-boolean'
    );
    expect(errors).toHaveLength(0);
  });

  it('accepts logical or in router when', () => {
    const source = `
config:
  agent_name: "router-when-or"

trigger t:
  target: "brokers://router-when-or/a2a"
  on_message: -> transition to @router.r

router r:
  routes:
    - target: @echo.done
      when: @subagent.x.output.a == "1" or @subagent.x.output.b == "2"
  otherwise:
    target: @echo.done

echo done:
  kind: "a2a:response"
  message: "ok"
`;
    const result = parseAndLintSource(source);
    const errors = result.diagnostics.filter(
      d => d.code === 'switch-route-when-not-boolean'
    );
    expect(errors).toHaveLength(0);
  });

  it('accepts unary not in router when', () => {
    const source = `
config:
  agent_name: "router-when-not"

trigger t:
  target: "brokers://router-when-not/a2a"
  on_message: -> transition to @router.r

router r:
  routes:
    - target: @echo.done
      when: not @subagent.x.output.done
  otherwise:
    target: @echo.done

echo done:
  kind: "a2a:response"
  message: "ok"
`;
    const result = parseAndLintSource(source);
    const errors = result.diagnostics.filter(
      d => d.code === 'switch-route-when-not-boolean'
    );
    expect(errors).toHaveLength(0);
  });

  it('accepts CallExpression in router when', () => {
    const source = `
config:
  agent_name: "router-when-call"

trigger t:
  target: "brokers://router-when-call/a2a"
  on_message: -> transition to @router.r

router r:
  routes:
    - target: @echo.done
      when: contains(@subagent.x.output.tags, "urgent")
  otherwise:
    target: @echo.done

echo done:
  kind: "a2a:response"
  message: "ok"
`;
    const result = parseAndLintSource(source);
    const errors = result.diagnostics.filter(
      d => d.code === 'switch-route-when-not-boolean'
    );
    expect(errors).toHaveLength(0);
  });

  it('requires reasoning.instructions for orchestrator and subagent', () => {
    const source = `
config:
  agent_name: "missing-reasoning-instructions"

llm:
  g:
    target: "llm://openai"
    kind: "OpenAI"
    model: "gpt-4o-mini"

trigger t:
  target: "brokers://missing-reasoning-instructions/a2a"
  on_message: -> transition to @orchestrator.o

orchestrator o:
  llm: @llm.g
  reasoning:
    actions:
      t: @actions.lookup
  on_exit: -> transition to @subagent.s

subagent s:
  llm: @llm.g
  reasoning:
    actions:
      t: @actions.lookup
  on_exit: -> transition to @echo.done

echo done:
  kind: "a2a:response"
  message: "ok"
`;
    const result = parseAndLintSource(source);
    expect(
      result.diagnostics.some(d => d.code === 'reasoning-instructions-required')
    ).toBe(true);
  });

  it('suppresses false undefined-reference for @actions namespace', () => {
    const source = `
config:
  agent_name: "tools-ns"

actions:
  notify:
    target: "a2a://notify"
    kind: "a2a:send_message"

trigger t:
  target: "brokers://tools-ns/a2a"
  on_message: -> transition to @executor.step

executor step:
  do: ->
    run @actions.notify
      with message = "ok"
`;
    const result = parseAndLintSource(source);
    expect(
      result.diagnostics.some(
        d =>
          d.code === 'undefined-reference' &&
          typeof d.message === 'string' &&
          d.message.includes("'@actions' cannot be used as a reference")
      )
    ).toBe(false);
  });

  it('suppresses false action-binding diagnostics for @actions.* in reasoning.actions', () => {
    const source = `
config:
  agent_name: "tools-binding"

llm:
  g:
    target: "llm://openai"
    kind: "OpenAI"
    model: "gpt-4o-mini"

actions:
  search_articles:
    target: "mcp://knowledge"
    kind: "mcp:tool"
    tool_name: "search_articles"

trigger t:
  target: "brokers://tools-binding/a2a"
  on_message: -> transition to @subagent.s

subagent s:
  description: "node"
  llm: @llm.g
  reasoning:
    instructions: -> do work
    actions:
      kb_search: @actions.search_articles
  on_exit: -> transition to @echo.done

echo done:
  kind: "a2a:response"
  message: "ok"
`;
    const result = parseAndLintSource(source);
    expect(
      result.diagnostics.some(
        d =>
          (d.code === 'undefined-reference' ||
            d.code === 'constraint-resolved-type') &&
          typeof d.message === 'string' &&
          (d.message.includes('is not defined in actions') ||
            d.message.includes("Cannot invoke '@actions."))
      )
    ).toBe(false);
  });

  it('parseAndLint completes without OOM on complex documents with nested actions', () => {
    const source = `
# @dialect: AGENTFABRIC=1
config:
  agent_name: "employee-onboarding"
  label: "Employee Onboarding Agent"
  description: "An Agent that performs employee onboarding"
  default_llm: @llm.main

llm:
  main:
    target: "llm://openai"
    kind: "OpenAI"
    model: "gpt-4o-mini"

actions:
  hr_agent:
    target: "a2a://hr_agent_connection"
    kind: "a2a:send_message"
  send_slack:
    target: "mcp://slack"
    kind: "mcp:tool"
    tool_name: "send_message"

trigger onboarding:
  target: "brokers://employee-onboarding/a2a"
  on_message: -> transition to @orchestrator.onboard

orchestrator onboard:
  description: "onboard to HR system"
  llm: @llm.main
  reasoning:
    instructions: -> onboard new hires
    actions:
      my_hr: @actions.hr_agent
      slack: @actions.send_slack
        with message = "hello"
  on_exit: -> transition to @generator.summary

generator summary:
  llm: @llm.main
  prompt: -> summarize onboarding
  on_exit: -> transition to @executor.notify

executor notify:
  do: ->
    run @actions.send_slack
      with message = "done"
  on_exit: -> transition to @router.countryRouter

router countryRouter:
  routes:
    - target: @echo.done
      when: True
      label: "Default"
  otherwise:
    target: @echo.done

echo done:
  kind: "a2a:response"
  message: "ok"
`;
    const result = parseAndLintSource(source);
    expect(result.ast).toBeDefined();
    expect(
      result.diagnostics.some(
        d =>
          d.code === 'undefined-reference' &&
          typeof d.message === 'string' &&
          d.message.includes('@actions')
      )
    ).toBe(false);
  });

  it('does not accept A2A global calls with @', () => {
    const source = `
echo successResponse:
  kind: "a2a:response"
  task: @a2a.task({ state: "completed", message: @a2a.message()})
`;
    const result = parseAndLintSource(source);
    expect(
      result.diagnostics.filter(
        d =>
          d.code === 'namespace-function-call' &&
          d.message.includes('Only direct namespace function calls are allowed')
      ).length
    ).toBe(2);
  });

  it('allows namespaced A2A helper calls in expression fields (a2a.message, a2a.textPart, …)', () => {
    const source = `
echo out:
  kind: "a2a:response"
  message: a2a.message(a2a.textPart("hello"))
`;
    const result = parseAndLintSource(source);
    expect(result.diagnostics.length).toBe(0);
  });

  it('allows namespaced A2A helper calls when assigning value to variable', () => {
    const source = `
executor step:
  do: ->
    set @variables.t = a2a.task({ state: "completed" })
`;
    const result = parseAndLintSource(source);
    expect(result.diagnostics.length).toBe(0);
  });

  it('accepts generator prompt in procedure form', () => {
    const source = `
config:
  agent_name: "generator-procedure-prompt"

llm:
  g:
    target: "llm://openai"
    kind: "OpenAI"
    model: "gpt-4o-mini"

trigger t:
  target: "brokers://generator-procedure-prompt/a2a"
  on_message: -> transition to @generator.g

generator g:
  llm: @llm.g
  prompt: ->
    | summarize this request
  on_exit: -> transition to @echo.done

echo done:
  kind: "a2a:response"
  message: "ok"
`;
    const result = parseAndLintSource(source);
    expect(
      result.diagnostics.some(d => d.code === 'generator-prompt-required')
    ).toBe(false);
  });
});
