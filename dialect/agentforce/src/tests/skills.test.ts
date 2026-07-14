/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { parseWithDiagnostics } from './test-utils.js';

describe('skills', () => {
  it('parses per-subagent skill block', () => {
    const source = `subagent skilled_agent:
    description: "Demo"
    skills:
        skill_name_a:
            target: "skill://Developer_Name_v2"
`;

    const { value, diagnostics } = parseWithDiagnostics(source);

    expect(diagnostics).toEqual([]);

    const skilled = (
      value.subagent as unknown as {
        get(k: string): Record<string, unknown>;
      }
    ).get('skilled_agent');
    expect(skilled).toBeDefined();
    const skills = skilled?.skills as unknown as {
      get(k: string): Record<string, unknown>;
    };
    expect(skills).toBeDefined();

    const named = skills.get('skill_name_a') as
      | { target?: { value: string } }
      | undefined;
    expect(named).toBeDefined();
    expect(named?.target?.value).toBe('skill://Developer_Name_v2');
  });

  it('parses skills on a start_agent block', () => {
    const source = `start_agent main:
    description: "Entry"
    skills:
        starter_skill:
            target: "skill://Starter_v1"
`;

    const { value, diagnostics } = parseWithDiagnostics(source);

    expect(diagnostics).toEqual([]);

    const starter = (
      value.start_agent as unknown as {
        get(k: string): Record<string, unknown>;
      }
    ).get('main');
    expect(starter).toBeDefined();
    const skills = starter?.skills as unknown as {
      get(k: string): Record<string, unknown>;
    };
    expect(skills).toBeDefined();

    const named = skills.get('starter_skill') as
      | { target?: { value: string } }
      | undefined;
    expect(named).toBeDefined();
    expect(named?.target?.value).toBe('skill://Starter_v1');
  });
});
