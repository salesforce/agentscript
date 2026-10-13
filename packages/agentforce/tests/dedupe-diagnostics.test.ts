/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, test, expect } from 'vitest';
import { parseAndLint } from '@agentscript/language';
import { agentforceDialect } from '@agentscript/agentforce-dialect';
import { compile } from '@agentscript/compiler';
import type { ParsedAgentforce } from '@agentscript/agentforce-dialect';
import { compileSource } from '../src/index.js';
import { getParser } from '../src/parser.js';

// A placeholder-target action is one of the few diagnostics that BOTH the
// dialect lint pass (action-target) and the compiler (compile-actions) raise
// with the exact same message at the exact same range — so it is a real,
// naturally-occurring cross-step duplicate, not a synthetic one.
const SOURCE = `config:
    agent_name: "PlaceholderBot"
    default_agent_user: "user@test.com"

start_agent main:
    description: "Agent with a placeholder action"

    actions:
        Stub_Action:
            description: "A placeholder action for future implementation"
            target: "placeholder://future_feature"
            inputs:
                stub_input: string
                    label: "Stub Input"

    reasoning:
        instructions: ->
            | You have access to a placeholder action.

        actions:
            Use_Stub: @actions.Stub_Action
                with stub_input=...
`;

const PLACEHOLDER_MESSAGE =
  'uses a placeholder target "placeholder://future_feature"';

describe('compileSource cross-step diagnostic de-duplication', () => {
  test('lint and compile both raise the identical placeholder diagnostic', () => {
    // Mirror compileSource's raw pipeline (parse + lint, then compile) WITHOUT
    // the de-dup step, to prove the duplicate genuinely exists across steps.
    const parser = getParser();
    const tree = parser.parse(SOURCE);
    const parseResult = parseAndLint(tree.rootNode, agentforceDialect);
    const compileResult = compile(parseResult.ast as ParsedAgentforce);

    const raw = [
      ...parseResult.diagnostics,
      ...compileResult.diagnostics,
    ].filter(d => d.message.includes(PLACEHOLDER_MESSAGE));

    // One from lint, one from compile — same message, same range.
    expect(raw).toHaveLength(2);
    expect(raw[0].message).toBe(raw[1].message);
    expect(raw[0].range).toEqual(raw[1].range);
  });

  test('compileSource collapses the duplicate to a single diagnostic', () => {
    const { diagnostics } = compileSource(SOURCE);
    const placeholder = diagnostics.filter(d =>
      d.message.includes(PLACEHOLDER_MESSAGE)
    );
    expect(placeholder).toHaveLength(1);
  });
});

// The set-variables-chaining lint pass and compile-set-variables both flag a
// clause chained onto @utils.setVariables. The compiler copy guards raw
// compile() callers (which skip lint); these tests pin the two messages as
// identical so the editor never shows a double squiggle.
const CHAINED_SET_VARIABLES_SOURCE = `config:
    agent_name: "ChainedBot"
    default_agent_user: "user@test.com"

variables:
    user_name: mutable string

start_agent main:
    description: "Agent with a chained setVariables action"

    actions:
        some_action:
            description: "Some action"
            target: "flow://SomeAction"

    reasoning:
        instructions: ->
            | Capture the name.

        actions:
            capture_name: @utils.setVariables
                with user_name=...
                run @actions.some_action
`;

const CHAINED_MESSAGE = 'cannot have transitions or follow-up actions';

describe('compileSource de-duplicates the setVariables chaining diagnostic', () => {
  test('lint and compile both raise the identical chaining diagnostic', () => {
    const parser = getParser();
    const tree = parser.parse(CHAINED_SET_VARIABLES_SOURCE);
    const parseResult = parseAndLint(tree.rootNode, agentforceDialect);
    const compileResult = compile(parseResult.ast as ParsedAgentforce);

    const lint = parseResult.diagnostics.filter(d =>
      d.message.includes(CHAINED_MESSAGE)
    );
    const compiled = compileResult.diagnostics.filter(d =>
      d.message.includes(CHAINED_MESSAGE)
    );

    expect(lint).toHaveLength(1);
    expect(compiled).toHaveLength(1);
    expect(lint[0].message).toBe(compiled[0].message);
    expect(lint[0].range).toEqual(compiled[0].range);
  });

  test('compileSource collapses the duplicate to a single diagnostic', () => {
    const { diagnostics } = compileSource(CHAINED_SET_VARIABLES_SOURCE);
    const chained = diagnostics.filter(d =>
      d.message.includes(CHAINED_MESSAGE)
    );
    expect(chained).toHaveLength(1);
  });
});
