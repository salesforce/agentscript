/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * A minimal `LlmDriver` that plays back a scripted sequence of steps instead
 * of calling a real model. Every example in this directory drives its agent
 * with this — swap it for `@agentscript/runtime-vercel`'s `VercelAiSdkDriver`
 * (or any other `LlmDriver`) to go from "example" to "real model", unchanged.
 */

import type {
  LlmDriver,
  LlmStepInput,
  StepEvent,
  ToolCall,
} from '../../src/index.js';

export interface ScriptedStep {
  text?: string;
  toolCalls?: ToolCall[];
}

export class ScriptedLlm implements LlmDriver {
  private idx = 0;
  readonly calls: LlmStepInput[] = [];

  constructor(private readonly script: ScriptedStep[]) {}

  async *step(input: LlmStepInput): AsyncIterable<StepEvent> {
    this.calls.push(input);
    const s = this.script[this.idx++] ?? {};
    if (s.text) yield { kind: 'text-delta', text: s.text };
    for (const call of s.toolCalls ?? []) {
      yield { kind: 'tool-call', call };
    }
    yield {
      kind: 'finish',
      reason: (s.toolCalls?.length ?? 0) > 0 ? 'tool-calls' : 'stop',
    };
  }
}
