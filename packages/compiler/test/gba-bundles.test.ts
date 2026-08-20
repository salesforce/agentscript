/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import { parseSource } from './test-utils.js';

describe('GBA bundles compilation', () => {
  it('compiles bundles block with invocation_target_type derived from bundle:// scheme', () => {
    const source = `
config:
    developer_name: "TestAgent"
    agent_type: "GoalBasedAgent"
    default_agent_user: "test_user"

bundles:
    prospecting:
        target: "bundle://prospecting"
    targeting:
        target: "bundle://targeting"

start_agent main:
    description: "Entry point"
    reasoning:
        instructions: ->
            | Route to appropriate handler.
`;

    const result = compile(parseSource(source));

    expect(result.output.agent_version.bundles).toBeDefined();
    expect(result.output.agent_version.bundles).toHaveLength(2);

    const prospecting = result.output.agent_version.bundles?.find(
      p => p.name === 'prospecting'
    );
    expect(prospecting).toBeDefined();
    expect(prospecting?.invocation_target_type).toBe('bundle');
    expect(prospecting?.invocation_target_name).toBe('prospecting');

    const targeting = result.output.agent_version.bundles?.find(
      p => p.name === 'targeting'
    );
    expect(targeting).toBeDefined();
    expect(targeting?.invocation_target_type).toBe('bundle');
    expect(targeting?.invocation_target_name).toBe('targeting');
  });

  it('omits bundles field when no bundles block exists', () => {
    const source = `
config:
    developer_name: "TestAgent"
    agent_type: "GoalBasedAgent"
    default_agent_user: "test_user"

start_agent main:
    description: "Entry point"
    reasoning:
        instructions: ->
            | Process request.
`;

    const result = compile(parseSource(source));

    expect(result.output.agent_version.bundles).toBeUndefined();
  });

  it('errors when target has no URI scheme', () => {
    const source = `
config:
    developer_name: "TestAgent"
    agent_type: "GoalBasedAgent"
    default_agent_user: "test_user"

bundles:
    bad:
        target: "prospecting"

start_agent main:
    description: "Entry point"
    reasoning:
        instructions: ->
            | Process request.
`;

    const result = compile(parseSource(source));

    expect(result.diagnostics.some(d => d.message.includes('URI scheme'))).toBe(
      true
    );
    expect(result.output.agent_version.bundles).toBeUndefined();
  });

  it('errors when target uses an unsupported scheme', () => {
    const source = `
config:
    developer_name: "TestAgent"
    agent_type: "GoalBasedAgent"
    default_agent_user: "test_user"

bundles:
    bad:
        target: "agent://something"

start_agent main:
    description: "Entry point"
    reasoning:
        instructions: ->
            | Process request.
`;

    const result = compile(parseSource(source));

    expect(
      result.diagnostics.some(d => d.message.includes('unsupported scheme'))
    ).toBe(true);
    expect(result.output.agent_version.bundles).toBeUndefined();
  });

  it('handles single bundle', () => {
    const source = `
config:
    developer_name: "TestAgent"
    agent_type: "GoalBasedAgent"
    default_agent_user: "test_user"

bundles:
    email:
        target: "bundle://email"

start_agent main:
    description: "Entry point"
    reasoning:
        instructions: ->
            | Send emails.
`;

    const result = compile(parseSource(source));

    expect(result.output.agent_version.bundles).toBeDefined();
    expect(result.output.agent_version.bundles).toHaveLength(1);
    expect(result.output.agent_version.bundles?.[0].name).toBe('email');
    expect(
      result.output.agent_version.bundles?.[0].invocation_target_type
    ).toBe('bundle');
    expect(
      result.output.agent_version.bundles?.[0].invocation_target_name
    ).toBe('email');
  });
});
