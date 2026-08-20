/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { parseWithDiagnostics } from './test-utils.js';

describe('skills', () => {
  it('parses a top-level skill_definitions block (stored + inline)', () => {
    const source = `skill_definitions:
    myStoredSkill:
        target: "skill://Developer_Name_v2"
    myInlineSkill:
        instructions: "# Helper\\nInline body."
        description: "Helper skill"

start_agent main:
    description: "Entry"
`;

    const { value, diagnostics } = parseWithDiagnostics(source);

    expect(diagnostics).toEqual([]);

    const skills = value.skill_definitions as unknown as {
      get(k: string): Record<string, unknown>;
    };
    expect(skills).toBeDefined();

    const stored = skills.get('myStoredSkill') as
      | { target?: { value: string } }
      | undefined;
    expect(stored?.target?.value).toBe('skill://Developer_Name_v2');

    const inline = skills.get('myInlineSkill') as
      | { instructions?: { value: string }; description?: { value: string } }
      | undefined;
    expect(inline?.instructions?.value).toBe('# Helper\nInline body.');
    expect(inline?.description?.value).toBe('Helper skill');
  });

  it('parses a node-level reasoning.skills map (handle → @skill_definitions.<def>)', () => {
    const source = `skill_definitions:
    myStoredSkill:
        target: "skill://Developer_Name_v2"

subagent skilled_agent:
    description: "Demo"
    reasoning:
        skills:
            my_stored_skill: @skill_definitions.myStoredSkill
`;

    const { value, diagnostics } = parseWithDiagnostics(source);

    expect(diagnostics).toEqual([]);

    const subagents = value.subagent as unknown as {
      get(k: string): {
        reasoning?: { skills?: { get(k: string): Record<string, unknown> } };
      };
    };
    const skills = subagents.get('skilled_agent')?.reasoning?.skills;
    expect(skills).toBeDefined();

    // The map key is the local handle; its colinear value is the
    // `@skill_definitions.<def>` reference.
    const entry = skills!.get('my_stored_skill') as {
      __kind?: string;
      value?: {
        __kind?: string;
        object?: { name?: string };
        property?: string;
      };
    };
    expect(entry.__kind).toBe('ReasoningSkillBlock');
    expect(entry.value?.__kind).toBe('MemberExpression');
    expect(entry.value?.object?.name).toBe('skill_definitions');
    expect(entry.value?.property).toBe('myStoredSkill');
  });

  it('parses multiple node-level skill handles in reasoning.skills', () => {
    const source = `skill_definitions:
    skill_one:
        target: "skill://One_v1"
    skill_two:
        target: "skill://Two_v1"

subagent skilled_agent:
    description: "Demo"
    reasoning:
        skills:
            handle_one: @skill_definitions.skill_one
            handle_two: @skill_definitions.skill_two
`;

    const { value, diagnostics } = parseWithDiagnostics(source);

    expect(diagnostics).toEqual([]);

    const subagents = value.subagent as unknown as {
      get(k: string): {
        reasoning?: {
          skills?: { get(k: string): unknown; size?: number };
        };
      };
    };
    const skills = subagents.get('skilled_agent')?.reasoning?.skills;
    expect(skills?.get('handle_one')).toBeDefined();
    expect(skills?.get('handle_two')).toBeDefined();
  });

  it('parses a reasoning.skills map on a start_agent reasoning block', () => {
    const source = `skill_definitions:
    starter_skill:
        target: "skill://Starter_v1"

start_agent main:
    description: "Entry"
    reasoning:
        skills:
            starter: @skill_definitions.starter_skill
`;

    const { diagnostics } = parseWithDiagnostics(source);

    expect(diagnostics).toEqual([]);
  });
});
