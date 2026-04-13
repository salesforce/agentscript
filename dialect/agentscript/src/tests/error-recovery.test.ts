/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Tests for error recovery during parsing:
 * - Orphaned sibling adoption (bodyless named entries & singular Block fields)
 * - RunStatement ERROR recovery with `with ...`
 * - Duplicate-key false positive suppression for orphaned siblings
 */

import { describe, it, expect } from 'vitest';
import {
  parseDocument,
  parseWithDiagnostics,
  testSchemaCtx,
} from './test-utils.js';
import { collectDiagnostics } from '@agentscript/language';
import type { AstRoot } from '@agentscript/language';
import type { Diagnostic } from '@agentscript/types';
import { AgentScriptSchema } from '../schema.js';
import { createLintEngine } from '../lint/index.js';

/**
 * Full diagnostic pipeline: parse → collect AST diagnostics → lint.
 * Returns deduplicated diagnostics matching LSP behavior.
 */
function getAllDiagnostics(source: string): Diagnostic[] {
  const result = parseWithDiagnostics(source, AgentScriptSchema);
  const astDiags = collectDiagnostics(result.value);
  const engine = createLintEngine();
  const { diagnostics: lintDiags } = engine.run(
    result.value as unknown as AstRoot,
    testSchemaCtx
  );

  const combined = [...result.diagnostics, ...astDiags, ...lintDiags];
  const seen = new Set<string>();
  return combined.filter(d => {
    const key = `${d.message}:${d.range.start.line}:${d.code}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// =============================================================================
// Orphaned sibling adoption
// =============================================================================

describe('orphaned sibling adoption', () => {
  const SOURCE_WITH_ERROR = `system:
  instructions: "You are a helpful agent"

config:
  developer_name: "Test"

start_agent greeting:
  description: "Greet the customer"
  actions:
    collect_info:
      description: "collect info"
      inputs:
        name: string
      outputs:
        name: string
        target: "apex://collect_info"

  reasoning:
    instructions:->
        | Hello! I'm here to help.
        run @actions.collect_info
          with ...
    actions:
        collect_info: @actions.collect_info
            with name=@variables.name

subagent hello:
  description: "Say hello to the world"
`;

  it('parses topic hello with its description (not orphaned)', () => {
    const doc = parseDocument(SOURCE_WITH_ERROR);
    const topicMap = doc.subagent;
    expect(topicMap).toBeDefined();

    const hello = topicMap?.get('hello');
    expect(hello).toBeDefined();
    expect(hello?.description?.value).toBe('Say hello to the world');
  });

  it('parses start_agent greeting reasoning with actions', () => {
    const doc = parseDocument(SOURCE_WITH_ERROR);
    const startAgentMap = doc.start_agent;
    expect(startAgentMap).toBeDefined();

    const greeting = startAgentMap?.get('greeting');
    expect(greeting).toBeDefined();
    expect(greeting?.reasoning).toBeDefined();
    expect(greeting?.reasoning?.actions).toBeDefined();
    expect(greeting?.reasoning?.actions?.size).toBeGreaterThanOrEqual(1);

    const actionNames: string[] = [];
    if (greeting?.reasoning?.actions) {
      for (const [name] of greeting.reasoning.actions.entries()) {
        actionNames.push(name as string);
      }
    }
    expect(actionNames).toContain('collect_info');
  });

  it('does not produce "Unknown block: description" diagnostic', () => {
    const diags = getAllDiagnostics(SOURCE_WITH_ERROR);
    const unknownBlock = diags.filter(
      d =>
        d.message.includes('Unknown block') && d.message.includes('description')
    );
    expect(unknownBlock).toHaveLength(0);
  });

  it('does not produce false "Missing required field: description" for topic', () => {
    const diags = getAllDiagnostics(SOURCE_WITH_ERROR);
    // Filter for required-field diagnostics about description on a topic line
    const missingDesc = diags.filter(
      d => d.code === 'required-field' && d.message.includes('description')
    );
    // If there are any, they should not be for the topic hello block
    // (which has line 27 in our source)
    const topicLine = SOURCE_WITH_ERROR.split('\n').findIndex(l =>
      l.startsWith('subagent hello:')
    );
    const topicMissing = missingDesc.filter(
      d => d.range.start.line === topicLine
    );
    expect(topicMissing).toHaveLength(0);
  });

  it('does not adopt same-level siblings (ambiguous indentation)', () => {
    // Two top-level blocks at column 0 — neither should adopt the other.
    const source = `subagent first:
  description: "I am first"

subagent second:
  description: "I am second"
`;
    const doc = parseDocument(source);
    const first = doc.subagent?.get('first');
    const second = doc.subagent?.get('second');
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first?.description?.value).toBe('I am first');
    expect(second?.description?.value).toBe('I am second');
  });

  it('does not adopt siblings at the same indent as a bodyless named entry', () => {
    // topic first: has no body, topic second: is at the same column.
    // second should NOT be adopted as a child of first.
    const source = `subagent first:
subagent second:
  description: "I am second"
`;
    const doc = parseDocument(source);
    const second = doc.subagent?.get('second');
    expect(second).toBeDefined();
    expect(second?.description?.value).toBe('I am second');
  });

  it('handles multiple consecutive bodyless entries each with indented children', () => {
    // Each topic is bodyless but followed by indented children.
    // Adoption should stop at the next same-level entry.
    const source = `subagent alpha:
  description: "Alpha desc"

subagent beta:
  description: "Beta desc"

subagent gamma:
  description: "Gamma desc"
`;
    const doc = parseDocument(source);
    expect(doc.subagent?.get('alpha')?.description?.value).toBe('Alpha desc');
    expect(doc.subagent?.get('beta')?.description?.value).toBe('Beta desc');
    expect(doc.subagent?.get('gamma')?.description?.value).toBe('Gamma desc');
  });

  it('adopts orphaned children inside a nested named entry (deeply nested)', () => {
    // Inside start_agent > actions > collect_info, the action block has
    // fields like inputs/outputs. If parser error recovery breaks
    // the nesting at the action level, adoption should still work because
    // parseMapping is recursive. Here `with ...` triggers an ERROR that
    // can scatter children — verify deeply nested fields survive.
    const source = `start_agent deep:
  description: "deeply nested test"
  actions:
    step_one:
      description: "first step"
      inputs:
        name: string
      outputs:
        result: string
        target: "apex://step_one"
    step_two:
      description: "second step"
      inputs:
        id: number
      outputs:
        status: string
        target: "apex://step_two"

  reasoning:
    instructions:->
        | Process steps in order.
        run @actions.step_one
          with ...
    actions:
        step_one: @actions.step_one
            with name=@variables.name
        step_two: @actions.step_two
            with id=@variables.id
`;
    const doc = parseDocument(source);
    const agent = doc.start_agent?.get('deep');
    expect(agent).toBeDefined();

    // Verify deeply nested action fields survived parsing
    const stepOne = agent?.actions?.get('step_one');
    expect(stepOne).toBeDefined();
    expect(stepOne?.description?.value).toBe('first step');
    expect(stepOne?.inputs).toBeDefined();
    expect(stepOne?.outputs).toBeDefined();

    const stepTwo = agent?.actions?.get('step_two');
    expect(stepTwo).toBeDefined();
    expect(stepTwo?.description?.value).toBe('second step');

    // Verify reasoning actions were adopted correctly at the nested level
    expect(agent?.reasoning?.actions).toBeDefined();
    expect(agent?.reasoning?.actions?.size).toBeGreaterThanOrEqual(2);
  });

  it('adoption inside nested block does not leak into parent scope', () => {
    // Two start_agents where error recovery in the first agent's reasoning
    // should not cause the second agent to be swallowed. This tests that
    // adoption boundaries are respected across nested block parsing.
    const source = `start_agent first_agent:
  description: "first"
  reasoning:
    instructions:->
        | Do stuff.
        run @actions.do_thing
          with ...
    actions:
        do_thing: @actions.do_thing
            with name=@variables.name

start_agent second_agent:
  description: "second"
  reasoning:
    instructions:->
        | Do other stuff.
`;
    const doc = parseDocument(source);
    const first = doc.start_agent?.get('first_agent');
    const second = doc.start_agent?.get('second_agent');
    expect(first).toBeDefined();
    expect(first?.description?.value).toBe('first');
    expect(first?.reasoning?.actions).toBeDefined();

    // second_agent must exist as its own block, not absorbed into first_agent
    expect(second).toBeDefined();
    expect(second?.description?.value).toBe('second');
    expect(second?.reasoning).toBeDefined();
  });

  it('singular Block field does not adopt siblings shallower than body column', () => {
    // reasoning: is a singular Block field. Its body children are indented
    // at col 4+. A sibling at col 2 (same as reasoning's own key) should
    // NOT be adopted into reasoning — it belongs to the parent start_agent.
    const source = `start_agent test:
  description: "test"
  reasoning:
    instructions:->
        | Hello
  actions:
    do_thing:
      description: "does a thing"
      inputs:
        name: string
      outputs:
        name: string
        target: "apex://do_thing"
`;
    const doc = parseDocument(source);
    const agent = doc.start_agent?.get('test');
    expect(agent).toBeDefined();
    expect(agent?.reasoning).toBeDefined();
    // actions: should be parsed as a sibling field of start_agent, not
    // adopted into reasoning
    expect(agent?.actions).toBeDefined();
    expect(agent?.actions?.size).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
// RunStatement `with ...` error recovery
// =============================================================================

describe('RunStatement with ... error recovery', () => {
  const SOURCE = `start_agent test:
  description: "test agent"
  actions:
    do_thing:
      description: "does a thing"
      inputs:
        name: string
      outputs:
        name: string
        target: "apex://do_thing"

  reasoning:
    instructions:->
        | Please help.
        run @actions.do_thing
          with ...
`;

  it('produces a syntax-error diagnostic for `with ...`', () => {
    const diags = getAllDiagnostics(SOURCE);
    const syntaxErrors = diags.filter(d => d.code === 'syntax-error');
    const withError = syntaxErrors.find(d => d.message.includes('with'));
    expect(withError).toBeDefined();
    expect(withError!.message).toContain('with');
    expect(withError!.message).toContain('named arguments');
  });

  it('diagnostic range is scoped to the `with ...` tokens, not the whole run statement', () => {
    const diags = getAllDiagnostics(SOURCE);
    const withError = diags.find(
      d => d.code === 'syntax-error' && d.message.includes('with')
    );
    expect(withError).toBeDefined();

    // The `with` keyword should be on the same line as `with ...`
    // The range should NOT span back to the `run @actions.do_thing` line
    const lines = SOURCE.split('\n');
    const withLine = lines.findIndex(l => l.trim().startsWith('with ...'));
    expect(withError!.range.start.line).toBe(withLine);
  });
});

// =============================================================================
// Duplicate-key false positive suppression
// =============================================================================

describe('duplicate-key suppression for orphaned siblings', () => {
  it('does not flag `actions` as duplicate when adopted at different columns', () => {
    // This source has `actions:` under start_agent (col 2) and
    // `actions:` under reasoning (col 8). Tree-sitter error recovery
    // may make both appear as siblings in the CST, but they are at
    // different indentation levels — not true duplicates.
    const source = `start_agent greeting:
  description: "Greet the customer"
  actions:
    collect_info:
      description: "collect info"
      inputs:
        name: string
      outputs:
        name: string
        target: "apex://collect_info"

  reasoning:
    instructions:->
        | Hello!
        run @actions.collect_info
          with ...
    actions:
        collect_info: @actions.collect_info
            with name=@variables.name

subagent hello:
  description: "Say hello"
`;
    const diags = getAllDiagnostics(source);
    const dupActions = diags.filter(
      d => d.code === 'duplicate-key' && d.message.includes("'actions'")
    );
    expect(dupActions).toHaveLength(0);
  });

  it('still flags real duplicate keys at the same column', () => {
    const source = `subagent main:
  description: "first"
  description: "second"
`;
    const diags = getAllDiagnostics(source);
    const dupDesc = diags.filter(
      d => d.code === 'duplicate-key' && d.message.includes("'description'")
    );
    expect(dupDesc).toHaveLength(1);
  });
});

// =============================================================================
// Missing value diagnostics
// =============================================================================

describe('missing-value diagnostic', () => {
  it('reports missing value for a primitive field (e.g., description:)', () => {
    const source = `start_agent greeting:
  description:
`;
    const diags = getAllDiagnostics(source);
    const missing = diags.filter(d => d.code === 'missing-value');
    expect(missing).toHaveLength(1);
    expect(missing[0].message).toContain('description');
  });

  it('does not report missing value when field has a value', () => {
    const source = `start_agent greeting:
  description: "Hello"
`;
    const diags = getAllDiagnostics(source);
    const missing = diags.filter(d => d.code === 'missing-value');
    expect(missing).toHaveLength(0);
  });

  it('reports missing value for multiple empty fields', () => {
    const source = `start_agent greeting:
  description:
  label:
`;
    const diags = getAllDiagnostics(source);
    const missing = diags.filter(d => d.code === 'missing-value');
    expect(missing).toHaveLength(2);
  });
});

// =============================================================================
// Missing type diagnostics (TypedMap entries)
// =============================================================================

describe('missing-type diagnostic', () => {
  it('reports missing type for a TypedMap entry (e.g., hack: in outputs)', () => {
    const source = `start_agent greeting:
  actions:
    collect_info:
      outputs:
        result: string
        hack:
`;
    const diags = getAllDiagnostics(source);
    const missing = diags.filter(d => d.code === 'missing-type');
    expect(missing).toHaveLength(1);
    expect(missing[0].message).toContain('hack');
  });

  it('reports missing type in variables block', () => {
    const source = `variables:
  name:
`;
    const diags = getAllDiagnostics(source);
    const missing = diags.filter(d => d.code === 'missing-type');
    expect(missing).toHaveLength(1);
    expect(missing[0].message).toContain('name');
  });

  it('does not report missing type when entry has a type', () => {
    const source = `variables:
  name: mutable string
  count: number
`;
    const diags = getAllDiagnostics(source);
    const missing = diags.filter(d => d.code === 'missing-type');
    expect(missing).toHaveLength(0);
  });

  it('reports missing type for multiple typeless entries', () => {
    const source = `start_agent greeting:
  actions:
    collect_info:
      inputs:
        name:
        issue:
`;
    const diags = getAllDiagnostics(source);
    const missing = diags.filter(d => d.code === 'missing-type');
    expect(missing).toHaveLength(2);
  });
});
