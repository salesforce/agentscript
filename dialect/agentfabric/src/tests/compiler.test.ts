import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { parseDocument, toRecord } from './test-utils.js';
import { compile } from '../compiler/compile.js';
import { toPlainData } from '../compiler/utils.js';
import {
  ObjectTypes,
  type Definition,
} from '../compiler/unified-agent-specification.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

describe('AgentFabric Compiler', () => {
  it('compiles minimal strict syntax agent', () => {
    const source = `
config:
  agent_name: "minimal"

trigger t:
  kind: "a2a"
  target: "brokers://minimal/a2a"
  on_message: -> transition to @echo.done

echo done:
  kind: "a2a:response"
  message: "ok"
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));
    expect(result.diagnostics).toHaveLength(0);
    expect(result.output.unifiedAgentSpec.graph.nodes.length).toBeGreaterThan(
      0
    );
    expect(result.output.trigger?.kind).toBe('a2a');
  });

  it('compiles generator with prompt and outputs configuration', () => {
    const source = `
config:
  agent_name: "gen"

llm:
  g:
    target: "llm://openai"
    kind: "OpenAI"
    model: "gpt-4o-mini"

trigger t:
  kind: "a2a"
  target: "brokers://gen/a2a"
  on_message: -> transition to @generator.main

generator main:
  llm: @llm.g
  system:
    instructions: "You are helpful"
  prompt: -> Summarize
  outputs:
    properties:
      summary:
        type: "string"
  on_exit: -> transition to @echo.done

echo done:
  kind: "a2a:response"
  message: "ok"
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));
    expect(result.diagnostics).toHaveLength(0);
    const agentNode = result.output.unifiedAgentSpec.graph.nodes.find(
      n => n.name === 'main'
    );
    expect(agentNode).toBeDefined();
    expect(result.output.outputStructures).toHaveProperty('os_main');
  });

  it('compiles executor node with IdentityAction state updates', () => {
    const source = `
config:
  agent_name: "exec"

variables:
  status: mutable string = ""

trigger t:
  kind: "a2a"
  target: "brokers://exec/a2a"
  on_message: -> transition to @executor.step

executor step:
  do: ->
    set @variables.status = "done"
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));
    const node = result.output.unifiedAgentSpec.graph.nodes.find(
      n => n.name === 'step'
    ) as Record<string, unknown> | undefined;
    expect(node).toBeDefined();
    expect(node?.type).toBe(ObjectTypes.ACTION);
  });

  it('normalizes request headers and compiles case-insensitive header lookups', () => {
    const source = `
config:
  agent_name: "request-headers"

variables:
  h1: mutable string = ""
  h2: mutable string = ""

trigger t:
  kind: "a2a"
  target: "brokers://request-headers/a2a"
  on_message: -> transition to @executor.step

executor step:
  do: ->
    set @variables.h1 = @request.headers.Authorization
    set @variables.h2 = @request.headers["X-Request-Id"]
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));
    expect(result.diagnostics).toHaveLength(0);

    const node = result.output.unifiedAgentSpec.graph.nodes.find(
      n => n.name === 'step'
    ) as Record<string, unknown> | undefined;
    expect(node).toBeDefined();

    const onInit = (node?.['on-init'] as Array<Record<string, unknown>>) ?? [];
    const requestInitExpr = (((onInit[0]?.['state-updates'] as Array<
      Record<string, unknown>
    >) ?? [])[0]?.request ?? '') as string;
    expect(requestInitExpr).toBe("normalize_headers(variables['request'])");

    const tools = (node?.tools as Array<Record<string, unknown>>) ?? [];
    const stateUpdates = ((tools[0]?.['state-updates'] as Array<
      Record<string, unknown>
    >) ?? []) as Array<Record<string, unknown>>;
    const h1Expr = (stateUpdates.find(s => 'h1' in s)?.h1 ?? '') as string;
    const h2Expr = (stateUpdates.find(s => 'h2' in s)?.h2 ?? '') as string;

    expect(h1Expr).toBe("state.request.headers['authorization']");
    expect(h2Expr).toBe('state.request.headers[lower("X-Request-Id")]');
  });

  it('passes actions description and label into definitions and invokable clients', () => {
    const source = `
config:
  agent_name: "labels"

actions:
  my_a2a:
    label: "Billing tool"
    description: "Calls the billing A2A agent"
    target: "a2a://billing"
    kind: "a2a:send_message"
  my_mcp:
    label: "Article lookup"
    description: "Searches the knowledge base"
    target: "mcp://kb"
    kind: "mcp:tool"
    tool_name: "search"

trigger t:
  kind: "a2a"
  target: "brokers://labels/a2a"
  on_message: -> transition to @echo.done

echo done:
  kind: "a2a:response"
  message: "ok"
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));
    expect(result.diagnostics).toHaveLength(0);

    const a2aDef = result.output.unifiedAgentSpec.definitions?.find(
      (d: Definition) => d.name === 'my_a2a-action'
    ) as Record<string, unknown> | undefined;
    expect(a2aDef?.label).toBe('Billing tool');
    expect(a2aDef?.description).toBe('Calls the billing A2A agent');

    const mcpDef = result.output.unifiedAgentSpec.definitions?.find(
      (d: Definition) => d.name === 'my_mcp-action'
    ) as Record<string, unknown> | undefined;
    expect(mcpDef?.label).toBe('Article lookup');
    expect(mcpDef?.description).toBe('Searches the knowledge base');

    const mcpClient = result.output.invokableClients.find(
      c => c.name === 'my_mcp-client'
    ) as Record<string, unknown> | undefined;
    expect(mcpClient?.label).toBe('Article lookup');
    expect((mcpClient?.metadata as Record<string, unknown>)?.description).toBe(
      'Searches the knowledge base'
    );

    const a2aClient = result.output.invokableClients.find(
      c => c.name === 'my_a2a-client'
    ) as Record<string, unknown> | undefined;
    expect(a2aClient?.label).toBe('Billing tool');
    expect((a2aClient?.metadata as Record<string, unknown>)?.description).toBe(
      'Calls the billing A2A agent'
    );
  });

  it('compiles http_headers passed via with binding in subagent actions', () => {
    const source = `
config:
  agent_name: "with-headers"

llm:
  g:
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

trigger t:
  kind: "a2a"
  target: "brokers://with-headers/a2a"
  on_message: -> transition to @subagent.worker

subagent worker:
  description: "uses actions with http_headers via with binding"
  llm: @llm.g
  reasoning:
    instructions: -> onboard new hires
    actions:
      my_hr: @actions.hr_agent
        with http_headers = {"Authorization": "Bearer token123", "X-CorrelationId": "corr-456"}
      slack: @actions.send_slack
        with http_headers = {"X-Slack-Token": "slack-secret"}
  on_exit: -> transition to @echo.done

echo done:
  kind: "a2a:response"
  message: "ok"
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));
    expect(result.diagnostics).toHaveLength(0);

    const hrClient = result.output.invokableClients.find(
      c => c.name === 'hr_agent-client'
    ) as Record<string, unknown> | undefined;
    const slackClient = result.output.invokableClients.find(
      c => c.name === 'send_slack-client'
    ) as Record<string, unknown> | undefined;

    expect(hrClient).toBeDefined();
    expect(slackClient).toBeDefined();

    const workerNode = result.output.unifiedAgentSpec.graph.nodes.find(
      n => n.name === 'worker'
    ) as Record<string, unknown> | undefined;
    expect(workerNode).toBeDefined();
    const tools = (workerNode?.tools as Array<Record<string, unknown>>) ?? [];
    expect(tools.length).toBeGreaterThan(0);

    const hrTool = tools.find(t => t.ref === 'hr_agent-client');
    expect(hrTool).toBeDefined();
    const hrBindings = (hrTool?.['bound-inputs'] ?? {}) as Record<
      string,
      unknown
    >;
    const hrHeaders = hrBindings.http_headers as string;
    expect(hrHeaders).toBeDefined();
    expect(hrHeaders).toContain('"authorization"');
    expect(hrHeaders).not.toMatch(/"Authorization"/);
    expect(hrHeaders).toContain('"x-correlationid"');
    expect(hrHeaders).not.toMatch(/"X-CorrelationId"/);

    const slackTool = tools.find(t => t.ref === 'send_slack-client');
    expect(slackTool).toBeDefined();
    const slackBindings = (slackTool?.['bound-inputs'] ?? {}) as Record<
      string,
      unknown
    >;
    const slackHeaders = slackBindings.http_headers as string;
    expect(slackHeaders).toBeDefined();
    expect(slackHeaders).toContain('"x-slack-token"');
    expect(slackHeaders).not.toMatch(/"X-Slack-Token"/);
  });

  it('compiles http_headers with embedded expression references', () => {
    const source = `
config:
  agent_name: "expr-headers"

llm:
  g:
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

trigger t:
  kind: "a2a"
  target: "brokers://expr-headers/a2a"
  on_message: -> transition to @subagent.worker

subagent worker:
  description: "uses actions with expression headers via with binding"
  llm: @llm.g
  reasoning:
    instructions: -> onboard new hires
    actions:
      my_hr: @actions.hr_agent
        with http_headers = {"Authorization": @request.headers.authorization, "X-CorrelationId": @variables.conversationId}
      slack: @actions.send_slack
        with http_headers = {"X-Static-Key": "static-value"}
  on_exit: -> transition to @echo.done

echo done:
  kind: "a2a:response"
  message: "ok"
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));

    expect(result.diagnostics).toHaveLength(0);

    const workerNode = result.output.unifiedAgentSpec.graph.nodes.find(
      n => n.name === 'worker'
    ) as Record<string, unknown> | undefined;
    expect(workerNode).toBeDefined();
    const tools = (workerNode?.tools as Array<Record<string, unknown>>) ?? [];
    expect(tools).toHaveLength(2);

    const hrTool = tools.find(t => t.ref === 'hr_agent-client');
    const slackTool = tools.find(t => t.ref === 'send_slack-client');
    expect(hrTool).toBeDefined();
    expect(slackTool).toBeDefined();

    const hrBindings = (hrTool?.['bound-inputs'] ?? {}) as Record<
      string,
      unknown
    >;
    const hrHttpHeaders = hrBindings.http_headers as string;
    expect(hrHttpHeaders).toBeDefined();
    expect(hrHttpHeaders).toContain('"authorization"');
    expect(hrHttpHeaders).not.toMatch(/"Authorization"/);
    expect(hrHttpHeaders).toContain('"x-correlationid"');
    expect(hrHttpHeaders).not.toMatch(/"X-CorrelationId"/);

    const slackBindings = (slackTool?.['bound-inputs'] ?? {}) as Record<
      string,
      unknown
    >;
    const slackHttpHeaders = slackBindings.http_headers as string;
    expect(slackHttpHeaders).toBeDefined();
    expect(slackHttpHeaders).toContain('"x-static-key"');
    expect(slackHttpHeaders).not.toMatch(/"X-Static-Key"/);
    expect(slackHttpHeaders).toContain('static-value');
  });

  it('slot-fills all declared action inputs by default without explicit ...', () => {
    const source = `
config:
  agent_name: "slot-default"

llm:
  g:
    target: "llm://openai"
    kind: "OpenAI"
    model: "gpt-4o-mini"

actions:
  slot_tool:
    target: "mcp://conn"
    kind: "mcp:tool"
    tool_name: "tool"
    inputs:
      foo: {}
      bar: {}

trigger t:
  kind: "a2a"
  target: "brokers://slot-default/a2a"
  on_message: -> transition to @subagent.worker

subagent worker:
  description: "slot-fill default"
  llm: @llm.g
  reasoning:
    instructions: -> use tools
    actions:
      invoke: @actions.slot_tool
  on_exit: -> transition to @echo.done

echo done:
  kind: "a2a:response"
  message: "ok"
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));
    expect(result.diagnostics).toHaveLength(0);

    const workerNode = result.output.unifiedAgentSpec.graph.nodes.find(
      n => n.name === 'worker'
    ) as Record<string, unknown> | undefined;
    expect(workerNode).toBeDefined();
    const tools = (workerNode?.tools as Array<Record<string, unknown>>) ?? [];
    const tool = tools.find(t => t.ref === 'slot_tool-client');
    expect(tool).toBeDefined();
    expect(tool?.['bound-inputs']).toBeUndefined();
    expect(tool?.['llm-inputs']).toEqual(['foo', 'bar']);
  });

  it('respects bound action parameters and slot-fills only unbound declared inputs', () => {
    const source = `
config:
  agent_name: "slot-mixed"

llm:
  g:
    target: "llm://openai"
    kind: "OpenAI"
    model: "gpt-4o-mini"

actions:
  slot_tool:
    target: "mcp://conn"
    kind: "mcp:tool"
    tool_name: "tool"
    inputs:
      foo: {}
      bar: {}

trigger t:
  kind: "a2a"
  target: "brokers://slot-mixed/a2a"
  on_message: -> transition to @subagent.worker

subagent worker:
  description: "bound + slot-fill"
  llm: @llm.g
  reasoning:
    instructions: -> use tools
    actions:
      invoke: @actions.slot_tool
        with foo = "bound-val"
      redundant: @actions.slot_tool
        with foo = "x"
        with bar = ...
  on_exit: -> transition to @echo.done

echo done:
  kind: "a2a:response"
  message: "ok"
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));
    expect(result.diagnostics).toHaveLength(0);

    const workerNode = result.output.unifiedAgentSpec.graph.nodes.find(
      n => n.name === 'worker'
    ) as Record<string, unknown> | undefined;
    const tools = (workerNode?.tools as Array<Record<string, unknown>>) ?? [];
    const slotTools = tools.filter(t => t.ref === 'slot_tool-client');
    expect(slotTools).toHaveLength(2);

    expect(
      slotTools.some(
        t =>
          (t['bound-inputs'] as Record<string, string> | undefined)?.foo ===
            '"bound-val"' &&
          (t['llm-inputs'] as string[] | undefined)?.join() === 'bar'
      )
    ).toBe(true);
    expect(
      slotTools.some(
        t =>
          (t['bound-inputs'] as Record<string, string> | undefined)?.foo ===
            '"x"' && (t['llm-inputs'] as string[] | undefined)?.join() === 'bar'
      )
    ).toBe(true);
  });

  it('does not infer llm-inputs when actions omits inputs', () => {
    const source = `
config:
  agent_name: "no-inputs-def"

llm:
  g:
    target: "llm://openai"
    kind: "OpenAI"
    model: "gpt-4o-mini"

actions:
  bare_tool:
    target: "mcp://conn"
    kind: "mcp:tool"
    tool_name: "tool"

trigger t:
  kind: "a2a"
  target: "brokers://no-inputs-def/a2a"
  on_message: -> transition to @subagent.worker

subagent worker:
  description: "no inputs block"
  llm: @llm.g
  reasoning:
    instructions: -> use tools
    actions:
      invoke: @actions.bare_tool
  on_exit: -> transition to @echo.done

echo done:
  kind: "a2a:response"
  message: "ok"
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));
    expect(result.diagnostics).toHaveLength(0);

    const workerNode = result.output.unifiedAgentSpec.graph.nodes.find(
      n => n.name === 'worker'
    ) as Record<string, unknown> | undefined;
    const tools = (workerNode?.tools as Array<Record<string, unknown>>) ?? [];
    const tool = tools.find(t => t.ref === 'bare_tool-client');
    expect(tool).toBeDefined();
    expect(tool?.['llm-inputs']).toBeUndefined();
    expect(tool?.['bound-inputs']).toBeUndefined();
  });

  it('compiles echo label and description onto the graph action node', () => {
    const source = `
config:
  agent_name: "echo-meta"

trigger t:
  kind: "a2a"
  target: "brokers://echo-meta/a2a"
  on_message: -> transition to @echo.reply

echo reply:
  kind: "a2a:response"
  label: "Reply node"
  description: "Sends the final reply to the client."
  message: "ok"
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));
    expect(result.diagnostics).toHaveLength(0);

    const echoNode = result.output.unifiedAgentSpec.graph.nodes.find(
      n => n.name === 'reply'
    ) as Record<string, unknown> | undefined;
    expect(echoNode).toBeDefined();
    expect(echoNode?.label).toBe('Reply node');
    expect(echoNode?.description).toBe('Sends the final reply to the client.');
  });

  it('accepts router syntax with routes and otherwise', () => {
    const source = `
config:
  agent_name: "router"

trigger t:
  kind: "a2a"
  target: "brokers://router/a2a"
  on_message: -> transition to @router.main

router main:
  routes:
    - target: @echo.a
      when: @request.payload.kind == "a"
  otherwise:
    target: @echo.b

echo a:
  kind: "a2a:response"
  message: "a"

echo b:
  kind: "a2a:response"
  message: "b"
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));
    expect(result.diagnostics).toHaveLength(0);
    expect(result.output.unifiedAgentSpec.graph.nodes.length).toBeGreaterThan(
      0
    );
  });

  it('compiles echo task expression with a2a namespace functions to a2a_ underscore form', () => {
    const source = `
config:
  agent_name: "echo-task"

variables:
  msg: mutable string = ""

trigger t:
  kind: "a2a"
  target: "brokers://echo-task/a2a"
  on_message: -> transition to @echo.reply

echo reply:
  kind: "a2a:response"
  task: a2a.task({state:"completed",message:a2a.message({parts:[a2a.textPart("hello")]})})
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));
    expect(result.diagnostics).toHaveLength(0);

    const echoNode = result.output.unifiedAgentSpec.graph.nodes.find(
      n => n.name === 'reply'
    ) as Record<string, unknown> | undefined;
    expect(echoNode).toBeDefined();

    const tools = (echoNode?.tools as Array<Record<string, unknown>>) ?? [];
    const stateUpdates =
      (tools[0]?.['state-updates'] as Array<Record<string, unknown>>) ?? [];
    const taskValue = stateUpdates.find(s => '__reply_value' in s)
      ?.__reply_value as string;
    expect(taskValue).toBeDefined();
    expect(taskValue).not.toContain('template::');
    expect(taskValue).toContain('a2a_task(');
    expect(taskValue).toContain('a2a_message(');
    expect(taskValue).toContain('a2a_textPart(');
    expect(taskValue).toContain('state=');
    expect(taskValue).toContain('message=');
    expect(taskValue).toContain('parts=');
    expect(taskValue).not.toContain('{state');
  });

  it('compiles a2a.X() without @ prefix to a2a_X() in executor expressions', () => {
    const source = `
config:
  agent_name: "a2a-no-at"

variables:
  result: mutable string = ""

trigger t:
  kind: "a2a"
  target: "brokers://a2a-no-at/a2a"
  on_message: -> transition to @executor.step

executor step:
  do: ->
    set @variables.result = a2a.message(a2a.textPart("test"))
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));

    const node = result.output.unifiedAgentSpec.graph.nodes.find(
      n => n.name === 'step'
    ) as Record<string, unknown> | undefined;
    expect(node).toBeDefined();

    const tools = (node?.tools as Array<Record<string, unknown>>) ?? [];
    const stateUpdates =
      (tools[0]?.['state-updates'] as Array<Record<string, unknown>>) ?? [];
    const expr = stateUpdates.find(s => 'result' in s)?.result as string;
    expect(expr).toContain('a2a_message(');
    expect(expr).toContain('a2a_textPart(');
    expect(expr).not.toContain('a2a.message');
    expect(expr).not.toContain('a2a.textPart');
  });

  it('compiles executor with uuid() function call', () => {
    const source = `
config:
  agent_name: "fn-call"

variables:
  id: mutable string = ""

trigger t:
  kind: "a2a"
  target: "brokers://fn-call/a2a"
  on_message: -> transition to @executor.step

executor step:
  do: ->
    set @variables.id = uuid()
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));

    const node = result.output.unifiedAgentSpec.graph.nodes.find(
      n => n.name === 'step'
    ) as Record<string, unknown> | undefined;
    expect(node).toBeDefined();

    const tools = (node?.tools as Array<Record<string, unknown>>) ?? [];
    const stateUpdates =
      (tools[0]?.['state-updates'] as Array<Record<string, unknown>>) ?? [];
    const idExpr = stateUpdates.find(s => 'id' in s)?.id as string;
    expect(idExpr).toBe('uuid()');
  });

  it('matches compiled YAML for customer-support-netwrok example fixture', async () => {
    const agentPath = resolve(
      __dirname,
      './resources/agentfabric-customer-support-netwrok.agent'
    );
    const snapshotPath = resolve(
      __dirname,
      './resources/agentfabric-customer-support-netwrok.yaml'
    );
    const source = readFileSync(agentPath, 'utf8');

    const ast = parseDocument(source);
    const result = compile(toRecord(ast));
    expect(result.diagnostics).toHaveLength(0);

    await expect(YAML.stringify(result.output)).toMatchFileSnapshot(
      snapshotPath
    );
  });

  it('compiles @echo.<name>.input to state._node_input in echo task expression', () => {
    const source = `
config:
  agent_name: "input-ref"

trigger t:
  kind: "a2a"
  target: "brokers://input-ref/a2a"
  on_message: -> transition to @echo.reply

echo reply:
  kind: "a2a:response"
  task: a2a.task({state:"completed",message:a2a.message({parts:[a2a.textPart(@echo.reply.input)]})})
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));
    expect(result.diagnostics).toHaveLength(0);

    const echoNode = result.output.unifiedAgentSpec.graph.nodes.find(
      n => n.name === 'reply'
    ) as Record<string, unknown> | undefined;
    expect(echoNode).toBeDefined();

    const tools = (echoNode?.tools as Array<Record<string, unknown>>) ?? [];
    const stateUpdates =
      (tools[0]?.['state-updates'] as Array<Record<string, unknown>>) ?? [];
    const taskValue = stateUpdates.find(s => '__reply_value' in s)
      ?.__reply_value as string;
    expect(taskValue).toBeDefined();
    expect(taskValue).toContain('state._node_input');
  });

  it('compiles @executor.<name>.input to state._node_input in executor do expression', () => {
    const source = `
config:
  agent_name: "exec-input"

variables:
  result: mutable string = ""

trigger t:
  kind: "a2a"
  target: "brokers://exec-input/a2a"
  on_message: -> transition to @executor.step

executor step:
  do: ->
    set @variables.result = @executor.step.input
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));

    const node = result.output.unifiedAgentSpec.graph.nodes.find(
      n => n.name === 'step'
    ) as Record<string, unknown> | undefined;
    expect(node).toBeDefined();

    const tools = (node?.tools as Array<Record<string, unknown>>) ?? [];
    const stateUpdates =
      (tools[0]?.['state-updates'] as Array<Record<string, unknown>>) ?? [];
    const expr = stateUpdates.find(s => 'result' in s)?.result as string;
    expect(expr).toBe('state._node_input');
  });

  it('parses and compiles echo node with spread expression in task field', () => {
    const source = `
config:
  agent_name: "spread_test"

trigger t:
  kind: "a2a"
  target: "brokers://spread_test/a2a"
  on_message: -> transition to @echo.a2a_response

echo a2a_response:
  kind: "a2a:response"
  task: a2a_parts(*@variables.artifacts)
  message: "ok"
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));
    // Compilation should succeed without errors
    expect(
      result.diagnostics.filter(d => d.severity === 1 /* error */)
    ).toHaveLength(0);

    // Verify the parsed task expression round-trips through toPlainData
    const echoEntries = ast.echo as unknown as Map<
      string,
      Record<string, unknown>
    >;
    const responseEntry = echoEntries.get('a2a_response')!;
    expect(responseEntry).toBeDefined();

    const taskPlain = toPlainData(responseEntry.task);
    expect(taskPlain).toBe('a2a_parts(*@variables.artifacts)');
  });

  it('parses echo node with spread inside list literal in task field', () => {
    const source = `
config:
  agent_name: "spread_list_test"

trigger t:
  kind: "a2a"
  target: "brokers://spread_list_test/a2a"
  on_message: -> transition to @echo.resp

echo resp:
  kind: "a2a:response"
  task: make_list([*@variables.parts, "extra"])
  message: "ok"
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));
    expect(
      result.diagnostics.filter(d => d.severity === 1 /* error */)
    ).toHaveLength(0);

    const echoEntries = ast.echo as unknown as Map<
      string,
      Record<string, unknown>
    >;
    const responseEntry = echoEntries.get('resp')!;
    expect(responseEntry).toBeDefined();

    const taskPlain = toPlainData(responseEntry.task);
    expect(taskPlain).toBe('make_list([*@variables.parts, "extra"])');
  });

  it('emits ActionDefinition for mcp:tool actions so executor nodes can resolve refs', () => {
    const source = `
config:
  agent_name: "mcp-executor"

actions:
  lookup:
    label: "KB Lookup"
    description: "Searches knowledge base articles"
    target: "mcp://kb_connection"
    kind: "mcp:tool"
    tool_name: "search_articles"

variables:
  query: mutable string = ""

trigger t:
  kind: "a2a"
  target: "brokers://mcp-executor/a2a"
  on_message: -> transition to @executor.run_lookup

executor run_lookup:
  do: ->
    run @actions.lookup
      with query = @variables.query
  on_exit: -> transition to @echo.done

echo done:
  kind: "a2a:response"
  message: "ok"
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));
    expect(result.diagnostics).toHaveLength(0);

    const mcpDef = result.output.unifiedAgentSpec.definitions?.find(
      (d: Definition) => d.name === 'lookup-action'
    ) as Record<string, unknown> | undefined;
    expect(mcpDef).toBeDefined();
    expect(mcpDef?.type).toBe(ObjectTypes.ACTION);
    expect(mcpDef?.client).toBe('lookup-client');
    expect(mcpDef?.label).toBe('KB Lookup');
    expect(mcpDef?.description).toBe('Searches knowledge base articles');
    expect(mcpDef?.['invocation-target-type']).toBe('mcp');
    expect(mcpDef?.['invocation-target-name']).toBe('search_articles');

    const metadata = mcpDef?.metadata as Record<string, unknown> | undefined;
    expect(metadata?.protocol).toBe('mcp');
    expect(metadata?.connection).toBe('kb_connection');
    expect(metadata?.tool_name).toBe('search_articles');

    const executorNode = result.output.unifiedAgentSpec.graph.nodes.find(
      n => n.name === 'run_lookup'
    ) as Record<string, unknown> | undefined;
    expect(executorNode).toBeDefined();
    const tools = (executorNode?.tools as Array<Record<string, unknown>>) ?? [];
    const toolRef = tools.find(t => t.ref === 'lookup-action');
    expect(toolRef).toBeDefined();
    expect(toolRef?.type).toBe(ObjectTypes.ACTION);
  });

  it('matches compiled YAML for it-help-investigation fixture', async () => {
    const agentPath = resolve(
      __dirname,
      './resources/it-help-investigation.agent'
    );
    const snapshotPath = resolve(
      __dirname,
      './resources/it-help-investigation.yaml'
    );
    const source = readFileSync(agentPath, 'utf8');

    const ast = parseDocument(source);
    const result = compile(toRecord(ast));
    expect(result.diagnostics).toHaveLength(0);

    await expect(YAML.stringify(result.output)).toMatchFileSnapshot(
      snapshotPath
    );
  });

  it('emits ActionDefinition for mcp:tool with correct defaults when label/description are omitted', () => {
    const source = `
config:
  agent_name: "mcp-defaults"

actions:
  my_tool:
    target: "mcp://server"
    kind: "mcp:tool"
    tool_name: "do_thing"

trigger t:
  kind: "a2a"
  target: "brokers://mcp-defaults/a2a"
  on_message: -> transition to @echo.done

echo done:
  kind: "a2a:response"
  message: "ok"
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));
    expect(result.diagnostics).toHaveLength(0);

    const mcpDef = result.output.unifiedAgentSpec.definitions?.find(
      (d: Definition) => d.name === 'my_tool-action'
    ) as Record<string, unknown> | undefined;
    expect(mcpDef).toBeDefined();
    expect(mcpDef?.label).toBe('my_tool-action');
    expect(mcpDef?.description).toBe('MCP tool: my_tool');
    expect(mcpDef?.['invocation-target-name']).toBe('do_thing');
  });

  it('lowercases http_headers keys in executor run blocks', () => {
    const source = `
config:
  agent_name: "exec-headers"

llm:
  g:
    target: "llm://openai"
    kind: "OpenAI"
    model: "gpt-4o-mini"

actions:
  billing_agent:
    target: "a2a://billing_connection"
    kind: "a2a:send_message"

trigger t:
  kind: "a2a"
  target: "brokers://exec-headers/a2a"
  on_message: -> transition to @executor.run_billing

executor run_billing:
  do:
    run @actions.billing_agent
      with http_headers = {"X-API-Key": "key-123", "Authorization": "Bearer exec-token"}
  on_exit: -> transition to @echo.done

echo done:
  kind: "a2a:response"
  message: "ok"
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));
    expect(result.diagnostics).toHaveLength(0);

    const runNode = result.output.unifiedAgentSpec.graph.nodes.find(
      n => n.name === 'run_billing'
    ) as Record<string, unknown> | undefined;
    expect(runNode).toBeDefined();
    const tools = (runNode?.tools as Array<Record<string, unknown>>) ?? [];
    expect(tools.length).toBeGreaterThan(0);

    const billingTool = tools.find(t =>
      (t.ref as string)?.includes('billing_agent')
    );
    expect(billingTool).toBeDefined();
    const bindings = (billingTool?.['bound-inputs'] ?? {}) as Record<
      string,
      unknown
    >;
    const headers = bindings.http_headers as string;
    expect(headers).toBeDefined();
    expect(headers).toContain('"x-api-key"');
    expect(headers).not.toMatch(/"X-API-Key"/);
    expect(headers).toContain('"authorization"');
    expect(headers).not.toMatch(/"Authorization"/);
  });

  it('does not warn when with params match declared inputs', () => {
    const source = `
config:
  agent_name: "lint-ok"

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
      bar: {}

trigger t:
  kind: "a2a"
  target: "brokers://lint-ok/a2a"
  on_message: -> transition to @subagent.worker

subagent worker:
  description: "lint ok"
  llm: @llm.g
  reasoning:
    instructions: -> go
    actions:
      invoke: @actions.my_tool
        with foo = "value_a"
        with bar = "value_b"
  on_exit: -> transition to @echo.done

echo done:
  kind: "a2a:response"
  message: "ok"
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));
    expect(result.diagnostics).toHaveLength(0);
  });

  it('does not warn when http_headers is used without being declared in inputs', () => {
    const source = `
config:
  agent_name: "lint-implicit"

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

trigger t:
  kind: "a2a"
  target: "brokers://lint-implicit/a2a"
  on_message: -> transition to @subagent.worker

subagent worker:
  description: "implicit http_headers"
  llm: @llm.g
  reasoning:
    instructions: -> go
    actions:
      invoke: @actions.my_tool
        with http_headers = {"X-Token": "abc"}
  on_exit: -> transition to @echo.done

echo done:
  kind: "a2a:response"
  message: "ok"
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));
    expect(result.diagnostics).toHaveLength(0);
  });

  it('wraps system.node_outputs attribute access with parse_json in router enabled conditions', () => {
    const source = `
config:
  agent_name: "routing"

trigger t:
  kind: "a2a"
  target: "brokers://routing/a2a"
  on_message: -> transition to @subagent.classify

llm:
  g:
    target: "llm://openai"
    kind: "OpenAI"
    model: "gpt-4o-mini"

subagent classify:
  description: "classify"
  llm: @llm.g
  reasoning:
    instructions: -> classify
  on_exit: -> transition to @router.route

router route:
  routes:
    - target: @echo.billing
      when: @subagent.classify.output.category == "billing"
    - target: @echo.tech
      when: @subagent.classify.output.category == "technical"
  otherwise:
    target: @echo.general

echo billing:
  kind: "a2a:response"
  message: "billing"

echo tech:
  kind: "a2a:response"
  message: "tech"

echo general:
  kind: "a2a:response"
  message: "general"
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));
    expect(result.diagnostics).toHaveLength(0);

    const routerNode = result.output.unifiedAgentSpec.graph.nodes.find(
      n => n.name === 'route'
    ) as Record<string, unknown> | undefined;
    expect(routerNode).toBeDefined();

    const onExit = routerNode?.['on-exit'] as
      | Array<Record<string, unknown>>
      | undefined;
    expect(onExit).toBeDefined();
    expect(onExit!.length).toBeGreaterThanOrEqual(2);

    expect(onExit![0].enabled).toBe(
      'parse_json(system.node_outputs[\'classify\']).category == "billing"'
    );
    expect(onExit![1].enabled).toBe(
      'parse_json(system.node_outputs[\'classify\']).category == "technical"'
    );
  });

  it('preserves hyphens in router when conditions using bracket access', () => {
    const source = `
config:
  agent_name: "header-router"

trigger t:
  kind: "a2a"
  target: "brokers://header-router/a2a"
  on_message: -> transition to @router.check

router check:
  routes:
    - target: @echo.slack
      when: @request.headers["Slack-UUID"] != ""
  otherwise:
    target: @echo.fallback

echo slack:
  kind: "a2a:response"
  message: "slack"

echo fallback:
  kind: "a2a:response"
  message: "fallback"
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));
    expect(result.diagnostics).toHaveLength(0);

    const routerNode = result.output.unifiedAgentSpec.graph.nodes.find(
      n => n.name === 'check'
    ) as Record<string, unknown> | undefined;
    expect(routerNode).toBeDefined();

    const onExit = routerNode?.['on-exit'] as
      | Array<Record<string, unknown>>
      | undefined;
    expect(onExit).toBeDefined();

    expect(onExit![0].enabled).toBe(
      'state.request.headers[lower("Slack-UUID")] != ""'
    );
  });

  it('wraps system.node_outputs attribute access with parse_json in executor bound-inputs', () => {
    const source = `
config:
  agent_name: "bound"

trigger t:
  kind: "a2a"
  target: "brokers://bound/a2a"
  on_message: -> transition to @subagent.analyze

llm:
  g:
    target: "llm://openai"
    kind: "OpenAI"
    model: "gpt-4o-mini"

subagent analyze:
  description: "analyze"
  llm: @llm.g
  reasoning:
    instructions: -> analyze
  on_exit: -> transition to @executor.step

actions:
  my_tool:
    kind: "mcp:tool"
    connection: "conn"
    tool_name: "do_something"
    inputs:
      ticket_id:
        type: "string"

executor step:
  do: ->
    run @actions.my_tool
      with ticket_id = @subagent.analyze.output.ticket_id
  on_exit: -> transition to @echo.done

echo done:
  kind: "a2a:response"
  message: "ok"
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));
    expect(result.diagnostics).toHaveLength(0);

    const execNode = result.output.unifiedAgentSpec.graph.nodes.find(
      n => n.name === 'step'
    ) as Record<string, unknown> | undefined;
    expect(execNode).toBeDefined();

    const tools = (execNode?.tools as Array<Record<string, unknown>>) ?? [];
    const actionTool = tools.find(t => t.ref === 'my_tool-action');
    expect(actionTool).toBeDefined();

    const boundInputs = actionTool?.['bound-inputs'] as
      | Record<string, string>
      | undefined;
    expect(boundInputs).toBeDefined();
    expect(boundInputs!.ticket_id).toBe(
      "parse_json(system.node_outputs['analyze']).ticket_id"
    );
  });

  it('does not wrap bare system.node_outputs references without attribute access', () => {
    const source = `
config:
  agent_name: "bare"

trigger t:
  kind: "a2a"
  target: "brokers://bare/a2a"
  on_message: -> transition to @subagent.agent

llm:
  g:
    target: "llm://openai"
    kind: "OpenAI"
    model: "gpt-4o-mini"

subagent agent:
  description: "agent"
  llm: @llm.g
  reasoning:
    instructions: -> do it
  on_exit: -> transition to @echo.reply

echo reply:
  kind: "a2a:response"
  message: "{{@subagent.agent.output}}"
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));
    expect(result.diagnostics).toHaveLength(0);

    const echoNode = result.output.unifiedAgentSpec.graph.nodes.find(
      n => n.name === 'reply'
    ) as Record<string, unknown> | undefined;
    expect(echoNode).toBeDefined();

    const tools = (echoNode?.tools as Array<Record<string, unknown>>) ?? [];
    const identityTool = tools.find(t => t.ref === 'IdentityAction');
    expect(identityTool).toBeDefined();

    const stateUpdates = identityTool?.['state-updates'] as
      | Array<Record<string, string>>
      | undefined;
    expect(stateUpdates).toBeDefined();

    const valueUpdate = stateUpdates![0];
    const valueStr = Object.values(valueUpdate)[0];
    expect(valueStr).toContain("system.node_outputs['agent']");
    expect(valueStr).not.toContain('parse_json');
  });

  it('injects _handoff_source breadcrumb on generator after-reasoning handoff', () => {
    const source = `
config:
  agent_name: "gen-breadcrumb"

llm:
  default:
    target: "llm://conn"
    kind: "OpenAI"
    model: "gpt-4"

trigger t:
  kind: "a2a"
  target: "brokers://gen-breadcrumb/a2a"
  on_message: -> transition to @generator.step

generator step:
  llm: @llm.default
  prompt: -> | hello
  on_exit: ->
    transition to @echo.done

echo done:
  kind: "a2a:response"
  message: "ok"
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));
    expect(result.diagnostics).toHaveLength(0);

    const genNode = result.output.unifiedAgentSpec.graph.nodes.find(
      n => n.name === 'step'
    ) as Record<string, unknown> | undefined;
    expect(genNode).toBeDefined();
    expect(genNode!.type).toBe(ObjectTypes.AGENT);

    const afterReasoning = genNode!['after-reasoning'] as Array<
      Record<string, unknown>
    >;
    expect(afterReasoning).toBeDefined();
    expect(afterReasoning).toHaveLength(1);

    const handoff = afterReasoning[0];
    expect(handoff.type).toBe('handoff');
    expect(handoff.target).toBe('done');

    const stateUpdates = handoff['state-updates'] as Array<
      Record<string, string>
    >;
    expect(stateUpdates).toBeDefined();
    expect(stateUpdates).toContainEqual({ _handoff_source: "'step'" });
  });

  it('injects _handoff_source breadcrumb on executor on-exit handoff', () => {
    const source = `
config:
  agent_name: "exec-breadcrumb"

actions:
  tool1:
    target: "mcp://conn"
    kind: "mcp:tool"
    tool_name: "do_thing"

trigger t:
  kind: "a2a"
  target: "brokers://exec-breadcrumb/a2a"
  on_message: -> transition to @executor.step

executor step:
  do: ->
    run @actions.tool1
  on_exit: ->
    transition to @echo.done

echo done:
  kind: "a2a:response"
  message: "ok"
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));
    expect(result.diagnostics).toHaveLength(0);

    const execNode = result.output.unifiedAgentSpec.graph.nodes.find(
      n => n.name === 'step'
    ) as Record<string, unknown> | undefined;
    expect(execNode).toBeDefined();

    const onExit = execNode!['on-exit'] as Array<Record<string, unknown>>;
    expect(onExit).toBeDefined();
    expect(onExit).toHaveLength(1);

    const handoff = onExit[0];
    expect(handoff.type).toBe('handoff');
    const stateUpdates = handoff['state-updates'] as Array<
      Record<string, string>
    >;
    expect(stateUpdates).toContainEqual({ _handoff_source: "'step'" });
  });

  it('does not inject _handoff_source on non-producing nodes', () => {
    const source = `
config:
  agent_name: "no-breadcrumb"

trigger t:
  kind: "a2a"
  target: "brokers://no-breadcrumb/a2a"
  on_message: -> transition to @router.decide

router decide:
  routes:
    - target: @echo.a
      when: "true"
  otherwise:
    target: @echo.b

echo a:
  kind: "a2a:response"
  message: "a"

echo b:
  kind: "a2a:response"
  message: "b"
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));
    expect(result.diagnostics).toHaveLength(0);

    const routerNode = result.output.unifiedAgentSpec.graph.nodes.find(
      n => n.name === 'decide'
    ) as Record<string, unknown> | undefined;
    expect(routerNode).toBeDefined();

    const onExit = routerNode!['on-exit'] as Array<Record<string, unknown>>;
    expect(onExit).toBeDefined();
    for (const handoff of onExit) {
      expect(handoff['state-updates']).toBeUndefined();
    }
  });

  it('prepends on-init _node_input lookup when node references state._node_input', () => {
    const source = `
config:
  agent_name: "on-init-lookup"

llm:
  default:
    target: "llm://conn"
    kind: "OpenAI"
    model: "gpt-4"

trigger t:
  kind: "a2a"
  target: "brokers://on-init-lookup/a2a"
  on_message: -> transition to @generator.gen

generator gen:
  llm: @llm.default
  prompt: -> | hello
  on_exit: ->
    transition to @echo.reply

echo reply:
  kind: "a2a:response"
  task: a2a.task({state:"completed",message:a2a.message({parts:[a2a.textPart(@echo.reply.input)]})})
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));
    expect(result.diagnostics).toHaveLength(0);

    const echoNode = result.output.unifiedAgentSpec.graph.nodes.find(
      n => n.name === 'reply'
    ) as Record<string, unknown> | undefined;
    expect(echoNode).toBeDefined();

    const onInit = echoNode!['on-init'] as Array<Record<string, unknown>>;
    expect(onInit).toBeDefined();
    expect(onInit.length).toBeGreaterThanOrEqual(1);

    const lookup = onInit[0];
    expect(lookup.type).toBe('action');
    expect(lookup.ref).toBe('IdentityAction');
    const updates = lookup['state-updates'] as Array<Record<string, string>>;
    expect(updates).toContainEqual({
      _node_input: "get(system.node_outputs, state._handoff_source, '')",
    });
  });

  it('places _node_input lookup before normalize_headers on initial node', () => {
    const source = `
config:
  agent_name: "init-order"

llm:
  default:
    target: "llm://conn"
    kind: "OpenAI"
    model: "gpt-4"

trigger t:
  kind: "a2a"
  target: "brokers://init-order/a2a"
  on_message: ->
    transition to @echo.first

echo first:
  kind: "a2a:response"
  task: a2a.task({state:"completed",message:a2a.message({parts:[a2a.textPart(@echo.first.input)]})})
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));
    expect(result.diagnostics).toHaveLength(0);

    const node = result.output.unifiedAgentSpec.graph.nodes.find(
      n => n.name === 'first'
    ) as Record<string, unknown> | undefined;
    expect(node).toBeDefined();

    const onInit = node!['on-init'] as Array<Record<string, unknown>>;
    expect(onInit).toBeDefined();
    expect(onInit.length).toBe(2);

    const lookupUpdates = onInit[0]['state-updates'] as Array<
      Record<string, string>
    >;
    expect(lookupUpdates[0]).toHaveProperty('_node_input');

    const normalizeUpdates = onInit[1]['state-updates'] as Array<
      Record<string, string>
    >;
    expect(normalizeUpdates[0]).toHaveProperty('request');
  });

  it('adds _handoff_source and _node_input state variables when tracking is injected', () => {
    const source = `
config:
  agent_name: "state-vars"

llm:
  default:
    target: "llm://conn"
    kind: "OpenAI"
    model: "gpt-4"

trigger t:
  kind: "a2a"
  target: "brokers://state-vars/a2a"
  on_message: ->
    transition to @generator.gen

generator gen:
  llm: @llm.default
  prompt: -> | hello
  on_exit: ->
    transition to @echo.done

echo done:
  kind: "a2a:response"
  message: "ok"
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));
    expect(result.diagnostics).toHaveLength(0);

    const stateVars = result.output.unifiedAgentSpec.graph[
      'state-variables'
    ] as unknown as Array<Record<string, unknown>>;
    const varNames = stateVars.map(v => v.name);
    expect(varNames).toContain('_handoff_source');
    expect(varNames).toContain('_node_input');

    const handoffVar = stateVars.find(v => v.name === '_handoff_source')!;
    expect(handoffVar['data-type']).toBe('string');
    expect(handoffVar.default).toBeNull();
  });

  it('omits tracking state variables when no producing nodes exist', () => {
    const source = `
config:
  agent_name: "no-tracking"

trigger t:
  kind: "a2a"
  target: "brokers://no-tracking/a2a"
  on_message: -> transition to @echo.done

echo done:
  kind: "a2a:response"
  message: "ok"
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));
    expect(result.diagnostics).toHaveLength(0);

    const stateVars = result.output.unifiedAgentSpec.graph[
      'state-variables'
    ] as unknown as Array<Record<string, unknown>>;
    const varNames = stateVars.map(v => v.name);
    expect(varNames).not.toContain('_handoff_source');
    expect(varNames).not.toContain('_node_input');
  });

  it('emits result["content"] for mcp:tool and result["result"] for a2a:send_message', () => {
    const source = `
config:
  agent_name: "result-field"

actions:
  mcp_action:
    target: "mcp://conn"
    kind: "mcp:tool"
    tool_name: "search"
  a2a_action:
    target: "a2a://conn"
    kind: "a2a:send_message"

trigger t:
  kind: "a2a"
  target: "brokers://result-field/a2a"
  on_message: ->
    transition to @executor.mcp_step

executor mcp_step:
  do: ->
    run @actions.mcp_action
  on_exit: ->
    transition to @executor.a2a_step

executor a2a_step:
  do: ->
    run @actions.a2a_action
  on_exit: ->
    transition to @echo.done

echo done:
  kind: "a2a:response"
  message: "ok"
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));
    expect(result.diagnostics).toHaveLength(0);

    const mcpNode = result.output.unifiedAgentSpec.graph.nodes.find(
      n => n.name === 'mcp_step'
    ) as Record<string, unknown> | undefined;
    const a2aNode = result.output.unifiedAgentSpec.graph.nodes.find(
      n => n.name === 'a2a_step'
    ) as Record<string, unknown> | undefined;
    expect(mcpNode).toBeDefined();
    expect(a2aNode).toBeDefined();

    const mcpTools = mcpNode!.tools as Array<Record<string, unknown>>;
    const mcpUpdates = mcpTools.flatMap(
      t => (t['state-updates'] as Array<Record<string, string>>) ?? []
    );
    const mcpOutputExpr = mcpUpdates.find(s => 'outputs' in s)
      ?.outputs as string;
    expect(mcpOutputExpr).toContain('result["content"]');

    const a2aTools = a2aNode!.tools as Array<Record<string, unknown>>;
    const a2aUpdates = a2aTools.flatMap(
      t => (t['state-updates'] as Array<Record<string, string>>) ?? []
    );
    const a2aOutputExpr = a2aUpdates.find(s => 'outputs' in s)
      ?.outputs as string;
    expect(a2aOutputExpr).toContain('result["result"]');
  });

  it('buildOnInit emits type: action on the IdentityAction reference', () => {
    const source = `
config:
  agent_name: "init-type"

trigger t:
  kind: "a2a"
  target: "brokers://init-type/a2a"
  on_message: -> transition to @echo.first

echo first:
  kind: "a2a:response"
  message: "ok"
`;
    const ast = parseDocument(source);
    const result = compile(toRecord(ast));
    expect(result.diagnostics).toHaveLength(0);

    const node = result.output.unifiedAgentSpec.graph.nodes.find(
      n => n.name === 'first'
    ) as Record<string, unknown> | undefined;
    expect(node).toBeDefined();

    const onInit = node!['on-init'] as Array<Record<string, unknown>>;
    expect(onInit).toBeDefined();

    const identityAction = onInit.find(a => a.ref === 'IdentityAction');
    expect(identityAction).toBeDefined();
    expect(identityAction!.type).toBe('action');
  });
});
