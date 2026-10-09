import { describe, it, expect } from 'vitest';
import { compileSource } from '@agentscript/agentforce';
import { Runtime, ToolRegistry } from '../src/index.js';
import { ScriptedLlm } from './helpers.js';

/**
 * Verifies the runtime faithfully executes the step sequences that the
 * compiler emits for `if` / `if-else` / chained independent
 * `if`s (the AgentScript idiom for multi-way dispatch, since `elif`
 * shares a single AgentScriptInternal_condition slot that is known to
 * collapse with more than one arm).
 *
 * The compiler flattens control flow into sibling state-update steps,
 * each guarded by an `enabled` expression. Our runtime's only job is to
 * evaluate those guards honestly — which is exactly what we assert here.
 */

const SRC_SIMPLE = `
system:
    instructions: "tier bot"

config:
    agent_name: "Tier"
    default_agent_user: "a@b.com"

variables:
    score: mutable number = 0
        description: "score"
    tier: mutable string = ""
        description: "tier"
    bonus: mutable boolean = False
        description: "bonus"

start_agent classifier:
    description: "classify tier by independent if checks"

    before_reasoning:
        # Multi-way dispatch expressed as independent, mutually-exclusive
        # if statements — what AgentScript authors actually write.
        if @variables.score >= 90:
            set @variables.tier = "platinum"
        if @variables.score >= 95:
            set @variables.bonus = True
        if @variables.score >= 70 and @variables.score < 90:
            set @variables.tier = "gold"
        if @variables.score >= 40 and @variables.score < 70:
            set @variables.tier = "silver"
        if @variables.score < 40:
            set @variables.tier = "bronze"

    reasoning:
        instructions: ->
            | Tier is {! @variables.tier }
`;

describe('Runtime — if / if-else semantics', () => {
  const { output, diagnostics } = compileSource(SRC_SIMPLE);
  const errors = diagnostics.filter(d => d.severity === 1);
  expect(errors).toEqual([]);

  async function runWithScore(score: number) {
    const llm = new ScriptedLlm([{ text: 'ok' }]);
    const runtime = new Runtime({
      doc: output,
      llm,
      tools: new ToolRegistry(),
    });
    runtime.state.set('score', score);
    await runtime.turn('go');
    return {
      tier: runtime.state.get('tier'),
      bonus: runtime.state.get('bonus'),
    };
  }

  it('picks the platinum+bonus branch for a top score', async () => {
    expect(await runWithScore(97)).toEqual({ tier: 'platinum', bonus: true });
  });

  it('picks platinum without bonus on the boundary', async () => {
    expect(await runWithScore(90)).toEqual({ tier: 'platinum', bonus: false });
  });

  it('picks gold for mid-high scores', async () => {
    expect(await runWithScore(75)).toEqual({ tier: 'gold', bonus: false });
  });

  it('picks silver for mid scores', async () => {
    expect(await runWithScore(50)).toEqual({ tier: 'silver', bonus: false });
  });

  it('picks bronze for low scores', async () => {
    expect(await runWithScore(10)).toEqual({ tier: 'bronze', bonus: false });
  });

  it('picks bronze at exactly zero', async () => {
    expect(await runWithScore(0)).toEqual({ tier: 'bronze', bonus: false });
  });

  it('picks gold at the exact >=70 boundary', async () => {
    expect(await runWithScore(70)).toEqual({ tier: 'gold', bonus: false });
  });

  it('picks silver at the exact >=40 boundary', async () => {
    expect(await runWithScore(40)).toEqual({ tier: 'silver', bonus: false });
  });
});

const SRC_IF_ELSE = `
system:
    instructions: "bot"

config:
    agent_name: "IfElse"
    default_agent_user: "a@b.com"

variables:
    verified: mutable boolean = False
        description: "verified"
    greeting: mutable string = ""
        description: "greeting"

start_agent greeter:
    description: "greet verified or anonymous"

    before_reasoning:
        if @variables.verified:
            set @variables.greeting = "Welcome back"
        else:
            set @variables.greeting = "Please verify"

    reasoning:
        instructions: ->
            | {! @variables.greeting }
`;

describe('Runtime — two-arm if/else', () => {
  const { output, diagnostics } = compileSource(SRC_IF_ELSE);
  expect(diagnostics.filter(d => d.severity === 1)).toEqual([]);

  async function greetingFor(verified: boolean) {
    const llm = new ScriptedLlm([{ text: 'ok' }]);
    const runtime = new Runtime({
      doc: output,
      llm,
      tools: new ToolRegistry(),
    });
    runtime.state.set('verified', verified);
    await runtime.turn('hi');
    return runtime.state.get('greeting');
  }

  it('runs the if arm when verified is true', async () => {
    expect(await greetingFor(true)).toBe('Welcome back');
  });

  it('runs the else arm when verified is false', async () => {
    expect(await greetingFor(false)).toBe('Please verify');
  });
});
