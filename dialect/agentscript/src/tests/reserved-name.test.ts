/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { parseDocument, emitDocument, testSchemaCtx } from './test-utils.js';
import { createLintEngine } from '../lint/index.js';
import { collectDiagnostics } from '@agentscript/language';

describe('reserved-name diagnostic', () => {
  it('should produce exactly one reserved-name diagnostic for unquoted reserved words', () => {
    const ast = parseDocument(`
subagent current_weather_service:
    description: "Provides current weather conditions"
    actions:
        Geocode_Location:
            description: "Converts locations"
            inputs:
                date: object
                    description: "hello"
`);
    const engine = createLintEngine();
    const { diagnostics } = engine.run(ast, testSchemaCtx);
    const reservedDiags = diagnostics.filter(d => d.code === 'reserved-name');
    expect(reservedDiags.length).toBe(1);
  });

  it('should not flag quoted keys as reserved', () => {
    const ast = parseDocument(`
subagent current_weather_service:
    description: "Provides current weather conditions"
    actions:
        Geocode_Location:
            description: "Converts locations"
            inputs:
                "date": object
                    description: "hello"
`);
    const engine = createLintEngine();
    const { diagnostics } = engine.run(ast, testSchemaCtx);
    const reservedDiags = diagnostics.filter(d => d.code === 'reserved-name');
    expect(reservedDiags.length).toBe(0);
  });

  it('should preserve quotes on reserved-name keys through emit roundtrip', () => {
    const source = `
topic current_weather_service:
    description: "Provides current weather conditions"
    actions:
        Geocode_Location:
            description: "Converts locations"
            inputs:
                "date": object
                    description: "hello"
`;
    // Parse the source with quoted "date" — should be clean
    const ast = parseDocument(source);
    const engine = createLintEngine();
    const { diagnostics } = engine.run(ast, testSchemaCtx);
    const reservedDiags = diagnostics.filter(d => d.code === 'reserved-name');
    expect(reservedDiags).toHaveLength(0);

    // Emit and re-parse — the emitted text must keep "date" quoted
    const emitted = emitDocument(ast);
    expect(emitted).toContain('"date"');

    const ast2 = parseDocument(emitted);
    const { diagnostics: diags2 } = engine.run(ast2, testSchemaCtx);
    const reservedDiags2 = diags2.filter(d => d.code === 'reserved-name');
    expect(reservedDiags2).toHaveLength(0);
  });

  it('should not duplicate reserved-name via collectDiagnostics tree walk', () => {
    const ast = parseDocument(`
subagent current_weather_service:
    description: "Provides current weather conditions"
    actions:
        Geocode_Location:
            description: "Converts locations"
            inputs:
                date: object
                    description: "hello"
`);
    const diags = collectDiagnostics(ast);
    const reservedDiags = diags.filter(d => d.code === 'reserved-name');
    expect(reservedDiags).toHaveLength(1);
  });
});
