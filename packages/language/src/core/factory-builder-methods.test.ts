/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { Block } from './block-factory.js';
import { NamedBlock } from './named-block-factory.js';
import {
  CollectionBlock,
  NamedCollectionBlock,
} from './collection-block-factory.js';
import { TypedMap } from './typed-map-factory.js';
import {
  StringValue,
  ProcedureValue,
  ExpressionValue,
  ReferenceValue,
} from './primitives.js';

/**
 * Lock in that the new graph-extraction metadata builders are reachable
 * on every factory that goes through `overrideFactoryBuilderMethods`.
 * The methods are advertised on `BuilderMethods<…>` (so they type-check
 * on any field), but until this fix they were only installed on the
 * primitive `addBuilderMethods` path — calling them on a Block /
 * NamedBlock / Collection / TypedMap factory threw `is not a function`.
 */
describe('factory builders expose graph-extraction metadata methods', () => {
  const expectFlag = (factory: unknown, flag: string): void => {
    const meta = (factory as { __metadata?: Record<string, unknown> })
      .__metadata;
    expect(meta?.[flag]).toBe(true);
  };

  it('Block factory installs transitionContainer / predicateField / outputNameField / displayLabelField', () => {
    expectFlag(
      Block('B', { f: StringValue }).transitionContainer(),
      'transitionContainer'
    );
    expectFlag(
      Block('B', { f: StringValue }).predicateField(),
      'predicateField'
    );
    expectFlag(
      Block('B', { f: StringValue }).outputNameField(),
      'outputNameField'
    );
    expectFlag(
      Block('B', { f: StringValue }).displayLabelField(),
      'displayLabelField'
    );
    expectFlag(
      Block('B', { f: StringValue }).structuredOutputField(),
      'structuredOutputField'
    );
  });

  it('NamedBlock factory installs the four methods', () => {
    expectFlag(
      NamedBlock('NB', { f: StringValue }).transitionContainer(),
      'transitionContainer'
    );
    expectFlag(
      NamedBlock('NB', { f: StringValue }).predicateField(),
      'predicateField'
    );
    expectFlag(
      NamedBlock('NB', { f: StringValue }).outputNameField(),
      'outputNameField'
    );
    expectFlag(
      NamedBlock('NB', { f: StringValue }).displayLabelField(),
      'displayLabelField'
    );
  });

  it('CollectionBlock and NamedCollectionBlock factories install the four methods', () => {
    const namedInner = NamedBlock('NamedInner', { f: StringValue });
    expectFlag(
      CollectionBlock(namedInner).transitionContainer(),
      'transitionContainer'
    );
    expectFlag(CollectionBlock(namedInner).predicateField(), 'predicateField');
    expectFlag(
      CollectionBlock(namedInner).outputNameField(),
      'outputNameField'
    );
    expectFlag(
      CollectionBlock(namedInner).displayLabelField(),
      'displayLabelField'
    );

    expectFlag(
      NamedCollectionBlock(namedInner).transitionContainer(),
      'transitionContainer'
    );
    expectFlag(
      NamedCollectionBlock(namedInner).predicateField(),
      'predicateField'
    );
    expectFlag(
      NamedCollectionBlock(namedInner).outputNameField(),
      'outputNameField'
    );
    expectFlag(
      NamedCollectionBlock(namedInner).displayLabelField(),
      'displayLabelField'
    );
  });

  it('TypedMap factory installs the four methods', () => {
    const inner = Block('TMInner', { f: StringValue });
    expectFlag(
      TypedMap('TMTest', inner).transitionContainer(),
      'transitionContainer'
    );
    expectFlag(TypedMap('TMTest', inner).predicateField(), 'predicateField');
    expectFlag(TypedMap('TMTest', inner).outputNameField(), 'outputNameField');
    expectFlag(
      TypedMap('TMTest', inner).displayLabelField(),
      'displayLabelField'
    );
  });

  it('primitives also expose the four methods (regression guard)', () => {
    // The primitive path was always wired up — pinned here so a future
    // refactor of `addBuilderMethods` doesn't quietly drop them.
    expectFlag(
      ProcedureValue.transitionContainer() as unknown as {
        __metadata?: Record<string, unknown>;
      },
      'transitionContainer'
    );
    expectFlag(
      ExpressionValue.predicateField() as unknown as {
        __metadata?: Record<string, unknown>;
      },
      'predicateField'
    );
    expectFlag(
      StringValue.outputNameField() as unknown as {
        __metadata?: Record<string, unknown>;
      },
      'outputNameField'
    );
    expectFlag(
      StringValue.displayLabelField() as unknown as {
        __metadata?: Record<string, unknown>;
      },
      'displayLabelField'
    );
    // ReferenceValue is the most common transitionTarget host — make sure
    // resolvedType still works alongside the new methods.
    expect(
      (
        ReferenceValue.resolvedType('transitionTarget') as unknown as {
          __metadata?: { constraints?: { resolvedType?: string } };
        }
      ).__metadata?.constraints?.resolvedType
    ).toBe('transitionTarget');
  });
});
