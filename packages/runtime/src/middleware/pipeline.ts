/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Msg } from '../llm/types.js';
import type {
  Middleware,
  BeforeTurnContext,
  BeforeTurnResult,
  AfterTurnContext,
  AfterTurnResult,
  BeforeToolCallContext,
  BeforeToolCallResult,
  AfterToolCallContext,
  AfterToolCallResult,
  BeforeLlmStepContext,
  BeforeLlmStepResult,
  AfterLlmStepContext,
  AfterLlmStepResult,
  OnErrorContext,
  OnErrorResult,
  OnStopContext,
  OnStopResult,
  OnSubagentStartContext,
  OnSubagentStopContext,
  OnInterruptContext,
} from './types.js';

export class MiddlewarePipeline {
  private readonly sorted: Middleware[];

  constructor(middlewares: Middleware[] = []) {
    this.sorted = [...middlewares].sort(
      (a, b) => (a.priority ?? 100) - (b.priority ?? 100)
    );
  }

  get isEmpty(): boolean {
    return this.sorted.length === 0;
  }

  async runBeforeTurn(
    ctx: BeforeTurnContext
  ): Promise<BeforeTurnResult | undefined> {
    let result: BeforeTurnResult | undefined;
    for (const mw of this.sorted) {
      if (!mw.beforeTurn) continue;
      try {
        const r = await mw.beforeTurn(ctx);
        if (r) {
          if (r.abort) return r;
          if (r.userInput !== undefined) {
            ctx = { ...ctx, userInput: r.userInput };
            result = { ...result, userInput: r.userInput };
          }
        }
      } catch (err) {
        if (!mw.failOpen) throw err;
      }
    }
    return result;
  }

  async runAfterTurn(
    ctx: AfterTurnContext
  ): Promise<AfterTurnResult | undefined> {
    let result: AfterTurnResult | undefined;
    for (const mw of this.sorted) {
      if (!mw.afterTurn) continue;
      try {
        const r = await mw.afterTurn(ctx);
        if (r?.assistantText !== undefined) {
          ctx = { ...ctx, assistantText: r.assistantText };
          result = { assistantText: r.assistantText };
        }
      } catch (err) {
        if (!mw.failOpen) throw err;
      }
    }
    return result;
  }

  async runBeforeToolCall(
    ctx: BeforeToolCallContext
  ): Promise<BeforeToolCallResult | undefined> {
    const originalArgs = ctx.args;
    for (const mw of this.sorted) {
      if (!mw.beforeToolCall) continue;
      try {
        const r = await mw.beforeToolCall(ctx);
        if (r) {
          if (r.abort || r.skip) return r;
          if (r.args) {
            ctx = { ...ctx, args: r.args };
          }
        }
      } catch (err) {
        if (!mw.failOpen) throw err;
      }
    }
    if (ctx.args !== originalArgs) {
      return { args: ctx.args };
    }
    return undefined;
  }

  async runAfterToolCall(
    ctx: AfterToolCallContext
  ): Promise<AfterToolCallResult | undefined> {
    let result: AfterToolCallResult | undefined;
    for (const mw of this.sorted) {
      if (!mw.afterToolCall) continue;
      try {
        const r = await mw.afterToolCall(ctx);
        if (r?.result) {
          ctx = { ...ctx, result: r.result };
          result = { result: r.result };
        }
      } catch (err) {
        if (!mw.failOpen) throw err;
      }
    }
    return result;
  }

  async runBeforeLlmStep(
    ctx: BeforeLlmStepContext
  ): Promise<BeforeLlmStepResult | undefined> {
    let result: BeforeLlmStepResult | undefined;
    const appendedMessages: Msg[] = [];
    // Last replacement wins: a later-priority middleware that returns
    // `replaceMessages` authoritatively supersedes an earlier one. We also feed
    // the replacement back into `ctx.messages` so downstream middleware observe
    // the compacted history rather than the stale original.
    let replacedMessages: Msg[] | undefined;
    const collectedGuardrails: import('../guardrails/types.js').Guardrail[] =
      [];
    for (const mw of this.sorted) {
      if (!mw.beforeLlmStep) continue;
      try {
        const r = await mw.beforeLlmStep(ctx);
        if (r) {
          if (r.system !== undefined) {
            ctx = { ...ctx, system: r.system };
            result = { ...result, system: r.system };
          }
          if (r.tools) {
            ctx = { ...ctx, tools: r.tools };
            result = { ...result, tools: r.tools };
          }
          if (r.replaceMessages) {
            replacedMessages = r.replaceMessages;
            ctx = { ...ctx, messages: r.replaceMessages };
          }
          if (r.appendMessages) {
            appendedMessages.push(...r.appendMessages);
          }
          if (r.guardrails) {
            collectedGuardrails.push(...r.guardrails);
          }
        }
      } catch (err) {
        if (!mw.failOpen) throw err;
      }
    }
    if (replacedMessages) {
      result = { ...result, replaceMessages: replacedMessages };
    }
    if (appendedMessages.length > 0) {
      result = { ...result, appendMessages: appendedMessages };
    }
    if (collectedGuardrails.length > 0) {
      result = { ...result, guardrails: collectedGuardrails };
    }
    return result;
  }

  async runAfterLlmStep(
    ctx: AfterLlmStepContext
  ): Promise<AfterLlmStepResult | undefined> {
    let result: AfterLlmStepResult | undefined;
    for (const mw of this.sorted) {
      if (!mw.afterLlmStep) continue;
      try {
        const r = await mw.afterLlmStep(ctx);
        if (r) {
          if (r.text !== undefined) {
            ctx = { ...ctx, text: r.text };
            result = { ...result, text: r.text };
          }
          if (r.toolCalls) {
            ctx = { ...ctx, toolCalls: r.toolCalls };
            result = { ...result, toolCalls: r.toolCalls };
          }
        }
      } catch (err) {
        if (!mw.failOpen) throw err;
      }
    }
    return result;
  }

  async runOnError(ctx: OnErrorContext): Promise<OnErrorResult | undefined> {
    let result: OnErrorResult | undefined;
    for (const mw of this.sorted) {
      if (!mw.onError) continue;
      try {
        const r = await mw.onError(ctx);
        if (r) {
          if (r.suppress) result = { ...result, suppress: true };
          if (r.fallbackResult && !result?.fallbackResult) {
            result = { ...result, fallbackResult: r.fallbackResult };
          }
        }
      } catch (err) {
        if (!mw.failOpen) throw err;
      }
    }
    return result;
  }

  /**
   * BLOCKING. First middleware to return a `continuation` wins — the turn does
   * not stop and that text resumes the reasoning loop. Later middleware are
   * still consulted only if earlier ones decline (so priority order applies).
   */
  async runOnStop(ctx: OnStopContext): Promise<OnStopResult | undefined> {
    for (const mw of this.sorted) {
      if (!mw.onStop) continue;
      try {
        const r = await mw.onStop(ctx);
        if (r?.continuation !== undefined && r.continuation !== '') {
          return { continuation: r.continuation };
        }
      } catch (err) {
        if (!mw.failOpen) throw err;
      }
    }
    return undefined;
  }

  async runOnSubagentStart(ctx: OnSubagentStartContext): Promise<void> {
    for (const mw of this.sorted) {
      if (!mw.onSubagentStart) continue;
      try {
        await mw.onSubagentStart(ctx);
      } catch (err) {
        if (!mw.failOpen) throw err;
      }
    }
  }

  async runOnSubagentStop(ctx: OnSubagentStopContext): Promise<void> {
    for (const mw of this.sorted) {
      if (!mw.onSubagentStop) continue;
      try {
        await mw.onSubagentStop(ctx);
      } catch (err) {
        if (!mw.failOpen) throw err;
      }
    }
  }

  async runOnInterrupt(ctx: OnInterruptContext): Promise<void> {
    for (const mw of this.sorted) {
      if (!mw.onInterrupt) continue;
      try {
        await mw.onInterrupt(ctx);
      } catch (err) {
        if (!mw.failOpen) throw err;
      }
    }
  }
}
