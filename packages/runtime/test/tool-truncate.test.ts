import { describe, it, expect } from 'vitest';
import {
  truncateToolResult,
  MAX_TOOL_RESULT_CHARS,
} from '../src/tools/truncate.js';
import { ToolRegistry } from '../src/tools/registry.js';
import type {
  ToolAdapter,
  ToolAdapterInvocation,
} from '../src/tools/registry.js';

describe('truncateToolResult', () => {
  it('passes through results under budget', () => {
    const result = { output: 'short output', status: 'ok' };
    const truncated = truncateToolResult(result);
    expect(truncated).toEqual(result);
  });

  it('truncates oversized string output with head+tail retention', () => {
    const large = 'a'.repeat(150_000);
    const result = { output: large };
    const truncated = truncateToolResult(result);

    expect(typeof truncated.output).toBe('string');
    const output = truncated.output as string;

    // Should be smaller than original
    expect(output.length).toBeLessThan(large.length);
    // Should contain head (first ~90% of 100K = 90K 'a's)
    expect(output.slice(0, 1000)).toBe('a'.repeat(1000));
    // Should contain tail (last ~10% of 100K = 10K 'a's) after the marker
    expect(output.slice(output.length - 1000)).toBe('a'.repeat(1000));
    // Should contain the truncation marker
    expect(output).toContain('[Output truncated: removed');
    expect(output).toContain('characters');
  });

  it('states the exact removed character count in the marker', () => {
    const large = 'x'.repeat(120_000);
    const result = { output: large };
    const truncated = truncateToolResult(result);

    const output = truncated.output as string;
    // 120K - 90K (head) - 10K (tail) = 20K removed
    expect(output).toContain('[Output truncated: removed 20000 characters');
  });

  it('preserves non-string fields untouched', () => {
    const result = {
      output: 'text',
      count: 42,
      flag: true,
      nested: { key: 'value' },
      list: [1, 2, 3],
    };
    const truncated = truncateToolResult(result);
    expect(truncated.count).toBe(42);
    expect(truncated.flag).toBe(true);
    expect(truncated.nested).toEqual({ key: 'value' });
    expect(truncated.list).toEqual([1, 2, 3]);
  });

  it('truncates multiple string fields independently', () => {
    const large1 = 'a'.repeat(150_000);
    const large2 = 'b'.repeat(110_000);
    const result = { output: large1, error: large2, small: 'tiny' };
    const truncated = truncateToolResult(result);

    expect((truncated.output as string).length).toBeLessThan(large1.length);
    expect((truncated.error as string).length).toBeLessThan(large2.length);
    expect(truncated.output as string).toContain('[Output truncated');
    expect(truncated.error as string).toContain('[Output truncated');
    expect(truncated.small).toBe('tiny');
  });

  it('handles exact-boundary case (exactly maxChars)', () => {
    const exact = 'z'.repeat(MAX_TOOL_RESULT_CHARS);
    const result = { output: exact };
    const truncated = truncateToolResult(result);
    // Should pass through untouched (not over budget)
    expect(truncated.output).toBe(exact);
    expect(truncated.output as string).not.toContain('[Output truncated');
  });

  it('handles empty and undefined fields', () => {
    const result = { output: '', error: undefined, flag: null };
    const truncated = truncateToolResult(result);
    expect(truncated.output).toBe('');
    expect(truncated.error).toBeUndefined();
    expect(truncated.flag).toBeNull();
  });

  it('respects custom maxChars option', () => {
    const medium = 'x'.repeat(5000);
    const result = { output: medium };
    const truncated = truncateToolResult(result, {
      maxChars: 2000,
      headChars: 1500,
      tailChars: 500,
    });

    const output = truncated.output as string;
    expect(output.length).toBeLessThan(medium.length);
    expect(output).toContain('[Output truncated');
    // 5000 - 1500 - 500 = 3000 removed
    expect(output).toContain('removed 3000 characters');
  });
});

describe('ToolRegistry truncation integration', () => {
  class MockAdapter implements ToolAdapter {
    async invoke({
      target,
    }: ToolAdapterInvocation): Promise<Record<string, unknown>> {
      if (target === 'fn://large_output') {
        return { output: 'L'.repeat(150_000), status: 'ok' };
      }
      if (target === 'fn://small_output') {
        return { output: 'small result' };
      }
      return {};
    }
  }

  it('truncates large tool results through the registry', async () => {
    const registry = new ToolRegistry();
    registry.register('fn', new MockAdapter());

    const result = await registry.invoke('fn://large_output', {});
    expect(result.status).toBe('ok');
    expect(typeof result.output).toBe('string');
    const output = result.output as string;
    expect(output.length).toBeLessThan(150_000);
    expect(output).toContain('[Output truncated');
  });

  it('passes through small results untouched', async () => {
    const registry = new ToolRegistry();
    registry.register('fn', new MockAdapter());

    const result = await registry.invoke('fn://small_output', {});
    expect(result.output).toBe('small result');
  });

  it('respects custom maxResultChars option', async () => {
    const registry = new ToolRegistry({ maxResultChars: 1000 });
    registry.register('fn', new MockAdapter());

    const result = await registry.invoke('fn://large_output', {});
    const output = result.output as string;
    expect(output).toContain('[Output truncated');
    // Much smaller than 150K due to 1K budget
    expect(output.length).toBeLessThan(2000);
  });

  it('allows disabling truncation for testing', async () => {
    const registry = new ToolRegistry({ disableTruncation: true });
    registry.register('fn', new MockAdapter());

    const result = await registry.invoke('fn://large_output', {});
    const output = result.output as string;
    // Should be full 150K, no truncation
    expect(output.length).toBe(150_000);
    expect(output).not.toContain('[Output truncated');
  });
});
