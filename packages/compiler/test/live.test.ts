/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * live compilation tests — the top-level `live:` block (experimental) compiles
 * into agent_version.live (agent-dsl LiveConfiguration). Live is
 * agent-version-level config only; it is not part of the graph-MD schema.
 */
import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import { snakeKeysToCamel } from '../src/snake-to-camel.js';
import { agentDslAuthoring } from '../src/types.js';
import { parseSource } from './test-utils.js';

const agent = (liveBlock: string) => `
config:
    developer_name: "test_agent"
    agent_type: "AgentforceServiceAgent"
    default_agent_user: "test@example.com"
${liveBlock}
start_agent main:
    description: "Test agent"
`;

describe('live: compilation', () => {
  it('compiles enabled and params', () => {
    const { output, diagnostics } = compile(
      parseSource(
        agent(`
live:
    enabled: True
    params:
        provider: "openai"
        model: "gpt-live"
`)
      )
    );
    expect(diagnostics.filter(d => d.severity === 1)).toEqual([]);
    expect(output.agent_version.live).toEqual({
      enabled: true,
      params: { provider: 'openai', model: 'gpt-live' },
    });
  });

  it('compiles enabled: False', () => {
    const { output } = compile(
      parseSource(agent('live:\n    enabled: False\n'))
    );
    expect(output.agent_version.live).toEqual({ enabled: false });
  });

  it('defaults enabled to false and omits params for an empty live block', () => {
    const { output } = compile(parseSource(agent('live:\n')));
    expect(output.agent_version.live).toEqual({ enabled: false });
  });

  it('omits live when no live block is authored', () => {
    const { output } = compile(parseSource(agent('')));
    expect(output.agent_version.live).toBeUndefined();
    expect('live' in output.agent_version).toBe(false);
  });

  it('compiles params of each value type to plain values', () => {
    const { output } = compile(
      parseSource(
        agent(`
live:
    enabled: True
    params:
        provider: "openai"
        streaming: True
        max_sessions: 3
        tags: ["a", "b"]
        profile: {"locale": "en"}
`)
      )
    );
    expect(output.agent_version.live?.params).toEqual({
      provider: 'openai',
      streaming: true,
      max_sessions: 3,
      tags: ['a', 'b'],
      profile: { locale: 'en' },
    });
  });

  it('keeps a __proto__ key in a nested dict as data, not the prototype', () => {
    const { output } = compile(
      parseSource(
        agent(`
live:
    enabled: True
    params:
        profile: {"__proto__": {"polluted": True}, "locale": "en"}
`)
      )
    );
    const profile = output.agent_version.live?.params?.profile as Record<
      string,
      unknown
    >;
    expect(Object.getPrototypeOf(profile)).toBe(Object.prototype);
    expect((profile as { polluted?: unknown }).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(profile, '__proto__')).toBe(
      true
    );
    expect(JSON.parse(JSON.stringify(profile))).toEqual(
      JSON.parse('{"__proto__": {"polluted": true}, "locale": "en"}')
    );
  });

  it('output validates against the agent-dsl schema', () => {
    const { output } = compile(
      parseSource(
        agent(`
live:
    enabled: True
    params:
        provider: "openai"
        model: "gpt-live"
`)
      )
    );
    const parsed = agentDslAuthoring.safeParse(output);
    expect(parsed.success).toBe(true);
  });

  it('preserves user-defined param keys in camelCase output', () => {
    const result = compile(
      parseSource(
        agent(`
live:
    enabled: True
    params:
        voice_id: "v1"
        profile: {"default_locale": "en"}
`)
      )
    );
    const camel = snakeKeysToCamel(
      result.output,
      result.ranges,
      agentDslAuthoring
    ).value as { agentVersion: { live?: unknown } };
    expect(camel.agentVersion.live).toEqual({
      enabled: true,
      params: { voice_id: 'v1', profile: { default_locale: 'en' } },
    });
  });
});
