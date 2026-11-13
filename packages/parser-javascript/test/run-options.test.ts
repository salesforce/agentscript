/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, it } from 'vitest';
import NativeParser from 'tree-sitter';
import AgentScript from '@agentscript/parser-tree-sitter';
import { parse } from '../src/index.js';
import { normalizeSExp } from './test-utils.js';

const native = new NativeParser();
native.setLanguage(AgentScript as unknown as NativeParser.Language);

describe('run option parser parity', () => {
  it.each(['escalate', 'end_session'])(
    'preserves %s statement parsing inside run bodies',
    statement => {
      const source = `before_reasoning:\n    run @actions.Lookup\n        execution_mode: "fire_and_forget"\n        ${statement}\n`;
      const javascript = parse(source).rootNode;
      const tree = native.parse(source).rootNode;
      expect(javascript.hasError).toBe(false);
      expect(tree.hasError).toBe(false);
      expect(normalizeSExp(javascript.toSExp())).toBe(
        normalizeSExp(tree.toString())
      );
    }
  );

  it('retains malformed set recovery', () => {
    const source =
      'before_reasoning:\n    run @actions.Lookup\n        set @variables.result @outputs.value\n';
    const javascript = parse(source).rootNode;
    expect(javascript.toSExp()).toContain('set_statement');
    expect(javascript.toSExp()).toContain('member_expression');
  });
});
