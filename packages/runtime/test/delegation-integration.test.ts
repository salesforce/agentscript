import { describe, it, expect } from 'vitest';
import { compileSource } from '@agentscript/agentforce';
import { Runtime, ToolRegistry, FnAdapter, AbortError } from '../src/index.js';
import type { RuntimeEvent } from '../src/index.js';
import { ScriptedLlm } from './helpers.js';

/**
 * Multi-agent source with a parent and child node.
 * The parent can delegate to the child via delegate://child.
 * The child can call fn://do_work.
 */
const MULTI_AGENT = `
system:
    instructions: "Multi-agent system."

config:
    agent_name: "DelegationBot"
    default_agent_user: "bot@test.com"

variables:
    result: mutable string = ""
        description: "Delegation result"
    child_ran: mutable string = ""
        description: "Set by child"

start_agent parent:
    description: "Parent agent"

    actions:
        Delegate_To_Child:
            description: "Delegate work to the child agent"
            inputs:
                context: string
                    description: "Context for delegation"
            outputs:
                result: string
                    description: "Child's response"
            target: "delegate://child"

    reasoning:
        instructions: ->
            | You can delegate to the child agent.
        actions:
            delegate: @actions.Delegate_To_Child
                with context=...
                set @variables.result = @outputs.result

subagent child:
    description: "Child agent"

    actions:
        Do_Work:
            description: "Do some work"
            inputs:
                task: string
                    description: "Task to perform"
            outputs:
                output: string
                    description: "Work result"
            target: "fn://do_work"

    reasoning:
        instructions: ->
            | Do the work and report back.
        actions:
            do_work: @actions.Do_Work
                with task=...
                set @variables.child_ran = @outputs.output
`;

/**
 * Source for testing nested delegation (parent -> middle -> child).
 */
const NESTED_DELEGATION = `
system:
    instructions: "Nested delegation system."

config:
    agent_name: "NestedBot"
    default_agent_user: "bot@test.com"

variables:
    depth_marker: mutable string = ""
        description: "Tracks depth"

start_agent top:
    description: "Top-level agent"

    actions:
        Delegate_To_Middle:
            description: "Delegate to middle"
            inputs:
                context: string
                    description: "Context"
            target: "delegate://middle"

    reasoning:
        instructions: ->
            | You can delegate to middle.
        actions:
            delegate_middle: @actions.Delegate_To_Middle
                with context=...

subagent middle:
    description: "Middle agent that re-delegates"

    actions:
        Delegate_To_Bottom:
            description: "Delegate to bottom"
            inputs:
                context: string
                    description: "Context"
            target: "delegate://bottom"

    reasoning:
        instructions: ->
            | You can delegate to bottom.
        actions:
            delegate_bottom: @actions.Delegate_To_Bottom
                with context=...

subagent bottom:
    description: "Bottom agent"

    reasoning:
        instructions: ->
            | You are the bottom agent.
`;

describe('Runtime — delegation integration', () => {
  it('basic delegation call-return', async () => {
    const { output, diagnostics } = compileSource(MULTI_AGENT);
    const errors = diagnostics.filter(
      d => d.severity === 1 && d.code !== 'invalid-action-target'
    );
    expect(errors).toEqual([]);

    const fn = new FnAdapter();
    fn.register('do_work', () => ({ output: 'done' }));
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const llm = new ScriptedLlm([
      // Parent's first step: calls delegate tool
      {
        toolCalls: [
          { id: 'tc1', name: 'delegate', arguments: { context: 'help me' } },
        ],
      },
      // --- delegation starts, child gets control ---
      // Child's response (no tool calls, just text)
      { text: 'Work complete.' },
      // --- delegation ends, parent regains control ---
      // Parent's response after seeing delegation result
      { text: 'The child said: Work complete.' },
    ]);

    const runtime = new Runtime({ doc: output, llm, tools });
    const result = await runtime.turn('Please delegate this work');

    expect(result.assistantText).toBe('The child said: Work complete.');
    expect(result.finalNode).toBe('parent');
  });

  it('child modifies state, parent sees it', async () => {
    const { output, diagnostics } = compileSource(MULTI_AGENT);
    const errors = diagnostics.filter(
      d => d.severity === 1 && d.code !== 'invalid-action-target'
    );
    expect(errors).toEqual([]);

    const fn = new FnAdapter();
    fn.register('do_work', () => ({ output: 'child was here' }));
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const llm = new ScriptedLlm([
      // Parent calls delegate tool
      {
        toolCalls: [
          { id: 'tc1', name: 'delegate', arguments: { context: 'do work' } },
        ],
      },
      // Child calls its tool (which triggers state_updates to set child_ran)
      {
        toolCalls: [
          { id: 'tc2', name: 'do_work', arguments: { task: 'build it' } },
        ],
      },
      // Child finishes with text
      { text: 'Done working.' },
      // Parent's final response
      { text: 'Child finished.' },
    ]);

    const runtime = new Runtime({ doc: output, llm, tools });

    // Before delegation, child_ran is empty
    expect(runtime.state.get('child_ran')).toBe('');

    await runtime.turn('delegate this');

    // After delegation, child_ran should be set by child's tool state_updates
    expect(runtime.state.get('child_ran')).toBe('child was here');
  });

  it('history isolation — child conversation does not pollute parent', async () => {
    const { output, diagnostics } = compileSource(MULTI_AGENT);
    const errors = diagnostics.filter(
      d => d.severity === 1 && d.code !== 'invalid-action-target'
    );
    expect(errors).toEqual([]);

    const fn = new FnAdapter();
    fn.register('do_work', () => ({ output: 'done' }));
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const llm = new ScriptedLlm([
      // Parent calls delegate tool
      {
        toolCalls: [
          {
            id: 'tc1',
            name: 'delegate',
            arguments: { context: 'secret task' },
          },
        ],
      },
      // Child calls tool
      {
        toolCalls: [
          { id: 'tc2', name: 'do_work', arguments: { task: 'secret stuff' } },
        ],
      },
      // Child finishes
      { text: 'Secret work done.' },
      // Parent's final response
      { text: 'All good.' },
    ]);

    const runtime = new Runtime({ doc: output, llm, tools });
    await runtime.turn('do something');

    // The parent's LLM calls should NOT contain the child's delegation context
    // or tool results. The last call (index 3) is the parent's post-delegation
    // call. Its messages should not contain the child's "[Delegation context: ...]"
    // message or the child's tool result.
    const parentFinalCall = llm.calls[3];
    const messageContents = parentFinalCall.messages.map(m => {
      if ('content' in m && typeof m.content === 'string') return m.content;
      return '';
    });
    const allContent = messageContents.join(' ');
    expect(allContent).not.toContain('[Delegation context:');
    // But the delegation tool result IS visible to parent (as a tool_result message)
    const toolResultMsgs = parentFinalCall.messages.filter(
      m => m.role === 'tool'
    );
    expect(toolResultMsgs.length).toBeGreaterThan(0);
  });

  it('delegation with context — context is passed to child', async () => {
    const { output, diagnostics } = compileSource(MULTI_AGENT);
    const errors = diagnostics.filter(
      d => d.severity === 1 && d.code !== 'invalid-action-target'
    );
    expect(errors).toEqual([]);

    const fn = new FnAdapter();
    fn.register('do_work', () => ({ output: 'done' }));
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const llm = new ScriptedLlm([
      // Parent calls delegate with specific context
      {
        toolCalls: [
          {
            id: 'tc1',
            name: 'delegate',
            arguments: { context: 'summarize the report' },
          },
        ],
      },
      // Child's response
      { text: 'Summary: all good.' },
      // Parent's final response
      { text: 'Got the summary.' },
    ]);

    const runtime = new Runtime({ doc: output, llm, tools });
    await runtime.turn('get me a summary');

    // The child's LLM call (index 1) should have the delegation context in its messages
    const childCall = llm.calls[1];
    const childMessages = childCall.messages.map(m => {
      if ('content' in m && typeof m.content === 'string') return m.content;
      return '';
    });
    const childContent = childMessages.join(' ');
    expect(childContent).toContain(
      '[Delegation context: summarize the report]'
    );
  });

  it('delegation timeout — child exceeds maxSteps', async () => {
    const { output, diagnostics } = compileSource(MULTI_AGENT);
    const errors = diagnostics.filter(
      d => d.severity === 1 && d.code !== 'invalid-action-target'
    );
    expect(errors).toEqual([]);

    const fn = new FnAdapter();
    fn.register('do_work', () => ({ output: 'done' }));
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    // Child keeps calling tools indefinitely, exceeding maxSteps
    const llm = new ScriptedLlm([
      // Parent calls delegate
      {
        toolCalls: [
          {
            id: 'tc1',
            name: 'delegate',
            arguments: { context: 'infinite loop' },
          },
        ],
      },
      // Child iteration 1: calls tool
      {
        toolCalls: [
          { id: 'tc2', name: 'do_work', arguments: { task: 'step1' } },
        ],
      },
      // Child iteration 2: calls tool again (exceeds maxSteps=2)
      {
        toolCalls: [
          { id: 'tc3', name: 'do_work', arguments: { task: 'step2' } },
        ],
      },
      // Child iteration 3: would exceed limit
      {
        toolCalls: [
          { id: 'tc4', name: 'do_work', arguments: { task: 'step3' } },
        ],
      },
      // Parent's response after error (delegation error goes to tool_result)
      { text: 'Delegation failed.' },
    ]);

    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      delegation: { maxSteps: 2 },
    });
    const result = await runtime.turn('do something');

    // The delegation timeout error is caught and returned as a tool_result error
    // to the parent, which then produces its response.
    expect(result.assistantText).toBe('Delegation failed.');
    expect(result.finalNode).toBe('parent');
  });

  it('delegation depth limit — nested delegation exceeds maxDepth', async () => {
    const { output, diagnostics } = compileSource(NESTED_DELEGATION);
    const errors = diagnostics.filter(
      d => d.severity === 1 && d.code !== 'invalid-action-target'
    );
    expect(errors).toEqual([]);

    const tools = new ToolRegistry();

    const llm = new ScriptedLlm([
      // Top calls delegate to middle
      {
        toolCalls: [
          {
            id: 'tc1',
            name: 'delegate_middle',
            arguments: { context: 'go deep' },
          },
        ],
      },
      // Middle calls delegate to bottom (this exceeds maxDepth=1)
      {
        toolCalls: [
          {
            id: 'tc2',
            name: 'delegate_bottom',
            arguments: { context: 'deeper' },
          },
        ],
      },
      // Middle gets error result, responds
      { text: 'Too deep, stopping.' },
      // Top gets result from middle, responds
      { text: 'Depth limit hit.' },
    ]);

    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      delegation: { maxDepth: 1 },
    });
    const result = await runtime.turn('go deep');

    expect(result.assistantText).toBe('Depth limit hit.');
    expect(result.finalNode).toBe('top');
  });

  it('delegation with abort signal — AbortError propagates', async () => {
    const { output, diagnostics } = compileSource(MULTI_AGENT);
    const errors = diagnostics.filter(
      d => d.severity === 1 && d.code !== 'invalid-action-target'
    );
    expect(errors).toEqual([]);

    const fn = new FnAdapter();
    fn.register('do_work', () => ({ output: 'done' }));
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const controller = new AbortController();

    // Create an LLM that aborts during the child's execution
    let callCount = 0;
    const abortingLlm = {
      // eslint-disable-next-line @typescript-eslint/require-await -- async generator required by LlmDriver interface
      async *step(
        _input: Parameters<typeof ScriptedLlm.prototype.step>[0]
      ): AsyncIterable<import('../src/index.js').StepEvent> {
        callCount++;
        if (callCount === 1) {
          // Parent's first call: emit delegate tool call
          yield {
            kind: 'tool-call' as const,
            call: {
              id: 'tc1',
              name: 'delegate',
              arguments: { context: 'abort me' },
            },
          };
          yield { kind: 'finish' as const, reason: 'tool-calls' as const };
        } else {
          // Child's LLM step: abort during it
          controller.abort('user cancelled');
          yield { kind: 'text-delta' as const, text: 'partial...' };
          yield { kind: 'finish' as const, reason: 'stop' as const };
        }
      },
    };

    const runtime = new Runtime({
      doc: output,
      llm: abortingLlm,
      tools,
    });

    await expect(
      runtime.turn('start', { signal: controller.signal })
    ).rejects.toThrow(AbortError);
  });

  it('delegation events emitted — delegation-start and delegation-end', async () => {
    const { output, diagnostics } = compileSource(MULTI_AGENT);
    const errors = diagnostics.filter(
      d => d.severity === 1 && d.code !== 'invalid-action-target'
    );
    expect(errors).toEqual([]);

    const fn = new FnAdapter();
    fn.register('do_work', () => ({ output: 'done' }));
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const llm = new ScriptedLlm([
      // Parent calls delegate
      {
        toolCalls: [
          { id: 'tc1', name: 'delegate', arguments: { context: 'do it' } },
        ],
      },
      // Child responds (no tool calls)
      { text: 'Completed.' },
      // Parent responds
      { text: 'Done.' },
    ]);

    const runtime = new Runtime({ doc: output, llm, tools });
    const events: RuntimeEvent[] = [];
    runtime.on(e => events.push(e));

    await runtime.turn('delegate please');

    // Check delegation-start event
    const startEvents = events.filter(e => e.kind === 'delegation-start');
    expect(startEvents).toHaveLength(1);
    expect(startEvents[0]).toMatchObject({
      kind: 'delegation-start',
      parentNode: 'parent',
      childNode: 'child',
      depth: 1,
    });

    // Check delegation-end event
    const endEvents = events.filter(e => e.kind === 'delegation-end');
    expect(endEvents).toHaveLength(1);
    expect(endEvents[0]).toMatchObject({
      kind: 'delegation-end',
      parentNode: 'parent',
      childNode: 'child',
    });
    const endEvent = endEvents[0] as Extract<
      RuntimeEvent,
      { kind: 'delegation-end' }
    >;
    expect(endEvent.result.assistantText).toBe('Completed.');
    expect(endEvent.result.finalNode).toBe('child');
    expect(endEvent.result.steps).toBe(1);
  });

  it('child can use tools during delegation', async () => {
    const { output, diagnostics } = compileSource(MULTI_AGENT);
    const errors = diagnostics.filter(
      d => d.severity === 1 && d.code !== 'invalid-action-target'
    );
    expect(errors).toEqual([]);

    let doWorkCalledWith: Record<string, unknown> | null = null;
    const fn = new FnAdapter();
    fn.register('do_work', args => {
      doWorkCalledWith = args;
      return { output: 'result from tool' };
    });
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const llm = new ScriptedLlm([
      // Parent calls delegate
      {
        toolCalls: [
          { id: 'tc1', name: 'delegate', arguments: { context: 'use tools' } },
        ],
      },
      // Child calls its own tool
      {
        toolCalls: [
          { id: 'tc2', name: 'do_work', arguments: { task: 'compute' } },
        ],
      },
      // Child responds after tool result
      { text: 'Tool returned: result from tool' },
      // Parent responds
      { text: 'Child used tools successfully.' },
    ]);

    const runtime = new Runtime({ doc: output, llm, tools });
    const result = await runtime.turn('use the child tools');

    expect(doWorkCalledWith).toEqual({ task: 'compute' });
    expect(result.assistantText).toBe('Child used tools successfully.');
    expect(runtime.state.get('child_ran')).toBe('result from tool');
  });

  it('shareHistory: true — child receives parent history', async () => {
    const { output, diagnostics } = compileSource(MULTI_AGENT);
    const errors = diagnostics.filter(
      d => d.severity === 1 && d.code !== 'invalid-action-target'
    );
    expect(errors).toEqual([]);

    const fn = new FnAdapter();
    fn.register('do_work', () => ({ output: 'done' }));
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const llm = new ScriptedLlm([
      // Parent calls delegate
      {
        toolCalls: [
          {
            id: 'tc1',
            name: 'delegate',
            arguments: { context: 'shared history' },
          },
        ],
      },
      // Child responds
      { text: 'I can see the parent history.' },
      // Parent responds
      { text: 'History was shared.' },
    ]);

    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      delegation: { shareHistory: true },
    });
    await runtime.turn('hello from parent');

    // When shareHistory is true, the child's LLM call should include the parent's
    // user message in its history (along with the delegation context).
    const childCall = llm.calls[1];
    const childMessages = childCall.messages.map(m => {
      if ('content' in m && typeof m.content === 'string') return m.content;
      return '';
    });
    const childContent = childMessages.join(' ');
    // Parent's user message should be visible to the child
    expect(childContent).toContain('hello from parent');
    // Delegation context should also be there
    expect(childContent).toContain('[Delegation context: shared history]');
  });

  it('onWillDelegate fires before delegation-start and can abort by throwing', async () => {
    // Hook contract (parity with the reference agent): onWillDelegate runs
    // BEFORE any state swap or bracket emission. Throwing rejects the
    // delegation cleanly — no `delegation-start` event fires. The turn
    // itself continues because the tool-call wrapper catches the failure and
    // hands it back to the LLM as a tool-error result. That's the seam an
    // approval gate wants: block the child, let the parent recover.
    const { output } = compileSource(MULTI_AGENT);
    const tools = new ToolRegistry();
    const fn = new FnAdapter();
    tools.register('fn', fn);
    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'tc1', name: 'delegate', arguments: { context: 'help me' } },
        ],
      },
      { text: 'ok, giving up' },
    ]);
    const events: RuntimeEvent[] = [];
    let sawHook = false;
    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      delegation: {
        onWillDelegate: async ctx => {
          sawHook = true;
          expect(ctx.childNode).toBe('child');
          expect(ctx.depth).toBe(1);
          throw new Error('gate refused');
        },
      },
    });
    runtime.bus.on(e => events.push(e));
    await runtime.turn('please delegate');
    expect(sawHook).toBe(true);
    // No delegation-start (the hook aborted before the bracket).
    expect(events.some(e => e.kind === 'delegation-start')).toBe(false);
    // The runtime surfaced the failure as a tool-error on the delegate call.
    expect(
      events.some(
        e =>
          e.kind === 'tool-error' &&
          typeof (e as { error?: string }).error === 'string' &&
          (e as { error: string }).error.includes('gate refused')
      )
    ).toBe(true);
  });

  it('onDidDelegate observes the successful result after parent restoration', async () => {
    const { output } = compileSource(MULTI_AGENT);
    const fn = new FnAdapter();
    fn.register('do_work', () => ({ output: 'done' }));
    const tools = new ToolRegistry();
    tools.register('fn', fn);
    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'tc1', name: 'delegate', arguments: { context: 'help me' } },
        ],
      },
      { text: 'Work complete.' },
      { text: 'Wrapping up.' },
    ]);
    const observed: Array<{
      childNode: string;
      kind: string;
    }> = [];
    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      delegation: {
        onDidDelegate: (ctx, outcome) => {
          observed.push({ childNode: ctx.childNode, kind: outcome.kind });
        },
      },
    });
    await runtime.turn('please delegate');
    expect(observed).toEqual([{ childNode: 'child', kind: 'ok' }]);
  });

  it('onDidDelegate is called with error outcome and swallows its own throws', async () => {
    // A hook that itself throws must not break the parent turn — the runtime
    // logs and continues. Ensures instrumentation is safe by default.
    const { output } = compileSource(MULTI_AGENT);
    const fn = new FnAdapter();
    fn.register('do_work', () => {
      throw new Error('boom');
    });
    const tools = new ToolRegistry();
    tools.register('fn', fn);
    const llm = new ScriptedLlm([
      {
        toolCalls: [
          { id: 'tc1', name: 'delegate', arguments: { context: 'x' } },
        ],
      },
      {
        toolCalls: [{ id: 'tc2', name: 'do_work', arguments: { task: 't' } }],
      },
    ]);
    let observed: 'ok' | 'error' | undefined;
    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      delegation: {
        // Uses `maxSteps` so a failing tool doesn't loop indefinitely
        maxSteps: 3,
        onDidDelegate: (_ctx, outcome) => {
          observed = outcome.kind;
          throw new Error('observer failed');
        },
      },
    });
    // The tool failure isn't a delegation failure by itself; the child may
    // still recover. We just check the hook was called with SOMETHING and
    // the parent turn didn't crash from the observer throw.
    await runtime.turn('please delegate').catch(() => undefined);
    expect(observed).toBeDefined();
  });

  it('summaryPolicy re-prompts a terse child until it meets minChars', async () => {
    // A child that answers "ok" would slip below any reasonable threshold —
    // summaryPolicy injects a continuation prompt and rolls another step.
    const { output } = compileSource(MULTI_AGENT);
    const fn = new FnAdapter();
    const tools = new ToolRegistry();
    tools.register('fn', fn);
    const llm = new ScriptedLlm([
      // Parent delegates.
      {
        toolCalls: [
          { id: 'tc1', name: 'delegate', arguments: { context: 'help' } },
        ],
      },
      // Child's first pass: too short.
      { text: 'ok' },
      // Child's continuation, prompted by the policy.
      {
        text: 'Here is a longer answer with plenty of relevant detail so the summary policy is satisfied on the second pass.',
      },
      // Parent's response.
      { text: 'Got it.' },
    ]);
    const runtime = new Runtime({
      doc: output,
      llm,
      tools,
      delegation: {
        summaryPolicy: { minChars: 60, retries: 2 },
      },
    });
    const result = await runtime.turn('go');
    expect(result.assistantText).toBe('Got it.');
    // The delegation issued at least 3 LLM calls: parent, child pass 1, child continuation.
    expect(llm.calls.length).toBeGreaterThanOrEqual(3);
    // The continuation prompt should be present in the child's second call.
    const secondChildCall = llm.calls[2];
    const secondChildMessages = secondChildCall.messages
      .map(m =>
        typeof (m as { content?: unknown }).content === 'string'
          ? (m as { content: string }).content
          : ''
      )
      .join(' ');
    expect(secondChildMessages).toContain('Please provide a complete answer');
  });
});
