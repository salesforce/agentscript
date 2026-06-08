import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Diagnostic } from '@agentscript/language';
import { parseAndLintSource } from './test-utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
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
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
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
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
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
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
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
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
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
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
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
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
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
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
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
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
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
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
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
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
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
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
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
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
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
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
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
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
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
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
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
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
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
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: @a2a.message()
`;
    const result = parseAndLintSource(source);
    expect(
      result.diagnostics.filter(
        d =>
          d.code === 'namespace-function-call' &&
          d.message.includes('Only direct namespace function calls are allowed')
      ).length
    ).toBe(1);
  });

  it('allows namespaced A2A helper calls in expression fields (a2a.message, a2a.textPart, …)', () => {
    const source = `
trigger t:
  kind: "a2a"
  target: "brokers://generator-procedure-prompt/a2a"
  on_message: -> 
    transition to @echo.out

echo out:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: a2a.message(a2a.textPart("hello"))
`;
    const result = parseAndLintSource(source);
    expect(result.diagnostics.length).toBe(0);
  });

  it('allows namespaced A2A helper calls when assigning value to variable', () => {
    const source = `
executor step:
  do: ->
    set @variables.t = a2a.message({ parts: [a2a.textPart("hello")] })
`;
    const result = parseAndLintSource(source);
    const relevant = result.diagnostics.filter(
      d =>
        d.code !== 'unused-node' &&
        d.code !== 'missing-required-field' &&
        d.code !== 'terminal-requires-status-update'
    );
    expect(relevant.length).toBe(0);
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
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
`;
    const result = parseAndLintSource(source);
    expect(
      result.diagnostics.some(d => d.code === 'generator-prompt-required')
    ).toBe(false);
  });

  it('reports no lint errors for it-help-investigation fixture', () => {
    const agentPath = resolve(
      __dirname,
      './resources/it-help-investigation.agent'
    );
    const source = readFileSync(agentPath, 'utf8');
    const result = parseAndLintSource(source);
    const lintErrors = result.diagnostics.filter(
      d => d.severity === 1 && d.source !== 'parser'
    );
    expect(lintErrors).toHaveLength(0);
  });

  it('does not flag output-structure-items-required for top-level array with items', () => {
    const source = `
config:
  agent_name: "outputs-top-level-array"

llm:
  g:
    target: "llm://openai"
    kind: "OpenAI"
    model: "gpt-4o-mini"

trigger t:
  kind: "a2a"
  target: "brokers://outputs-top-level-array/a2a"
  on_message: -> transition to @orchestrator.o

orchestrator o:
  llm: @llm.g
  reasoning:
    instructions: ->
      | do something
    outputs:
      properties:
        associated_symptoms:
          type: "array"
          description: "Additional symptoms"
          items:
            type: "string"
  on_exit: -> transition to @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
`;
    const result = parseAndLintSource(source);
    expect(
      result.diagnostics.some(d => d.code === 'output-structure-items-required')
    ).toBe(false);
  });

  it('does not flag output-structure-items-required for nested array with items under object properties', () => {
    const source = `
config:
  agent_name: "outputs-nested-array"

llm:
  g:
    target: "llm://openai"
    kind: "OpenAI"
    model: "gpt-4o-mini"

trigger t:
  kind: "a2a"
  target: "brokers://outputs-nested-array/a2a"
  on_message: -> transition to @orchestrator.o

orchestrator o:
  llm: @llm.g
  reasoning:
    instructions: ->
      | do something
    outputs:
      properties:
        information_gathered:
          type: "object"
          properties:
            associated_symptoms:
              type: "array"
              description: "Additional symptoms"
              items:
                type: "string"
  on_exit: -> transition to @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
`;
    const result = parseAndLintSource(source);
    const outputStructureErrors = result.diagnostics.filter(
      d => typeof d.code === 'string' && d.code.startsWith('output-structure')
    );
    expect(outputStructureErrors).toEqual([]);
  });

  it('does not flag output-structure for array-of-objects nested under object properties', () => {
    const source = `
config:
  agent_name: "outputs-array-of-objects"

llm:
  g:
    target: "llm://openai"
    kind: "OpenAI"
    model: "gpt-4o-mini"

trigger t:
  kind: "a2a"
  target: "brokers://outputs-array-of-objects/a2a"
  on_message: -> transition to @orchestrator.o

orchestrator o:
  llm: @llm.g
  reasoning:
    instructions: ->
      | do something
    outputs:
      properties:
        information_gathered:
          type: "object"
          properties:
            top_conditions:
              type: "array"
              description: "Top matching conditions"
              items:
                type: "object"
                properties:
                  condition_name:
                    type: "string"
                  score:
                    type: "number"
  on_exit: -> transition to @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
`;
    const result = parseAndLintSource(source);
    const outputStructureErrors = result.diagnostics.filter(
      d => typeof d.code === 'string' && d.code.startsWith('output-structure')
    );
    expect(outputStructureErrors).toEqual([]);
  });

  it('does not flag output-structure for deeply nested mixed array/object schema', () => {
    const source = `
config:
  agent_name: "outputs-deeply-nested"

llm:
  g:
    target: "llm://openai"
    kind: "OpenAI"
    model: "gpt-4o-mini"

trigger t:
  kind: "a2a"
  target: "brokers://outputs-deeply-nested/a2a"
  on_message: -> transition to @orchestrator.o

orchestrator o:
  llm: @llm.g
  reasoning:
    instructions: ->
      | do something
    outputs:
      properties:
        info:
          type: "object"
          properties:
            top_conditions:
              type: "array"
              items:
                type: "object"
                properties:
                  evidence:
                    type: "array"
                    items:
                      type: "object"
                      properties:
                        details:
                          type: "string"
            deep:
              type: "object"
              properties:
                inner:
                  type: "object"
                  properties:
                    items_at_depth4:
                      type: "array"
                      items:
                        type: "string"
        matrix:
          type: "array"
          items:
            type: "array"
            items:
              type: "number"
  on_exit: -> transition to @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
`;
    const result = parseAndLintSource(source);
    const outputStructureErrors = result.diagnostics.filter(
      d => typeof d.code === 'string' && d.code.startsWith('output-structure')
    );
    expect(outputStructureErrors).toEqual([]);
  });

  it('still flags output-structure-items-required when items is missing at depth', () => {
    const source = `
config:
  agent_name: "outputs-missing-items-at-depth"

llm:
  g:
    target: "llm://openai"
    kind: "OpenAI"
    model: "gpt-4o-mini"

trigger t:
  kind: "a2a"
  target: "brokers://outputs-missing-items-at-depth/a2a"
  on_message: -> transition to @orchestrator.o

orchestrator o:
  llm: @llm.g
  reasoning:
    instructions: ->
      | do something
    outputs:
      properties:
        information_gathered:
          type: "object"
          properties:
            associated_symptoms:
              type: "array"
              description: "Additional symptoms (no items declared)"
  on_exit: -> transition to @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
`;
    const result = parseAndLintSource(source);
    const itemsErrors = result.diagnostics.filter(
      d => d.code === 'output-structure-items-required'
    );
    expect(itemsErrors).toHaveLength(1);
    expect(itemsErrors[0].message).toContain(
      'information_gathered.properties.associated_symptoms'
    );
  });
});

describe('unused-node rule', () => {
  function unusedNode(diagnostics: Diagnostic[]): Diagnostic[] {
    return diagnostics.filter(d => d.code === 'unused-node');
  }

  it('does not warn when trigger -> A and A.on_exit -> B (terminal echo)', () => {
    const source = `
config:
  agent_name: "unused-node-1"

llm:
  g:
    target: "llm://openai"
    kind: "OpenAI"
    model: "gpt-4o-mini"

trigger t:
  kind: "a2a"
  target: "brokers://unused-node-1/a2a"
  on_message: ->
    transition to @subagent.A

subagent A:
  llm: @llm.g
  description: "A subagent"
  reasoning:
    instructions: ->
      | work
  on_exit: ->
    transition to @echo.B

echo B:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
`;
    const { diagnostics } = parseAndLintSource(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('does not warn when a node is the trigger target only', () => {
    const source = `
config:
  agent_name: "unused-node-3"

trigger t:
  kind: "a2a"
  target: "brokers://unused-node-3/a2a"
  on_message: ->
    transition to @echo.X

echo X:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
`;
    const { diagnostics } = parseAndLintSource(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('does not warn when a node is referenced only inside a reasoning.instructions if branch', () => {
    const source = `
config:
  agent_name: "unused-node-4"

llm:
  g:
    target: "llm://openai"
    kind: "OpenAI"
    model: "gpt-4o-mini"

trigger t:
  kind: "a2a"
  target: "brokers://unused-node-4/a2a"
  on_message: ->
    transition to @subagent.A

subagent A:
  llm: @llm.g
  description: "A subagent"
  reasoning:
    instructions: ->
      | analyze
      if @variables.ready:
        transition to @echo.X
  on_exit: ->
    transition to @echo.X

echo X:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
`;
    const { diagnostics } = parseAndLintSource(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('does not warn when a node is referenced only by router otherwise.target', () => {
    const source = `
config:
  agent_name: "unused-node-5"

trigger t:
  kind: "a2a"
  target: "brokers://unused-node-5/a2a"
  on_message: ->
    transition to @router.r

router r:
  routes:
    - target: @echo.done
      when: True
  otherwise:
    target: @echo.X

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"

echo X:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "fallback"
`;
    const { diagnostics } = parseAndLintSource(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('does not warn when a node is referenced only by router routes[].target', () => {
    const source = `
config:
  agent_name: "unused-node-6"

trigger t:
  kind: "a2a"
  target: "brokers://unused-node-6/a2a"
  on_message: ->
    transition to @router.r

router r:
  routes:
    - target: @echo.X
      when: True
  otherwise:
    target: @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"

echo X:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "x"
`;
    const { diagnostics } = parseAndLintSource(source);
    expect(diagnostics).toHaveLength(0);
  });

  it('flags one diagnostic per unused declaration across all node namespaces (subagent, generator, echo, llm, actions)', () => {
    const source = `
config:
  agent_name: "unused-node-positive"

llm:
  usedLlm:
    target: "llm://openai"
    kind: "OpenAI"
    model: "gpt-4o-mini"
  unusedLlm:
    target: "llm://openai"
    kind: "OpenAI"
    model: "gpt-4o-mini"

actions:
  usedAction:
    target: "mcp://knowledge"
    kind: "mcp:tool"
    tool_name: "lookup"
  unusedAction:
    target: "mcp://knowledge"
    kind: "mcp:tool"
    tool_name: "lookup"

trigger t:
  kind: "a2a"
  target: "brokers://unused-node-positive/a2a"
  on_message: ->
    transition to @subagent.usedSub

subagent usedSub:
  llm: @llm.usedLlm
  description: "A subagent"
  reasoning:
    instructions: ->
      | work
    actions:
      alias: @actions.usedAction
  on_exit: ->
    transition to @echo.done

subagent unusedSub:
  llm: @llm.usedLlm
  description: "A subagent"
  reasoning:
    instructions: ->
      | work
  on_exit: ->
    transition to @echo.done

generator unusedGen:
  llm: @llm.usedLlm
  prompt: ->
    | summarize
  on_exit: ->
    transition to @echo.done

echo unusedEcho:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "x"

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
`;
    const { diagnostics } = parseAndLintSource(source);
    expect(diagnostics).toHaveLength(5);
    const found = unusedNode(diagnostics);
    expect(found).toHaveLength(5);
    const messages = found.map(d => d.message).sort();
    expect(messages).toEqual([
      "Actions 'unusedAction' is declared but never referenced",
      "Echo 'unusedEcho' is declared but never referenced",
      "Generator 'unusedGen' is declared but never referenced",
      "LLM 'unusedLlm' is declared but never referenced",
      "Subagent 'unusedSub' is declared but never referenced",
    ]);
    for (const d of found) {
      expect(d.source).toBe('agentfabric-lint');
      expect(d.tags).toEqual([1]);
    }
  });

  it('does not crash or double-report on a malformed transition target', () => {
    const source = `
config:
  agent_name: "unused-node-10"

llm:
  g:
    target: "llm://openai"
    kind: "OpenAI"
    model: "gpt-4o-mini"

trigger t:
  kind: "a2a"
  target: "brokers://unused-node-10/a2a"
  on_message: ->
    transition to @subagent.missing

subagent A:
  llm: @llm.g
  description: "A subagent"
  reasoning:
    instructions: ->
      | work
  on_exit: ->
    transition to @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
`;
    const { diagnostics } = parseAndLintSource(source);
    // info for unused node and error for missing transition target
    expect(diagnostics).toHaveLength(2);
    const found = unusedNode(diagnostics);
    expect(found).toHaveLength(1);
    expect(found[0].message).toBe(
      "Subagent 'A' is declared but never referenced"
    );
  });
});

describe('cycle-detected rule', () => {
  function cycleDiagnostics(diagnostics: Diagnostic[]): Diagnostic[] {
    return diagnostics.filter(d => d.code === 'cycle-detected');
  }

  it('reports no cycle for a DAG (A -> B, A -> C, B -> D, C -> D)', () => {
    const source = `
config:
  agent_name: "cycle-dag"

llm:
  g:
    target: "llm://openai"
    kind: "OpenAI"
    model: "gpt-4o-mini"

trigger t:
  kind: "a2a"
  target: "brokers://cycle-dag/a2a"
  on_message: ->
    transition to @orchestrator.A

orchestrator A:
  description: "node A"
  llm: @llm.g
  reasoning:
    instructions: ->
      | work
  on_exit: ->
    transition to @router.R

router R:
  routes:
    - target: @orchestrator.B
      when: True
  otherwise:
    target: @orchestrator.C

orchestrator B:
  description: "node B"
  llm: @llm.g
  reasoning:
    instructions: ->
      | work
  on_exit: ->
    transition to @orchestrator.D

orchestrator C:
  description: "node C"
  llm: @llm.g
  reasoning:
    instructions: ->
      | work
  on_exit: ->
    transition to @orchestrator.D

orchestrator D:
  description: "node D"
  llm: @llm.g
  reasoning:
    instructions: ->
      | work
  on_exit: ->
    transition to @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
`;
    const result = parseAndLintSource(source);
    expect(cycleDiagnostics(result.diagnostics)).toHaveLength(0);
  });

  it('reports a three-node cycle (A -> B -> C -> A) with paths rotated per node', () => {
    const source = `
config:
  agent_name: "cycle-three"

llm:
  g:
    target: "llm://openai"
    kind: "OpenAI"
    model: "gpt-4o-mini"

trigger t:
  kind: "a2a"
  target: "brokers://cycle-three/a2a"
  on_message: ->
    transition to @orchestrator.A

orchestrator A:
  description: "node A"
  llm: @llm.g
  reasoning:
    instructions: ->
      | work
  on_exit: ->
    transition to @orchestrator.B

orchestrator B:
  description: "node B"
  llm: @llm.g
  reasoning:
    instructions: ->
      | work
  on_exit: ->
    transition to @orchestrator.C

orchestrator C:
  description: "node C"
  llm: @llm.g
  reasoning:
    instructions: ->
      | work
  on_exit: ->
    transition to @orchestrator.A
`;
    const result = parseAndLintSource(source);
    const cycles = cycleDiagnostics(result.diagnostics);
    expect(cycles).toHaveLength(3);
    const messages = cycles.map(d => d.message).sort();
    expect(messages).toEqual([
      'Cycle detected in execution flow: @orchestrator.A → @orchestrator.B → @orchestrator.C → @orchestrator.A',
      'Cycle detected in execution flow: @orchestrator.B → @orchestrator.C → @orchestrator.A → @orchestrator.B',
      'Cycle detected in execution flow: @orchestrator.C → @orchestrator.A → @orchestrator.B → @orchestrator.C',
    ]);
  });

  it('detects an orphan cycle that is unreachable from triggers', () => {
    const source = `
config:
  agent_name: "cycle-orphan"

llm:
  g:
    target: "llm://openai"
    kind: "OpenAI"
    model: "gpt-4o-mini"

trigger t:
  kind: "a2a"
  target: "brokers://cycle-orphan/a2a"
  on_message: ->
    transition to @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"

orchestrator A:
  description: "orphan A"
  llm: @llm.g
  reasoning:
    instructions: ->
      | work
  on_exit: ->
    transition to @orchestrator.B

orchestrator B:
  description: "orphan B"
  llm: @llm.g
  reasoning:
    instructions: ->
      | work
  on_exit: ->
    transition to @orchestrator.A
`;
    const result = parseAndLintSource(source);
    const cycles = cycleDiagnostics(result.diagnostics);
    expect(cycles).toHaveLength(2);
    const messages = cycles.map(d => d.message).sort();
    expect(messages).toEqual([
      'Cycle detected in execution flow: @orchestrator.A → @orchestrator.B → @orchestrator.A',
      'Cycle detected in execution flow: @orchestrator.B → @orchestrator.A → @orchestrator.B',
    ]);
  });

  it('emits two distinct cycle diagnostics on a node shared by two cycles (router fork)', () => {
    const source = `
config:
  agent_name: "cycle-shared"

llm:
  g:
    target: "llm://openai"
    kind: "OpenAI"
    model: "gpt-4o-mini"

trigger t:
  kind: "a2a"
  target: "brokers://cycle-shared/a2a"
  on_message: ->
    transition to @orchestrator.A

orchestrator A:
  description: "shared node"
  llm: @llm.g
  reasoning:
    instructions: ->
      | work
  on_exit: ->
    transition to @router.R

router R:
  routes:
    - target: @orchestrator.B
      when: True
    - target: @orchestrator.C
      when: False
  otherwise:
    target: @echo.done

orchestrator B:
  description: "node B"
  llm: @llm.g
  reasoning:
    instructions: ->
      | work
  on_exit: ->
    transition to @orchestrator.A

orchestrator C:
  description: "node C"
  llm: @llm.g
  reasoning:
    instructions: ->
      | work
  on_exit: ->
    transition to @orchestrator.A

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
`;
    const result = parseAndLintSource(source);
    const cycles = cycleDiagnostics(result.diagnostics);
    const onA = cycles.filter(
      d =>
        typeof d.message === 'string' &&
        d.message.startsWith(
          'Cycle detected in execution flow: @orchestrator.A → '
        )
    );
    expect(onA).toHaveLength(2);
    const aMessages = onA.map(d => d.message).sort();
    expect(aMessages).toEqual([
      'Cycle detected in execution flow: @orchestrator.A → @router.R → @orchestrator.B → @orchestrator.A',
      'Cycle detected in execution flow: @orchestrator.A → @router.R → @orchestrator.C → @orchestrator.A',
    ]);
  });
});

describe('execute rules', () => {
  it('reports execute-undeclared-input for undeclared with param in executor run', () => {
    const source = `# @dialect: AGENTFABRIC=1.0-BETA

config:
  agent_name: "exec-input"

actions:
  billing:
    target: "a2a://billing"
    kind: "a2a:send_message"
    inputs:
      message: {}

trigger t:
  kind: "a2a"
  target: "brokers://exec-input/a2a"
  on_message: -> transition to @executor.run_billing

executor run_billing:
  do: ->
    run @actions.billing
      with unknown_param = "x"
  on_exit: -> transition to @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
`;
    const result = parseAndLintSource(source);
    expect(
      result.diagnostics.some(d => d.code === 'execute-undeclared-input')
    ).toBe(true);
  });

  it('reports execute-action-def for missing action definition', () => {
    const source = `# @dialect: AGENTFABRIC=1.0-BETA

config:
  agent_name: "exec-noaction"

actions:
  other:
    target: "mcp://conn"
    kind: "mcp:tool"
    tool_name: "tool"

trigger t:
  kind: "a2a"
  target: "brokers://exec-noaction/a2a"
  on_message: -> transition to @executor.run_it

executor run_it:
  do: ->
    run @actions.nonexistent
  on_exit: -> transition to @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
`;
    const result = parseAndLintSource(source);
    expect(result.diagnostics.some(d => d.code === 'execute-action-def')).toBe(
      true
    );
  });

  it('reports execute-action-def when no actions block is defined', () => {
    const source = `# @dialect: AGENTFABRIC=1.0-BETA

config:
  agent_name: "exec-no-actions-block"

trigger t:
  kind: "a2a"
  target: "brokers://exec-no-actions-block/a2a"
  on_message: -> transition to @executor.run_it

executor run_it:
  do: ->
    run @actions.nonexistent
  on_exit: -> transition to @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
`;
    const result = parseAndLintSource(source);
    expect(result.diagnostics.some(d => d.code === 'execute-action-def')).toBe(
      true
    );
  });
});

describe('action-binding rules', () => {
  it('reports action-binding-undeclared-input for undeclared with param on subagent action', () => {
    const source = `# @dialect: AGENTFABRIC=1.0-BETA

config:
  agent_name: "binding-warn"

llm:
  g:
    target: "llm://openai"
    kind: "OpenAI"
    model: "gpt-4o-mini"

actions:
  my_tool:
    target: "mcp://conn"
    kind: "mcp:tool"
    tool_name: "tool"
    inputs:
      foo: {}

trigger t:
  kind: "a2a"
  target: "brokers://binding-warn/a2a"
  on_message: -> transition to @subagent.worker

subagent worker:
  description: "test"
  llm: @llm.g
  reasoning:
    instructions: -> go
    actions:
      invoke: @actions.my_tool
        with bar = "wrong"
  on_exit: -> transition to @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
`;
    const result = parseAndLintSource(source);
    expect(
      result.diagnostics.some(d => d.code === 'action-binding-undeclared-input')
    ).toBe(true);
  });
});

describe('unknown-block rules', () => {
  it('reports error for unknown top-level block', () => {
    const source = `
config:
  agent_name: "unknown-block-test"

foobar:
  something: "value"

trigger t:
  kind: "a2a"
  target: "brokers://unknown-block-test/a2a"
  on_message: -> transition to @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
`;
    const result = parseAndLintSource(source);
    const unknownErrors = result.diagnostics.filter(
      d => d.code === 'unknown-block'
    );
    expect(unknownErrors).toHaveLength(1);
    expect(unknownErrors[0].severity).toBe(1);
    expect(unknownErrors[0].message).toContain('foobar');
  });

  it('reports errors for multiple unknown top-level blocks', () => {
    const source = `
config:
  agent_name: "multi-unknown"

foo:
  x: "1"

bar:
  y: "2"

trigger t:
  kind: "a2a"
  target: "brokers://multi-unknown/a2a"
  on_message: -> transition to @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
`;
    const result = parseAndLintSource(source);
    const unknownErrors = result.diagnostics.filter(
      d => d.code === 'unknown-block'
    );
    expect(unknownErrors).toHaveLength(2);
    const messages = unknownErrors.map(d => d.message);
    expect(messages.some(m => m.includes('foo'))).toBe(true);
    expect(messages.some(m => m.includes('bar'))).toBe(true);
  });

  it('does not report unknown-block for valid blocks', () => {
    const source = `
config:
  agent_name: "all-valid"

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
  target: "brokers://all-valid/a2a"
  on_message: -> transition to @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
`;
    const result = parseAndLintSource(source);
    const unknownErrors = result.diagnostics.filter(
      d => d.code === 'unknown-block'
    );
    expect(unknownErrors).toHaveLength(0);
  });

  it('reports error for unknown field within a block', () => {
    const source = `
config:
  agent_name: "unknown-field-test"

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
  bogus_field: "should error"
`;
    const result = parseAndLintSource(source);
    const unknownFieldErrors = result.diagnostics.filter(
      d => d.code === 'unknown-field' && d.severity === 1
    );
    expect(unknownFieldErrors).toHaveLength(1);
    expect(unknownFieldErrors[0].message).toContain('bogus_field');
  });

  it('reports error for deprecated router.choices as unknown-field', () => {
    const source = `
config:
  agent_name: "deprecated-choices"

router r:
  choices:
    - target: @echo.done
      when: true

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
`;
    const result = parseAndLintSource(source);
    const unknownFieldErrors = result.diagnostics.filter(
      d => d.code === 'unknown-field' && d.severity === 1
    );
    expect(unknownFieldErrors.length).toBeGreaterThanOrEqual(1);
    expect(unknownFieldErrors.some(d => d.message.includes('choices'))).toBe(
      true
    );
  });

  it('reports terminal-requires-status-update when terminal node is not an echo', () => {
    const source = `
config:
  agent_name: "terminal-no-echo"

llm:
  g:
    target: "llm://conn"
    kind: "OpenAI"
    model: "gpt-4"

trigger t:
  kind: "a2a"
  target: "brokers://terminal-no-echo/a2a"
  on_message: -> transition to @subagent.s

subagent s:
  llm: @llm.g
  reasoning:
    instructions: -> do work
`;
    const result = parseAndLintSource(source);
    expect(
      result.diagnostics.some(d => d.code === 'terminal-requires-status-update')
    ).toBe(true);
  });

  it('reports terminal-requires-status-update when terminal echo has non-terminal state', () => {
    const source = `
config:
  agent_name: "non-terminal-state"

trigger t:
  kind: "a2a"
  target: "brokers://non-terminal-state/a2a"
  on_message: -> transition to @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_WORKING"
  message: "still going"
`;
    const result = parseAndLintSource(source);
    expect(
      result.diagnostics.some(d => d.code === 'terminal-requires-status-update')
    ).toBe(true);
  });

  it('does not report terminal-requires-status-update for valid terminal echo', () => {
    const source = `
config:
  agent_name: "valid-terminal"

trigger t:
  kind: "a2a"
  target: "brokers://valid-terminal/a2a"
  on_message: -> transition to @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
`;
    const result = parseAndLintSource(source);
    expect(
      result.diagnostics.some(d => d.code === 'terminal-requires-status-update')
    ).toBe(false);
  });

  it('does not report error when status echo is followed by another node', () => {
    const source = `
config:
  agent_name: "echo-then-more"

trigger t:
  kind: "a2a"
  target: "brokers://echo-then-more/a2a"
  on_message: -> transition to @echo.status

echo status:
  kind: "a2a:status_update_event"
  state: "TASK_STATE_COMPLETED"
  message: "done"
  on_exit: ->
    transition to @echo.artifact

echo artifact:
  kind: "a2a:artifact_update_event"
  artifact: a2a.artifact({name: "log", parts: [a2a.textPart("cleanup")]})
`;
    const result = parseAndLintSource(source);
    const relevant = result.diagnostics.filter(
      d => d.code === 'terminal-requires-status-update'
    );
    expect(relevant.length).toBe(0);
  });

  it('reports echo-invalid-state for invalid state value', () => {
    const source = `
config:
  agent_name: "bad-state"

trigger t:
  kind: "a2a"
  target: "brokers://bad-state/a2a"
  on_message: -> transition to @echo.done

echo done:
  kind: "a2a:status_update_event"
  state: "running"
  message: "ok"
`;
    const result = parseAndLintSource(source);
    expect(result.diagnostics.some(d => d.code === 'echo-invalid-state')).toBe(
      true
    );
  });

  it('reports unknown-variant for removed a2a:response kind', () => {
    const source = `
echo done:
  kind: "a2a:response"
  state: "TASK_STATE_COMPLETED"
  message: "ok"
`;
    const result = parseAndLintSource(source);
    expect(result.diagnostics.some(d => d.code === 'unknown-variant')).toBe(
      true
    );
  });
});
