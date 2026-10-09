/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  parseIrManifest,
  IR_MANIFEST_FILENAME,
  IR_MANIFEST_VERSION,
} from '../src/bundle/ir-manifest.js';

const valid = JSON.stringify({
  version: IR_MANIFEST_VERSION,
  generator: '@sf-agentscript/cli',
  agents: [{ id: 'support', doc: { kind: 'agent' }, serverBlock: undefined }],
});

describe('parseIrManifest', () => {
  it('exposes a stable manifest filename', () => {
    expect(IR_MANIFEST_FILENAME).toBe('agentscript.ir.json');
  });

  it('parses a well-formed manifest', () => {
    const manifest = parseIrManifest(valid);
    expect(manifest.version).toBe(IR_MANIFEST_VERSION);
    expect(manifest.agents).toHaveLength(1);
    expect(manifest.agents[0]!.id).toBe('support');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseIrManifest('{not json')).toThrow(
      /Invalid IR manifest JSON/
    );
  });

  it('throws on a non-object payload', () => {
    expect(() => parseIrManifest('42')).toThrow(/expected a JSON object/);
  });

  it('throws when the version is missing', () => {
    expect(() =>
      parseIrManifest(JSON.stringify({ generator: 'x', agents: [] }))
    ).toThrow(/missing numeric "version"/);
  });

  it('throws on an unsupported version', () => {
    expect(() =>
      parseIrManifest(
        JSON.stringify({ version: 999, generator: 'x', agents: [] })
      )
    ).toThrow(/Unsupported IR manifest version 999/);
  });

  it('throws when agents is not an array', () => {
    expect(() =>
      parseIrManifest(
        JSON.stringify({ version: IR_MANIFEST_VERSION, agents: {} })
      )
    ).toThrow(/"agents" must be an array/);
  });

  it('throws when an agent lacks an id', () => {
    expect(() =>
      parseIrManifest(
        JSON.stringify({
          version: IR_MANIFEST_VERSION,
          agents: [{ doc: {} }],
        })
      )
    ).toThrow(/each agent needs a string "id"/);
  });

  it('throws when an agent lacks a compiled doc', () => {
    expect(() =>
      parseIrManifest(
        JSON.stringify({
          version: IR_MANIFEST_VERSION,
          agents: [{ id: 'x' }],
        })
      )
    ).toThrow(/missing its compiled "doc"/);
  });
});
