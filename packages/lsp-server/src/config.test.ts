/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Smoke tests for lsp-server configuration assembly.
 *
 * Verifies that the TypeScript parser and dialect wiring work together
 * without starting an actual LSP connection.
 */

import { describe, test, expect } from 'vitest';
import { processDocument } from '@agentscript/lsp';
import { createServerConfig } from './config.js';

describe('lsp-server config', () => {
  test('createServerConfig returns a valid LspConfig', () => {
    const config = createServerConfig();
    expect(config.dialects.length).toBeGreaterThanOrEqual(2);
    expect(config.parser).toBeDefined();
    expect(config.enableCompletionProvider).toBe(true);
  });

  test('config.parser.parse produces a root node', () => {
    const config = createServerConfig();
    const tree = config.parser.parse('system:\n  instructions: "Test"');
    expect(tree.rootNode).toBeDefined();
    expect(tree.rootNode.type).toBe('source_file');
  });

  test('processDocument works with server config', () => {
    const config = createServerConfig();
    const source = 'system:\n  instructions: "Test agent"';
    const state = processDocument('test://smoke.agent', source, config);

    expect(state.uri).toBe('test://smoke.agent');
    expect(state.source).toBe(source);
    expect(state.ast).toBeDefined();
    expect(state.diagnostics).toBeInstanceOf(Array);
  });

  test('processDocument with agentscript dialect annotation', () => {
    const config = createServerConfig();
    const source =
      '# @dialect: AGENTSCRIPT\nsystem:\n  instructions: "Test agent"';
    const state = processDocument('test://dialect.agent', source, config);

    expect(state.ast).toBeDefined();
    const dialectError = state.diagnostics.find(
      d => d.code === 'unknown-dialect'
    );
    expect(dialectError).toBeUndefined();
  });

  test('processDocument with agentforce dialect annotation', () => {
    const config = createServerConfig();
    const source =
      '# @dialect: AGENTFORCE\nsystem:\n  instructions: "Test agent"';
    const state = processDocument('test://dialect.agent', source, config);

    expect(state.ast).toBeDefined();
    const dialectError = state.diagnostics.find(
      d => d.code === 'unknown-dialect'
    );
    expect(dialectError).toBeUndefined();
  });
});
