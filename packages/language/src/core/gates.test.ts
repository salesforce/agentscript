/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { parse } from '@agentscript/parser';
import { Dialect } from './dialect.js';
import { Block } from './block-factory.js';
import { NamedBlock } from './named-block-factory.js';
import {
  CollectionBlock,
  NamedCollectionBlock,
} from './collection-block-factory.js';
import { ExpressionSequence, Sequence } from './sequence.js';
import { TypedMap } from './typed-map-factory.js';
import {
  ExpressionValue,
  NumberValue,
  StringValue,
  union,
} from './primitives.js';
import { DiagnosticSeverity } from './diagnostics.js';
import { createLanguageService } from '../service.js';
import type { DialectConfig } from '../dialect-config.js';
import { isGateOpen } from './gates.js';
import type { Gates } from './gates.js';

// Test-only gate ids and schema — no real schema feature is gated.
const EXPERIMENTAL_FIELD_GATE = 'test.experimentalField';
const EXPERIMENTAL_VALUE_GATE = 'test.experimentalValue';
const EXPERIMENTAL_BLOCK_GATE = 'test.experimentalBlock';

// Inline schema exercising a gated field, a per-value gate, and a gated block.
// The field and value use the default stage (beta); the block is a pilot.
const TestSchema = {
  mode: StringValue.describe('Mode.').gatedValue(
    'experimental',
    EXPERIMENTAL_VALUE_GATE
  ),
  kind: ExpressionValue.gatedValue('experimental', EXPERIMENTAL_VALUE_GATE),
  experimental_field: StringValue.describe('Only for gated orgs.').gatedBy(
    EXPERIMENTAL_FIELD_GATE
  ),
  experimental_block: Block('ExperimentalBlock', {
    name: StringValue,
  }).gatedBy(EXPERIMENTAL_BLOCK_GATE, 'pilot'),
};

function getGateDiagnostics(source: string, gates?: Gates) {
  const { rootNode: root } = parse(source);
  const mappingNode =
    root.namedChildren.find(n => n.type === 'mapping') ?? root;
  const dialect = new Dialect({ gates });
  const result = dialect.parse(mappingNode, TestSchema);
  return result.diagnostics.filter(
    d => d.code === 'gated-feature' || d.code === 'pre-release-feature'
  );
}

describe('isGateOpen', () => {
  it('treats an absent gate as closed (fail-closed)', () => {
    expect(isGateOpen(undefined, 'x')).toBe(false);
    expect(isGateOpen({}, 'x')).toBe(false);
  });

  it('opens only for a literal true', () => {
    expect(isGateOpen({ x: true }, 'x')).toBe(true);
    expect(isGateOpen({ x: false }, 'x')).toBe(false);
  });

  it('treats non-boolean values (e.g. from untyped JSON) as closed', () => {
    const gates = { x: 'true' } as unknown as Gates;
    expect(isGateOpen(gates, 'x')).toBe(false);
  });
});

describe('gated field (parse-loop diagnostic)', () => {
  const src = `experimental_field: "hi"`;

  it('reports an error when the gate is closed', () => {
    const diags = getGateDiagnostics(src, {});
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('gated-feature');
    expect(diags[0].severity).toBe(DiagnosticSeverity.Error);
    expect(diags[0].message).toBe(
      "'experimental_field' is a beta feature and is not enabled."
    );
    expect(diags[0].data).toEqual({
      gate: EXPERIMENTAL_FIELD_GATE,
      stage: 'beta',
    });
  });

  it('reports a beta notice by default when the gate is open', () => {
    const diags = getGateDiagnostics(src, {
      [EXPERIMENTAL_FIELD_GATE]: true,
    });
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('pre-release-feature');
    expect(diags[0].severity).toBe(DiagnosticSeverity.Information);
    expect(diags[0].message).toBe("'experimental_field' is a beta feature.");
    expect(diags[0].data?.stage).toBe('beta');
  });

  it('treats a missing gate map as closed (fail-closed)', () => {
    const diags = getGateDiagnostics(src, undefined);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('gated-feature');
  });
});

describe('gated value (parse-loop diagnostic)', () => {
  it('reports an error when the gate is closed', () => {
    const diags = getGateDiagnostics(`mode: "experimental"`, {});
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('gated-feature');
    expect(diags[0].message).not.toContain(EXPERIMENTAL_VALUE_GATE);
    expect(diags[0].data?.gate).toBe(EXPERIMENTAL_VALUE_GATE);
  });

  it.each([
    ['a parenthesized string', `mode: ("experimental")`],
    ['a | template', `mode: |\n    experimental`],
    ['a bare word in an expression field', `kind: experimental`],
  ])('matches %s', (_, src) => {
    const diags = getGateDiagnostics(src, {});
    expect(diags.map(d => d.code)).toEqual(['gated-feature']);
  });

  it.each(['constructor', 'toString', '__proto__'])(
    'does not match the built-in object property %s',
    value => {
      expect(getGateDiagnostics(`mode: "${value}"`, {})).toHaveLength(0);
      expect(getGateDiagnostics(`kind: ${value}`, {})).toHaveLength(0);
    }
  );

  it('reports a beta notice by default when the gate is open', () => {
    const diags = getGateDiagnostics(`mode: "experimental"`, {
      [EXPERIMENTAL_VALUE_GATE]: true,
    });
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('pre-release-feature');
    expect(diags[0].message).toBe("'mode: experimental' is a beta feature.");
  });

  it('does not flag a non-gated value for the same field', () => {
    const diags = getGateDiagnostics(`mode: "standard"`, {});
    expect(diags).toHaveLength(0);
  });
});

describe('gated block (factory builder path)', () => {
  const src = `experimental_block:\n    name: "hi"`;

  it('reports an error when the gate is closed', () => {
    const diags = getGateDiagnostics(src, {});
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('gated-feature');
    expect(diags[0].data?.gate).toBe(EXPERIMENTAL_BLOCK_GATE);
  });

  it('reports its explicit stage when the gate is open', () => {
    const diags = getGateDiagnostics(src, {
      [EXPERIMENTAL_BLOCK_GATE]: true,
    });
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe('pre-release-feature');
    expect(diags[0].data?.stage).toBe('pilot');
  });
});

describe('gated shared factory', () => {
  const SharedBlock = Block('SharedBlock', { name: StringValue }).describe(
    'Shared.'
  );
  const GatedSharedBlock = SharedBlock.gatedBy(EXPERIMENTAL_BLOCK_GATE);

  it('gates a copy, leaving the shared factory ungated', () => {
    expect(GatedSharedBlock).not.toBe(SharedBlock);
    expect(SharedBlock.__metadata?.gatedBy).toBeUndefined();
    expect(GatedSharedBlock.__metadata).toMatchObject({
      description: 'Shared.',
      gatedBy: { id: EXPERIMENTAL_BLOCK_GATE, stage: 'beta' },
    });
  });

  it('flags only the key using the gated copy', () => {
    const { rootNode: root } = parse(
      `open_block:\n    name: "a"\ngated_block:\n    name: "b"`
    );
    const mappingNode =
      root.namedChildren.find(n => n.type === 'mapping') ?? root;
    const result = new Dialect({ gates: {} }).parse(mappingNode, {
      open_block: SharedBlock,
      gated_block: GatedSharedBlock,
    });
    const gated = result.diagnostics.filter(d => d.code === 'gated-feature');
    expect(gated).toHaveLength(1);
    expect(gated[0].message).toContain("'gated_block'");
  });
});

describe('gated nested type', () => {
  // Gates are only checked at schema keys, so a gate on a type nested inside
  // another would never apply. Each container rejects it up front.
  const G = EXPERIMENTAL_BLOCK_GATE;
  const Entry = NamedBlock('Entry', { name: StringValue });
  const Item = Block('Item', { name: StringValue });

  it.each([
    ['CollectionBlock', () => CollectionBlock(Entry.gatedBy(G))],
    ['NamedCollectionBlock', () => NamedCollectionBlock(Entry.gatedBy(G))],
    ['Sequence', () => Sequence(Item.gatedBy(G))],
    ['ExpressionSequence', () => ExpressionSequence(StringValue.gatedBy(G))],
    [
      'ExpressionSequence',
      () => ExpressionSequence(StringValue.gatedValue('x', G)),
    ],
    ['TypedMap', () => TypedMap('GatedMap', Item.gatedBy(G))],
    ['union', () => union(StringValue.gatedBy(G), NumberValue)],
  ])('%s throws when given a gated type', (where, build) => {
    expect(build).toThrow(`${where}() cannot take a gated type`);
  });

  it('flags each entry when the collection key is gated instead', () => {
    const { rootNode: root } = parse(
      `entry a:\n    name: "a"\nentry b:\n    name: "b"`
    );
    const mappingNode =
      root.namedChildren.find(n => n.type === 'mapping') ?? root;
    const result = new Dialect({ gates: {} }).parse(mappingNode, {
      entry: NamedCollectionBlock(Entry).gatedBy(G),
    });
    const gated = result.diagnostics.filter(d => d.code === 'gated-feature');
    expect(gated).toHaveLength(2);
  });
});

describe('LanguageService gates', () => {
  const dialect = {
    name: 'test',
    schemaInfo: { schema: TestSchema, aliases: {} },
    createRules: () => [],
  } as unknown as DialectConfig;

  function getServiceGateDiagnostics(gates?: Gates) {
    const service = createLanguageService({ dialect, gates });
    service.update(parse(`experimental_field: "hi"`).rootNode);
    return service.diagnostics.filter(d => d.code === 'gated-feature');
  }

  it('flags a gated field when no gates are passed (fail-closed)', () => {
    expect(getServiceGateDiagnostics()).toHaveLength(1);
  });

  it('does not flag when the gate is open', () => {
    expect(
      getServiceGateDiagnostics({ [EXPERIMENTAL_FIELD_GATE]: true })
    ).toHaveLength(0);
  });
});
