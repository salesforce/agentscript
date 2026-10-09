import type {
  LlmDriver,
  LlmStepInput,
  StepEvent,
  ToolCall,
} from '../src/index.js';

/**
 * Scripted LLM driver for tests — returns a pre-recorded sequence of steps.
 * Each "script step" is a list of events (text chunks + tool calls) followed
 * by an implicit finish. One script step is consumed per `step()` call.
 */
export class ScriptedLlm implements LlmDriver {
  private idx = 0;
  readonly calls: LlmStepInput[] = [];
  constructor(
    private readonly script: Array<{ text?: string; toolCalls?: ToolCall[] }>
  ) {}

  // eslint-disable-next-line @typescript-eslint/require-await -- async generator required by LlmDriver interface; this scripted driver has nothing to await on
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
