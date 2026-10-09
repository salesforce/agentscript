import { describe, it, expect } from 'vitest';
import { MockToolAdapter, FnAdapter, ToolRegistry } from '../src/index.js';

describe('MockToolAdapter', () => {
  it('returns the mocked value for an exact target match', async () => {
    const mocks = new Map<string, Record<string, unknown>>([
      ['fn://search_flights', { flight_number: 'MOCK-1' }],
    ]);
    const adapter = new MockToolAdapter(mocks);

    const result = await adapter.invoke({
      target: 'fn://search_flights',
      args: { destination: 'Tokyo' },
    });

    expect(result).toEqual({ flight_number: 'MOCK-1' });
  });

  it('delegates to the fallback adapter when the target is unknown', async () => {
    const fallback = new FnAdapter();
    fallback.register('get_weather', () => ({ summary: 'sunny' }));

    const adapter = new MockToolAdapter(new Map(), fallback);

    const result = await adapter.invoke({
      target: 'fn://get_weather',
      args: {},
    });

    expect(result).toEqual({ summary: 'sunny' });
  });

  it('throws when the target is unknown and no fallback is provided', async () => {
    const adapter = new MockToolAdapter(new Map());
    await expect(
      adapter.invoke({ target: 'fn://missing', args: {} })
    ).rejects.toThrow(/no mock or fallback adapter/i);
  });

  it('integrates with ToolRegistry under a scheme — mocks override fallback', async () => {
    const fallback = new FnAdapter();
    fallback.register('ping', () => ({ from: 'fallback' }));

    const mocks = new Map<string, Record<string, unknown>>([
      ['fn://ping', { from: 'mock' }],
    ]);
    const adapter = new MockToolAdapter(mocks, fallback);

    const registry = new ToolRegistry();
    registry.register('fn', adapter);

    const mocked = await registry.invoke('fn://ping', {});
    expect(mocked).toEqual({ from: 'mock' });

    // Unknown mock target falls through to fallback; FnAdapter with no
    // matching handler throws, surfacing as an error at the registry.
    await expect(registry.invoke('fn://other', {})).rejects.toThrow(
      /no fn handler/i
    );
  });
});
