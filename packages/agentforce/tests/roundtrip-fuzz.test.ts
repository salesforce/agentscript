/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, test, expect } from 'vitest';
import { parse } from '../src/index.js';

/**
 * Roundtrip fuzz tests — reproducing bugs found when tab characters are used
 * for indentation instead of spaces.
 *
 * Bug 1: Action block children lose their indentation (flatten to parent level)
 * Bug 2: Multiline arrow instructions (`->`) become non-idempotent — the pipe
 *         line (`| text`) moves to the end of the block on re-emit.
 */

// ── Bug 1: Tab indentation collapses action block child indentation ─────────

describe('tab indentation collapses action block structure', () => {
  // Space-indented version — the "known good" baseline
  const spaceSource = [
    'system:',
    '  instructions: "Hello"',
    '',
    'start_agent greeting:',
    '    description: "Greet"',
    '    actions:',
    '    collect_info:',
    '        description: "collect info"',
    '        inputs:',
    '            name: string',
    '        outputs:',
    '            name: string',
    '        target: "apex://collect_info"',
  ].join('\n');

  // Tab-indented version — identical structure, just tabs
  const tabSource = [
    'system:',
    '  instructions: "Hello"',
    '',
    'start_agent greeting:',
    '\tdescription: "Greet"',
    '\tactions:',
    '\tcollect_info:',
    '\t\tdescription: "collect info"',
    '\t\tinputs:',
    '\t\t\tname: string',
    '\t\toutputs:',
    '\t\t\tname: string',
    '\t\ttarget: "apex://collect_info"',
  ].join('\n');

  test('space-indented: action children are indented under their parent', () => {
    const emitted = parse(spaceSource).emit();

    // `description: "collect info"` should be indented MORE than `collect_info:`
    const lines = emitted.split('\n');
    const collectInfoLine = lines.find(l =>
      l.trimStart().startsWith('collect_info:')
    );
    const descriptionLine = lines.find(l =>
      l.includes('description: "collect info"')
    );

    expect(collectInfoLine).toBeDefined();
    expect(descriptionLine).toBeDefined();

    const collectIndent = collectInfoLine!.search(/\S/);
    const descIndent = descriptionLine!.search(/\S/);
    expect(descIndent).toBeGreaterThan(collectIndent);
  });

  test('tab-indented: action children should be indented under their parent', () => {
    const emitted = parse(tabSource).emit();

    // Same assertion: `description` should be nested deeper than `collect_info:`
    const lines = emitted.split('\n');
    const collectInfoLine = lines.find(l =>
      l.trimStart().startsWith('collect_info:')
    );
    const descriptionLine = lines.find(l =>
      l.includes('description: "collect info"')
    );

    expect(collectInfoLine).toBeDefined();
    expect(descriptionLine).toBeDefined();

    const collectIndent = collectInfoLine!.search(/\S/);
    const descIndent = descriptionLine!.search(/\S/);

    // BUG: with tabs, both lines end up at the SAME indent level.
    // The action's children collapse to their parent's level.
    expect(descIndent).toBeGreaterThan(collectIndent);
  });

  test('tab-indented: inputs/outputs should be indented under collect_info', () => {
    const emitted = parse(tabSource).emit();
    const lines = emitted.split('\n');

    const collectInfoLine = lines.find(l =>
      l.trimStart().startsWith('collect_info:')
    );
    const inputsLine = lines.find(l => l.trimStart().startsWith('inputs:'));
    const targetLine = lines.find(l =>
      l.includes('target: "apex://collect_info"')
    );

    expect(collectInfoLine).toBeDefined();
    expect(inputsLine).toBeDefined();
    expect(targetLine).toBeDefined();

    const collectIndent = collectInfoLine!.search(/\S/);
    const inputsIndent = inputsLine!.search(/\S/);
    const targetIndent = targetLine!.search(/\S/);

    // BUG: inputs and target flatten to the same level as collect_info
    expect(inputsIndent).toBeGreaterThan(collectIndent);
    expect(targetIndent).toBeGreaterThan(collectIndent);
  });

  test('tab and space indentation produce identical parsed structure', () => {
    const spaceDoc = parse(spaceSource);
    const tabDoc = parse(tabSource);

    const spaceAgent = spaceDoc.ast.start_agent.get('greeting');
    const tabAgent = tabDoc.ast.start_agent.get('greeting');

    // Key properties should match regardless of indentation style
    expect(tabAgent.description.value).toBe(spaceAgent.description.value);
    expect(tabDoc.errors.length).toBe(spaceDoc.errors.length);
    expect(tabDoc.warnings.length).toBe(spaceDoc.warnings.length);
    expect(tabDoc.ast.system.instructions.value).toBe(
      spaceDoc.ast.system.instructions.value
    );
  });
});

// ── Bug 2: Multiline arrow instructions non-idempotent with tabs ────────────

describe('tab indentation causes non-idempotent multiline instructions', () => {
  const source = [
    'system:',
    '  instructions: "Hello"',
    '',
    'start_agent greeting:',
    '\tdescription: "Greet"',
    '\treasoning:',
    '\tinstructions:->',
    "\t\t| Hello! I'm here to help.",
    '\t\t\tCould you tell me your name?',
    '\tactions:',
    '\t\tcollect_info: @actions.collect_info',
    '\t\t\twith name=@variables.name',
  ].join('\n');

  test('emit is idempotent: parse(emit1).emit() === emit1', () => {
    const emit1 = parse(source).emit();
    const emit2 = parse(emit1).emit();

    // BUG: The `| Hello!` pipe line moves from before `Could you tell me`
    // to AFTER the actions block on the second emit.
    expect(emit2).toBe(emit1);
  });

  test('pipe line stays before continuation line across roundtrips', () => {
    const emit1 = parse(source).emit();
    const emit2 = parse(emit1).emit();

    const pipeIdx1 = emit1.indexOf('| Hello!');
    const contIdx1 = emit1.indexOf('Could you tell me');
    const pipeIdx2 = emit2.indexOf('| Hello!');
    const contIdx2 = emit2.indexOf('Could you tell me');

    // In emit1, pipe comes before continuation — correct
    expect(pipeIdx1).toBeLessThan(contIdx1);

    // BUG: In emit2, pipe moves AFTER continuation (and after actions block)
    expect(pipeIdx2).toBeLessThan(contIdx2);
  });

  // Same bug with two topics
  const twoTopicSource = [
    'system:',
    '  instructions: "You are a helpful assistant"',
    '  messages:',
    '    welcome: "hello"',
    '    error: "goodbye"',
    'config:',
    '  developer_name: "TwoTopic"',
    '  agent_id: "1"',
    '  agent_type: "AgentforceServiceAgent"',
    '  default_agent_user: "service_user"',
    '',
    'language:',
    '  default_locale: "en_US"',
    '',
    'variables:',
    '  name: mutable string',
    '  issue: mutable string',
    '',
    'start_agent greeting:',
    '\tdescription: "Greet the customer"',
    '\tactions:',
    '\tcollect_info:',
    '\t\tdescription: "collect info"',
    '\t\tinputs:',
    '\t\t\tname: string',
    '\t\toutputs:',
    '\t\t\tname: string',
    '\t\ttarget: "apex://collect_info"',
    '\treasoning:',
    '\tinstructions:->',
    "\t\t| Hello! I'm here to help you today.",
    '\t\t\tCould you please tell me your name?',
    '\tactions:',
    '\t\tcollect_info: @actions.collect_info',
    '\t\t\twith name=@variables.name, issue=@variables.issue',
    '',
    'topic hello:',
    '\tdescription: "Say hello"',
    '\tactions:',
    '\tcollect_info:',
    '\t\tdescription: "collect info"',
    '\t\tinputs:',
    '\t\t\tname: string',
    '\t\toutputs:',
    '\t\t\tname: string',
    '\t\ttarget: "apex://collect_info"',
    '\treasoning:',
    '\tinstructions:->',
    "\t\t| Hello! I'm here to help you today.",
    '\t\t\tCould you please tell me your name?',
    '\tactions:',
    '\t\tcollect_info: @actions.collect_info',
    '\t\t\twith name=@variables.name, issue=@variables.issue',
  ].join('\n');

  test('two_topic: emit is idempotent', () => {
    const emit1 = parse(twoTopicSource).emit();
    const emit2 = parse(emit1).emit();

    // BUG: pipe lines float to end of each topic block on second roundtrip
    expect(emit2).toBe(emit1);
  });
});
