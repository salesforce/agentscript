/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Tests for scripts/transform-snake-case.mjs — the post-processing step that
 * converts the camelCase property names emitted by @hey-api/openapi-ts into the
 * snake_case names used by the AgentJSON output format.
 *
 * The transform must be scope-aware: property names inside `z.object({ ... })`
 * are rewritten, but bare schema references inside `z.union([ ... ])` arrays are
 * NOT. Since @hey-api/openapi-ts 0.99.0, discriminated unions are emitted as
 * bare references in an array, and a context-free transform corrupts them into
 * `key: value` shorthand — a syntax error inside an array literal.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'scripts',
  'transform-snake-case.mjs'
);

/** Run the transform on `source` and return the rewritten file contents. */
function transform(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'snake-case-'));
  const file = join(dir, 'schema.ts');
  try {
    writeFileSync(file, source);
    execFileSync('node', [SCRIPT, file], { stdio: 'pipe' });
    return readFileSync(file, 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('transform-snake-case', () => {
  it('renames explicit properties inside z.object()', () => {
    const out = transform(
      [
        'export const x = z.object({',
        '    developerName: z.string()',
        '});',
      ].join('\n')
    );
    expect(out).toContain('    developer_name: z.string()');
  });

  it('expands shorthand properties inside z.object()', () => {
    const out = transform(
      [
        'export const x = z.object({',
        '    agentType,',
        '    byoClient: cfg',
        '});',
      ].join('\n')
    );
    expect(out).toContain('    agent_type: agentType,');
    expect(out).toContain('    byo_client: cfg');
  });

  it('leaves bare schema references inside z.union([ ]) untouched', () => {
    const out = transform(
      [
        'export const x = z.intersection(z.union([',
        '    action,',
        '    handOffAction',
        ']), z.object({',
        '    typeField: someEnum.optional()',
        '}));',
      ].join('\n')
    );
    // Union members stay as bare references (the 0.99.0 regression).
    expect(out).toContain('    action,');
    expect(out).toContain('    handOffAction');
    expect(out).not.toContain('hand_off_action: handOffAction');
    // The object member after the union is still transformed.
    expect(out).toContain('    type_field: someEnum.optional()');
  });

  it('does not treat enum string members as properties', () => {
    const out = transform(
      [
        'export const t = z.enum([',
        "    'EinsteinServiceAgent',",
        "    'AgentforceEmployeeAgent'",
        ']);',
      ].join('\n')
    );
    expect(out).toContain("    'EinsteinServiceAgent',");
  });

  it('is not confused by brackets inside regex literals', () => {
    const out = transform(
      [
        'export const x = z.object({',
        '    developerName: z.string().regex(/^[A-Za-z](_?[A-Za-z0-9])*$/),',
        '    fieldMapping: z.string().regex(/.+\\..+/).nullish()',
        '});',
        'export const u = z.union([',
        '    fooNode,',
        '    barNode',
        ']);',
      ].join('\n')
    );
    // Regex char classes must not leave the scanner "inside" an array.
    expect(out).toContain('    developer_name: z.string()');
    expect(out).toContain('    field_mapping: z.string()');
    // Union after a regex-bearing object is still recognized as an array.
    expect(out).toContain('    fooNode,');
    expect(out).not.toContain('foo_node: fooNode');
  });

  it('is not confused by brackets inside doc comments', () => {
    const out = transform(
      [
        '/**',
        ' * Example: [ { a: 1 } ] and (parens).',
        ' */',
        'export const x = z.object({',
        '    ragFeatureName: z.string()',
        '});',
      ].join('\n')
    );
    expect(out).toContain('    rag_feature_name: z.string()');
  });

  it('handles a union nested as a property value inside an object', () => {
    const out = transform(
      [
        'export const x = z.object({',
        '    agentVersion: z.union([',
        '        agentVersion,',
        '        z.array(agentVersion)',
        '    ]),',
        '    byoClient: cfg',
        '});',
      ].join('\n')
    );
    // The property key is renamed...
    expect(out).toContain('    agent_version: z.union([');
    // ...but the union members (8-space indent, inside '[') are untouched.
    expect(out).toContain('        agentVersion,');
    expect(out).toContain('    byo_client: cfg');
  });
});
