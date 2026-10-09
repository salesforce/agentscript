import { describe, it, expect } from 'vitest';
import { compileSource } from '@agentscript/agentforce';
import {
  Runtime,
  ToolRegistry,
  FnAdapter,
  MemoryCheckpointStore,
  CheckpointVersionError,
  CHECKPOINT_SCHEMA_VERSION,
} from '../src/index.js';
import type {
  Checkpoint,
  LlmStepInput,
  StepEvent,
  RuntimeEvent,
} from '../src/index.js';
import { ScriptedLlm } from './helpers.js';

const DOC_WITH_STATE = `
system:
    instructions: "You are a helpful bot."

config:
    agent_name: "TestBot"
    default_agent_user: "test@example.com"

variables:
    counter: mutable number = 0
        description: "A counter"
    user_name: mutable string = ""
        description: "The user name"

start_agent greeting:
    description: "Greet the user"

    actions:
        Increment:
            description: "Increment the counter"
            target: "fn://increment"
            outputs:
                value: number
                    description: "New value"

    reasoning:
        instructions: ->
            | Greet the user and ask their name.
        actions:
            increment: @actions.Increment
                set @variables.counter = @outputs.value

            go_to_help: @utils.transition to @subagent.help
                description: "Go to help"

subagent help:
    description: "Help the user"
    reasoning:
        instructions: ->
            | Help the user with their question.
`;

const DOC_WITH_CONTEXT = `
system:
    instructions: "You are a context-aware bot."

config:
    agent_name: "ContextBot"
    default_agent_user: "ctx@example.com"

variables:
    session_id: context string
        description: "The session ID"
    user_role: context string
        description: "The user role"
    notes: mutable string = ""
        description: "Internal notes"

start_agent main:
    description: "Main agent"
    reasoning:
        instructions: ->
            | Respond to the user.
`;

describe('Checkpoint', () => {
  it('checkpoint() captures current state', async () => {
    const { output } = compileSource(DOC_WITH_STATE);
    const fn = new FnAdapter();
    let counter = 0;
    fn.register('increment', () => ({ value: ++counter }));
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const llm = new ScriptedLlm([
      {
        toolCalls: [{ id: 'c1', name: 'increment', arguments: {} }],
      },
      { text: 'Hello!' },
    ]);
    const runtime = new Runtime({ doc: output, llm, tools });
    await runtime.turn('hi');

    const cp = runtime.checkpoint({ metadata: { reason: 'test' } });

    expect(cp.schemaVersion).toBe(CHECKPOINT_SCHEMA_VERSION);
    expect(cp.createdAt).toBeTruthy();
    expect(cp.id).toBeTruthy();
    expect(cp.currentNode).toBe('greeting');
    expect(cp.history.length).toBeGreaterThan(0);
    expect(cp.stateValues.counter).toBe(1);
    expect(cp.metadata).toEqual({ reason: 'test' });
  });

  it('fromCheckpoint restores state', async () => {
    const { output } = compileSource(DOC_WITH_STATE);
    const fn = new FnAdapter();
    let counter = 0;
    fn.register('increment', () => ({ value: ++counter }));
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const llm = new ScriptedLlm([
      // Turn 1: call increment then respond
      { toolCalls: [{ id: 'c1', name: 'increment', arguments: {} }] },
      { text: 'Counter is 1.' },
      // Turn 2: LLM transitions to help
      { toolCalls: [{ id: 'c2', name: 'go_to_help', arguments: {} }] },
      { text: 'Helping now.' },
    ]);

    const runtime = new Runtime({ doc: output, llm, tools });
    await runtime.turn('increment please');
    await runtime.turn('go to help');

    const cp = runtime.checkpoint();

    // Restore into a fresh runtime
    const llm2 = new ScriptedLlm([{ text: 'Restored!' }]);
    const tools2 = new ToolRegistry();
    tools2.register('fn', fn);
    const restored = Runtime.fromCheckpoint(
      { doc: output, llm: llm2, tools: tools2 },
      cp
    );

    expect(restored.currentNodeName).toBe(cp.currentNode);
    expect(restored.state.get('counter')).toBe(1);
    // History from the original runtime is preserved
    expect(restored.state.snapshot().counter).toBe(cp.stateValues.counter);
  });

  it('restored runtime continues conversation', async () => {
    const { output } = compileSource(DOC_WITH_STATE);
    const fn = new FnAdapter();
    let counter = 0;
    fn.register('increment', () => ({ value: ++counter }));
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    const llm1 = new ScriptedLlm([
      { toolCalls: [{ id: 'c1', name: 'increment', arguments: {} }] },
      { text: 'Counter is now 1.' },
    ]);
    const rt1 = new Runtime({ doc: output, llm: llm1, tools });
    await rt1.turn('increment');
    const cp = rt1.checkpoint();

    // Restore and run another turn
    const llm2 = new ScriptedLlm([{ text: 'Sure, counter is still 1.' }]);
    const tools2 = new ToolRegistry();
    tools2.register('fn', fn);
    const rt2 = Runtime.fromCheckpoint(
      { doc: output, llm: llm2, tools: tools2 },
      cp
    );
    const result = await rt2.turn('what is the counter?');

    expect(result.assistantText).toBe('Sure, counter is still 1.');
    // The LLM should see the full history (user + assistant + tool from turn 1, then new user)
    expect(llm2.calls).toHaveLength(1);
    const messages = llm2.calls[0].messages;
    // Should contain the original user message + assistant tool_calls + tool result + assistant text + new user message
    expect(messages.length).toBeGreaterThanOrEqual(4);
    expect(messages[0]).toMatchObject({ role: 'user', content: 'increment' });
    expect(messages[messages.length - 1]).toMatchObject({
      role: 'user',
      content: 'what is the counter?',
    });
  });

  it('mid-turn checkpoint throws', async () => {
    const { output } = compileSource(DOC_WITH_STATE);
    const tools = new ToolRegistry();
    tools.register('fn', new FnAdapter());

    const runtimeRef: { current: Runtime | undefined } = { current: undefined };
    let checkpointError: Error | undefined;

    // Create a delayed LLM that gives us a window to attempt a checkpoint
    const delayedLlm = {
      async *step(_input: LlmStepInput): AsyncIterable<StepEvent> {
        // While we're in this generator, the turn is active
        // Try to checkpoint from the reference we captured
        try {
          runtimeRef.current!.checkpoint();
        } catch (e) {
          checkpointError = e as Error;
        }
        yield { kind: 'text-delta', text: 'hello' };
        yield { kind: 'finish', reason: 'stop' as const };
      },
    };

    const runtime = new Runtime({ doc: output, llm: delayedLlm, tools });
    runtimeRef.current = runtime;

    await runtime.turn('test');

    expect(checkpointError).toBeDefined();
    expect(checkpointError!.message).toContain('Cannot checkpoint mid-turn');
  });

  it('schema version mismatch throws CheckpointVersionError', () => {
    const { output } = compileSource(DOC_WITH_STATE);
    const tools = new ToolRegistry();
    tools.register('fn', new FnAdapter());

    const badCheckpoint: Checkpoint = {
      schemaVersion: 999,
      createdAt: new Date().toISOString(),
      id: 'bad-cp',
      currentNode: 'greeting',
      history: [],
      stateValues: {},
    };

    expect(() =>
      Runtime.fromCheckpoint(
        { doc: output, llm: new ScriptedLlm([]), tools },
        badCheckpoint
      )
    ).toThrow(CheckpointVersionError);
  });

  it('migrates a v1 checkpoint forward (no background tasks)', () => {
    const { output } = compileSource(DOC_WITH_STATE);
    const tools = new ToolRegistry();
    tools.register('fn', new FnAdapter());

    // A pre-background (v1) checkpoint — lacks the backgroundTasks field.
    const v1: Checkpoint = {
      schemaVersion: 1,
      createdAt: new Date().toISOString(),
      id: 'v1-cp',
      currentNode: 'greeting',
      history: [{ role: 'user', content: 'hi' }],
      stateValues: { counter: 7, user_name: 'ada' },
    };

    const rt = Runtime.fromCheckpoint(
      { doc: output, llm: new ScriptedLlm([]), tools },
      v1
    );
    // State survives the migration unchanged.
    expect(rt.state.get('counter')).toBe(7);
    expect(rt.state.get('user_name')).toBe('ada');
    // A re-checkpoint is now stamped at the current version.
    const cp2 = rt.checkpoint({ id: 'again' });
    expect(cp2.schemaVersion).toBe(CHECKPOINT_SCHEMA_VERSION);
  });

  it('persists the background-task table across checkpoint/restore + reconcile', async () => {
    const { BackgroundTaskManager, MemoryBackgroundTaskStore } =
      await import('../src/index.js');
    const { output } = compileSource(DOC_WITH_STATE);
    const tools = new ToolRegistry();
    tools.register('fn', new FnAdapter());

    // A first session with a shared store, holding one still-running task.
    const store = new MemoryBackgroundTaskStore();
    const mgr1 = new BackgroundTaskManager({ store });
    mgr1.spawn({
      childNode: 'help',
      agentId: 'help',
      description: 'long job',
      run: () => new Promise(() => {}), // never settles
    });

    const rt1 = new Runtime({
      doc: output,
      llm: new ScriptedLlm([]),
      tools,
      background: mgr1,
    });
    const cp = rt1.checkpoint({ id: 'with-bg' });
    expect(cp.schemaVersion).toBe(CHECKPOINT_SCHEMA_VERSION);
    expect(cp.backgroundTasks).toHaveLength(1);
    expect(cp.backgroundTasks![0].status).toBe('running');

    // A NEW session restores the checkpoint with a FRESH manager (fresh store)
    // — simulating a process restart. Reconcile declares the orphan `lost`.
    const mgr2 = new BackgroundTaskManager();
    const rt2 = Runtime.fromCheckpoint(
      { doc: output, llm: new ScriptedLlm([]), tools, background: mgr2 },
      cp
    );
    const recovered = await rt2.reconcileBackgroundTasks();
    expect(recovered).toHaveLength(1);
    expect(recovered[0].status).toBe('lost');
    expect(mgr2.list()[0].status).toBe('lost');
  });

  it('MemoryCheckpointStore round-trip', async () => {
    const store = new MemoryCheckpointStore();

    const cp: Checkpoint = {
      schemaVersion: CHECKPOINT_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      id: 'cp-1',
      currentNode: 'greeting',
      history: [{ role: 'user', content: 'hi' }],
      stateValues: { counter: 5 },
    };

    // Save
    const id = await store.save(cp);
    expect(id).toBe('cp-1');

    // Load
    const loaded = await store.load('cp-1');
    expect(loaded).toEqual(cp);

    // Mutations to original don't affect stored copy
    cp.stateValues.counter = 99;
    const loaded2 = await store.load('cp-1');
    expect(loaded2!.stateValues.counter).toBe(5);

    // List
    const cp2: Checkpoint = {
      ...cp,
      id: 'cp-2',
      stateValues: { counter: 10 },
    };
    await store.save(cp2);
    const ids = await store.list();
    expect(ids).toContain('cp-1');
    expect(ids).toContain('cp-2');

    // List with limit (reversed order — most recent first)
    const limited = await store.list({ limit: 1 });
    expect(limited).toHaveLength(1);
    expect(limited[0]).toBe('cp-2');

    // Delete
    await store.delete('cp-1');
    const after = await store.load('cp-1');
    expect(after).toBeNull();

    const remaining = await store.list();
    expect(remaining).toEqual(['cp-2']);
  });

  // -----------------------------------------------------------------------
  // Tier 2 — T2.4: checkpoint mid-multi-topic, restore in fresh Runtime,
  // resume cleanly. Tests JSON round-trip and resume on the post-handoff
  // node without spurious delegation/zombie events.
  // -----------------------------------------------------------------------
  it('checkpoint after handoff -> JSON round-trip -> fresh Runtime resumes on B', async () => {
    const { output } = compileSource(DOC_WITH_STATE);
    const fn = new FnAdapter();
    fn.register('increment', () => ({ value: 1 }));
    const tools = new ToolRegistry();
    tools.register('fn', fn);

    // Turn 1: increment, then handoff to help.
    const llm1 = new ScriptedLlm([
      { toolCalls: [{ id: 'c1', name: 'increment', arguments: {} }] },
      { toolCalls: [{ id: 'c2', name: 'go_to_help', arguments: {} }] },
      { text: 'On help now.' },
    ]);
    const rt1 = new Runtime({ doc: output, llm: llm1, tools });
    await rt1.turn('please help me');

    // Verify we did handoff to "help"
    expect(rt1.currentNodeName).toBe('help');
    expect(rt1.state.get('counter')).toBe(1);

    // Take checkpoint, JSON round-trip
    const cp = rt1.checkpoint();
    const json = JSON.stringify(cp);
    const restored = JSON.parse(json) as typeof cp;
    expect(restored.currentNode).toBe('help');

    // Construct fresh Runtime from the restored checkpoint
    const llm2 = new ScriptedLlm([{ text: 'still helping you.' }]);
    const tools2 = new ToolRegistry();
    tools2.register('fn', fn);
    const rt2 = Runtime.fromCheckpoint(
      { doc: output, llm: llm2, tools: tools2 },
      restored
    );

    // State preserved
    expect(rt2.state.get('counter')).toBe(1);
    expect(rt2.currentNodeName).toBe('help');

    // Turn 2: should fire node-enter for "help" (NOT for the start agent),
    // and emit no delegation-start (no zombie).
    const events: RuntimeEvent[] = [];
    rt2.on(e => events.push(e));
    const result = await rt2.turn('what next?');

    expect(result.assistantText).toBe('still helping you.');
    const nodeEnters = events.filter(e => e.kind === 'node-enter');
    expect(nodeEnters.length).toBeGreaterThan(0);
    expect(nodeEnters[0]).toMatchObject({ kind: 'node-enter', node: 'help' });
    // No node-enter for the start agent on resumed turn
    expect(
      nodeEnters.some(e => e.kind === 'node-enter' && e.node === 'greeting')
    ).toBe(false);

    // No leftover delegation-start events
    const delegStarts = events.filter(e => e.kind === 'delegation-start');
    expect(delegStarts).toHaveLength(0);
  });

  it('state values including Context vars are preserved', async () => {
    const { output } = compileSource(DOC_WITH_CONTEXT);
    const tools = new ToolRegistry();

    const llm1 = new ScriptedLlm([{ text: 'Noted.' }]);
    const rt1 = new Runtime({
      doc: output,
      llm: llm1,
      tools,
      context: { session_id: 'sess-abc', user_role: 'admin' },
    });
    await rt1.turn('hello');

    const cp = rt1.checkpoint();

    // Verify context vars are in the snapshot
    expect(cp.stateValues.session_id).toBe('sess-abc');
    expect(cp.stateValues.user_role).toBe('admin');

    // Restore and verify context vars are accessible
    const llm2 = new ScriptedLlm([{ text: 'Restored context.' }]);
    const rt2 = Runtime.fromCheckpoint(
      {
        doc: output,
        llm: llm2,
        tools,
        context: { session_id: 'sess-abc', user_role: 'admin' },
      },
      cp
    );

    expect(rt2.state.get('session_id')).toBe('sess-abc');
    expect(rt2.state.get('user_role')).toBe('admin');

    // The restored runtime can still operate
    const result = await rt2.turn('are you there?');
    expect(result.assistantText).toBe('Restored context.');
  });
});
