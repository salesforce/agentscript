/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Skills compilation tests.
 *
 * Verifies that a subagent's `skills:` block compiles into a `skills`
 * array on the SubAgentNode JSON output.
 */
import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import { parseSource } from './test-utils.js';

describe('skills compilation', () => {
  it('compiles a subagent with multiple skills into a skills array, stripping the URI scheme', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent main:
    description: "Entry"
    reasoning:
        instructions: ->
            | start

subagent skilled_agent:
    description: "Subagent with skills"
    skills:
        skill_one:
            target: "skill://SkillOne_v1"
        skill_two:
            target: "skill://SkillTwo_v2"
    reasoning:
        instructions: ->
            | act
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'skilled_agent'
    )!;

    expect(node).toBeDefined();
    expect(node.skills).toEqual([
      { name: 'skill_one', target: 'SkillOne_v1' },
      { name: 'skill_two', target: 'SkillTwo_v2' },
    ]);
  });

  it('compiles skills on a start_agent block', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent main:
    description: "Entry with skills"
    skills:
        starter_skill:
            target: "skill://Starter_v1"
    reasoning:
        instructions: ->
            | start
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'main'
    )!;

    expect(node).toBeDefined();
    expect(node.skills).toEqual([
      { name: 'starter_skill', target: 'Starter_v1' },
    ]);
  });

  it('strips arbitrary URI schemes and leaves bare identifiers untouched', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent main:
    description: "Entry"
    reasoning:
        instructions: ->
            | start

subagent skilled_agent:
    description: "Mixed scheme targets"
    skills:
        scheme_https:
            target: "https://example.com/skill/X_v1"
        scheme_custom:
            target: "foo.bar+baz://Custom_v3"
        bare:
            target: "Bare_v2"
    reasoning:
        instructions: ->
            | act
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'skilled_agent'
    )!;

    expect(node).toBeDefined();
    expect(node.skills).toEqual([
      { name: 'scheme_https', target: 'example.com/skill/X_v1' },
      { name: 'scheme_custom', target: 'Custom_v3' },
      { name: 'bare', target: 'Bare_v2' },
    ]);
  });

  it('omits the skills field when no skills are declared', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent main:
    description: "Entry"
    reasoning:
        instructions: ->
            | start

subagent plain_agent:
    description: "No skills here"
    reasoning:
        instructions: ->
            | act
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'plain_agent'
    )!;

    expect(node).toBeDefined();
    expect(node.skills).toBeUndefined();
  });
});
