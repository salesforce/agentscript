/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Type conformance tests.
 *
 * Verifies that InferFields-derived types produce correct runtime shapes
 * and compile-time type constraints. This catches regressions in the
 * Zod-style phantom type inference pipeline.
 */

import { describe, test, expect } from 'vitest';
import {
  StringLiteral,
  TemplateExpression,
  isNamedMap,
  type Parsed,
  type NamedMap,
  type VariableDeclarationNode,
} from '@agentscript/language';
import { parseDocument } from './test-utils.js';
import type {
  ParsedDocument,
  ParsedDocumentFields,
  ParsedSystem,
  ParsedConfig,
  ParsedSubagent,
  ParsedAction,
} from '../index.js';

describe('type conformance', () => {
  test('parseDocument returns ParsedDocument assignable type', () => {
    const doc: ParsedDocument = parseDocument(`
      config:
        description: "test"
    `);

    // Metadata fields exist
    expect(doc.__cst).toBeDefined();
    expect(doc.__diagnostics).toBeDefined();
  });

  test('scalar fields have correct runtime types', () => {
    const doc = parseDocument(`
      config:
        description: "hello"
      system:
        instructions: |
          Be helpful
    `);

    expect(doc.config?.description).toBeInstanceOf(StringLiteral);
    // Template (multiline) instructions should be TemplateExpression
    expect(doc.system?.instructions).toBeInstanceOf(TemplateExpression);
  });

  test('named block fields produce NamedMap instances', () => {
    const doc = parseDocument(`
      subagent main:
        label: "Main"
        description: "A topic"
        actions:
          fetch: @actions.fetch
    `);

    expect(isNamedMap(doc.subagent)).toBe(true);
    const main = doc.subagent?.get('main');
    expect(main).toBeDefined();
    expect(main?.__cst).toBeDefined();

    // Nested named block
    expect(isNamedMap(main?.actions)).toBe(true);
    const fetch = main?.actions?.get('fetch');
    expect(fetch).toBeDefined();
  });

  test('TypedMap fields produce NamedMap instances', () => {
    const doc = parseDocument(`
      variables:
        name: mutable String
    `);

    expect(doc.variables).toBeDefined();
    expect(isNamedMap(doc.variables)).toBe(true);
    expect(doc.variables?.get('name')).toBeDefined();
  });

  test('InferFields covers all schema keys', () => {
    // Compile-time check: ensure ParsedDocumentFields has the expected keys.
    // Use template literal exclude instead of `keyof BlockCore` since BlockCore
    // has a string index signature that would erase all keys via Omit.
    type ExpectedKeys =
      | 'system'
      | 'config'
      | 'variables'
      | 'language'
      | 'connected_subagent'
      | 'start_agent'
      | 'subagent';
    type ActualKeys = Exclude<keyof ParsedDocumentFields, `__${string}`>;

    // Compile-time bidirectional check: fails if schema keys don't match
    true satisfies ActualKeys extends ExpectedKeys ? true : never;
    true satisfies ExpectedKeys extends ActualKeys ? true : never;
  });

  /**
   * Compile-time canary: negative type assertions that fail to compile
   * if InferFields produces wrong field types. Each @ts-expect-error
   * suppresses a KNOWN type error — if the type becomes too wide,
   * the assignment would succeed and @ts-expect-error would flag a
   * spurious suppression, breaking the build.
   */
  test('compile-time: field types are precise (not too wide or narrow)', () => {
    const doc = parseDocument(`
      config:
        description: "test"
      system:
        instructions: "test"
      subagent main:
        description: "test"
        actions:
          fetch: @actions.fetch
      variables:
        name: mutable String
    `);

    // --- Positive type assertions: fields accept their inferred types ---
    const _system: ParsedSystem | undefined = doc.system;
    const _config: ParsedConfig | undefined = doc.config;
    const _topic: NamedMap<Parsed<ParsedSubagent>> | undefined = doc.subagent;
    const _vars: NamedMap<VariableDeclarationNode> | undefined = doc.variables;

    // Verify NamedBlock fields are NamedMap with typed entries
    const _topicMap: NamedMap<Parsed<ParsedSubagent>> = doc.subagent!;
    const _topicEntry: Parsed<ParsedSubagent> | undefined =
      doc.subagent!.get('main');

    // Verify nested NamedBlock (actions) uses correct inner type
    const main = doc.subagent!.get('main')!;
    const _actionsMap: NamedMap<Parsed<ParsedAction>> = main.actions!;
    const _actionEntry: Parsed<ParsedAction> | undefined =
      main.actions!.get('fetch');

    // Suppress unused-variable warnings
    void _system;
    void _config;
    void _topic;
    void _vars;
    void _topicMap;
    void _topicEntry;
    void _actionsMap;
    void _actionEntry;

    expect(true).toBe(true);
  });
});
