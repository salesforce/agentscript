/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Skills compilation tests.
 *
 * Skills are declared once in a top-level `skill_definitions:` block (compiled
 * into `agent_version.skill_definitions`) and referenced by local handle from a
 * subagent's `reasoning.skills` map (compiled into `node.skills`, an array of
 * `{ name: handle, target: definition }` references).
 */
import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import { parseSource, checkSchemaConformance } from './test-utils.js';

// Narrow the loosely-typed `agent_version` bag to the skill_definitions table.
function skillDefinitionsOf(output: {
  agent_version: Record<string, unknown>;
}): Array<Record<string, unknown>> {
  return (output.agent_version.skill_definitions ?? []) as Array<
    Record<string, unknown>
  >;
}

describe('skill_definitions compilation', () => {
  it('compiles multiple stored skills into the top-level table, stripping the URI scheme', () => {
    const source = `
config:
    agent_name: "TestBot"

skill_definitions:
    skill_one:
        target: "skill://SkillOne_v1"
    skill_two:
        target: "skill://SkillTwo_v2"

start_agent main:
    description: "Entry"
    reasoning:
        instructions: ->
            | start
`;
    const { output } = compile(parseSource(source));

    expect(skillDefinitionsOf(output)).toEqual([
      { name: 'skill_one', target: 'SkillOne_v1' },
      { name: 'skill_two', target: 'SkillTwo_v2' },
    ]);
  });

  it('strips arbitrary URI schemes and leaves bare identifiers untouched', () => {
    const source = `
config:
    agent_name: "TestBot"

skill_definitions:
    scheme_https:
        target: "https://example.com/skill/X_v1"
    scheme_custom:
        target: "foo.bar+baz://Custom_v3"
    bare:
        target: "Bare_v2"

start_agent main:
    description: "Entry"
    reasoning:
        instructions: ->
            | start
`;
    const { output } = compile(parseSource(source));

    expect(skillDefinitionsOf(output)).toEqual([
      { name: 'scheme_https', target: 'example.com/skill/X_v1' },
      { name: 'scheme_custom', target: 'Custom_v3' },
      { name: 'bare', target: 'Bare_v2' },
    ]);
  });

  it('compiles an inline skill, carrying instructions/description/label without a target', () => {
    const source = `
config:
    agent_name: "TestBot"

skill_definitions:
    credit_check_skill:
        label: "Credit Check"
        description: "Use this when the user asks for a credit check"
        instructions: |
            When user asks to do B, use tool B-t1.
            If B-t1 returns an empty list, use tool B-t2.

start_agent main:
    description: "Entry"
    reasoning:
        instructions: ->
            | start
`;
    const { output } = compile(parseSource(source));
    const defs = skillDefinitionsOf(output);

    expect(defs).toEqual([
      {
        name: 'credit_check_skill',
        label: 'Credit Check',
        description: 'Use this when the user asks for a credit check',
        content:
          'When user asks to do B, use tool B-t1.\n' +
          'If B-t1 returns an empty list, use tool B-t2.',
      },
    ]);
    // Inline skills carry no target.
    expect(defs[0].target).toBeUndefined();
  });

  it('carries a multi-line templated inline skill verbatim, interpolation included', () => {
    const source = `
config:
    agent_name: "TestBot"

variables:
    customer_name: mutable string = "there"

skill_definitions:
    credit_check_skill:
        description: "Use this when the user asks for a credit check"
        instructions: |
            ---
            name: credit_check
            ---
            # Credit Check

            Greet {!@variables.customer_name} before starting.

            1. Call tool A.
            2. If A returns an empty list, call tool B.

start_agent main:
    description: "Entry"
    reasoning:
        instructions: ->
            | start
`;
    const { output } = compile(parseSource(source));

    // The SKILL.md body is carried verbatim: blank lines and YAML frontmatter
    // are preserved, and `{!...}` interpolation is NOT evaluated at compile
    // time — the runtime owns template expansion.
    expect(skillDefinitionsOf(output)).toEqual([
      {
        name: 'credit_check_skill',
        description: 'Use this when the user asks for a credit check',
        content:
          '---\n' +
          'name: credit_check\n' +
          '---\n' +
          '# Credit Check\n' +
          '\n' +
          'Greet {!@variables.customer_name} before starting.\n' +
          '\n' +
          '1. Call tool A.\n' +
          '2. If A returns an empty list, call tool B.',
      },
    ]);
  });

  it('compiles a mix of stored and inline skills', () => {
    const source = `
config:
    agent_name: "TestBot"

skill_definitions:
    stored_skill:
        target: "skill://Stored_v1"
    inline_skill:
        description: "Inline one"
        instructions: "Do the inline thing."

start_agent main:
    description: "Entry"
    reasoning:
        instructions: ->
            | start
`;
    const { output } = compile(parseSource(source));

    expect(skillDefinitionsOf(output)).toEqual([
      { name: 'stored_skill', target: 'Stored_v1' },
      {
        name: 'inline_skill',
        description: 'Inline one',
        content: 'Do the inline thing.',
      },
    ]);
  });

  it('omits skill_definitions when none are declared', () => {
    const source = `
config:
    agent_name: "TestBot"

start_agent main:
    description: "Entry"
    reasoning:
        instructions: ->
            | start
`;
    const { output } = compile(parseSource(source));

    expect(
      (output.agent_version as Record<string, unknown>).skill_definitions
    ).toBeUndefined();
  });
});

describe('node skill references', () => {
  it('resolves a handle→definition map into node.skills as { name, target }', () => {
    // The map key is the LLM-facing local handle (compiles to `name`); the
    // `@skill_definitions.<def>` value it binds to compiles to `target`. This is
    // the canonical authoring shape: a stored skill and an inline skill, each
    // bound to a distinct handle.
    const source = `
config:
    agent_name: "TestBot"

skill_definitions:
    myStoredSkill:
        target: "skill://Helper_v1"
    myInlineSkill:
        description: "Helper skill"
        instructions: |
            # Helper
            Inline body.

start_agent main:
    description: "Entry"
    reasoning:
        instructions: ->
            | start

subagent skilled_agent:
    description: "References a stored and an inline skill by handle"
    reasoning:
        instructions: ->
            | act
        skills:
            my_stored_skill: @skill_definitions.myStoredSkill
            my_inline_skill: @skill_definitions.myInlineSkill
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'skilled_agent'
    )!;

    expect(node).toBeDefined();
    // Map order is preserved; handle → name, definition → target.
    expect(node.skills).toEqual([
      { name: 'my_stored_skill', target: 'myStoredSkill' },
      { name: 'my_inline_skill', target: 'myInlineSkill' },
    ]);
  });

  it('resolves a single-entry skills map into node.skills', () => {
    const source = `
config:
    agent_name: "TestBot"

skill_definitions:
    myStoredSkill:
        target: "skill://Helper_v1"

start_agent main:
    description: "Entry"
    reasoning:
        instructions: ->
            | start

subagent skilled_agent:
    description: "References a single top-level skill by handle"
    reasoning:
        instructions: ->
            | act
        skills:
            my_stored_skill: @skill_definitions.myStoredSkill
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'skilled_agent'
    )!;

    expect(node).toBeDefined();
    expect(node.skills).toEqual([
      { name: 'my_stored_skill', target: 'myStoredSkill' },
    ]);
  });

  it('errors when a skills handle binds to a non-skill_definitions reference', () => {
    const source = `
config:
    agent_name: "TestBot"

skill_definitions:
    myStoredSkill:
        target: "skill://Helper_v1"

start_agent main:
    description: "Entry"
    reasoning:
        instructions: ->
            | start

subagent skilled_agent:
    description: "Binds a handle to the wrong namespace"
    reasoning:
        instructions: ->
            | act
        skills:
            bad: @actions.somethingElse
`;
    const { diagnostics } = compile(parseSource(source));
    const err = diagnostics.find(d =>
      d.message.includes("Node-level skill 'bad' must reference")
    );
    expect(err).toBeDefined();
  });

  it('errors when reasoning.skills is declared on a router (hyperclassifier) node', () => {
    // A node with a hyperclassifier model_config compiles to a RouterNode,
    // whose wire has no `skills` field. Skills declared here would be silently
    // dropped, so the compiler flags them instead.
    const source = `
config:
    agent_name: "TestBot"

skill_definitions:
    myStoredSkill:
        target: "skill://Helper_v1"

start_agent main:
    description: "Entry"
    model_config:
        model: "model://sfdc_ai__DefaultEinsteinHyperClassifier"
    reasoning:
        instructions: ->
            | start
        skills:
            my_stored_skill: @skill_definitions.myStoredSkill
`;
    const { output, diagnostics } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'main'
    )!;

    // Confirms the node really is a router (the branch that drops skills).
    expect(node.type).toBe('router');
    const err = diagnostics.find(
      d => d.code === 'skills-not-supported-on-router'
    );
    expect(err).toBeDefined();
    expect(err!.message).toContain("Node 'main' declares reasoning.skills");
  });

  it('omits the node skills field when reasoning declares no skill references', () => {
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

// End-to-end conformance: the emitted `skill_definitions` table and the node
// `{ name, target }` skill refs must both validate against the regenerated Zod
// schema (DSL_GIT_SHA pinned to the agent-dsl `{ name, target }` change). This
// proves the compiler output matches the wire shape, not just our expectations.
describe('skills: generated-schema conformance', () => {
  it('emits skill_definitions + node skill refs that conform to the generated schema', () => {
    const source = `
config:
    agent_name: "TestBot"

skill_definitions:
    myStoredSkill:
        target: "skill://Helper_v1"
    myInlineSkill:
        description: "Helper skill"
        instructions: |
            # Helper
            Inline body.

start_agent main:
    description: "Entry"
    reasoning:
        instructions: ->
            | start

subagent skilled_agent:
    description: "References a stored and an inline skill by handle"
    reasoning:
        instructions: ->
            | act
        skills:
            my_stored_skill: @skill_definitions.myStoredSkill
            my_inline_skill: @skill_definitions.myInlineSkill
`;
    const { output } = compile(parseSource(source));
    const violations = checkSchemaConformance(output);
    expect(violations).toEqual([]);
  });
});
