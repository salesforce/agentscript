/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, expect, it } from 'vitest';
import { BUILTIN_FUNCTION_NAMES } from '@agentscript/types';
import { parse } from '@agentscript/parser';
import { Dialect } from '../core/dialect.js';
import { NamedBlock, NamedCollectionBlock } from '../core/block.js';
import { ExpressionValue } from '../core/primitives.js';
import { LintEngine } from '../core/analysis/lint-engine.js';
import { createSchemaContext } from '../core/analysis/scope.js';
import { BUILTIN_CATALOG, catalogFromNames } from './function-catalog.js';
import { validateJsonPathCall } from './json-path-validation.js';
import {
  expressionValidationPass,
  type ExpressionValidationOptions,
} from './expression-validation.js';
import type { FunctionCatalog, FunctionDefinition } from './index.js';

const ValueBlock = NamedBlock('ValueBlock', {
  expr: ExpressionValue.describe('An expression'),
});

const TestSchema = {
  value: NamedCollectionBlock(ValueBlock),
};

const schemaCtx = createSchemaContext({ schema: TestSchema, aliases: {} });

function getDiagnostics(
  expression: string,
  options?: ExpressionValidationOptions
) {
  const { rootNode: root } = parse(`
value v:
    expr: ${expression}
`);
  const mappingNode =
    root.namedChildren.find(node => node.type === 'mapping') ?? root;
  const result = new Dialect().parse(mappingNode, TestSchema);
  const engine = new LintEngine({
    passes: [expressionValidationPass(options)],
    source: 'test',
  });

  return engine.run(result.value, schemaCtx).diagnostics;
}

describe('function catalog', () => {
  it('has exact parity with the shared built-in names', () => {
    expect([...BUILTIN_CATALOG.keys()].sort()).toEqual(
      [...BUILTIN_FUNCTION_NAMES].sort()
    );
  });

  it('keys every entry by its definition name', () => {
    for (const [key, definition] of BUILTIN_CATALOG) {
      expect(key).toBe(definition.name);
    }
  });

  it('defines json_path with 2-3 argument metadata', () => {
    expect(BUILTIN_CATALOG.get('json_path')).toMatchObject({
      name: 'json_path',
      minArgs: 2,
      maxArgs: 3,
      validators: [validateJsonPathCall],
    });
  });

  it.each(['lower', 'upper', 'to_json', 'from_json'])(
    'defines %s with exactly 1 argument',
    name => {
      expect(BUILTIN_CATALOG.get(name)).toEqual({
        name,
        minArgs: 1,
        maxArgs: 1,
      });
    }
  );

  it('creates permissive definitions from legacy names', () => {
    const catalog = catalogFromNames(new Set(['custom']));

    expect(catalog.get('custom')).toEqual({
      name: 'custom',
      minArgs: 0,
      maxArgs: null,
    });
  });

  it('invokes definition validators with arguments only', () => {
    let receivedArgumentCount = -1;
    let receivedExpressionCount = -1;
    const definition: FunctionDefinition = {
      name: 'custom',
      minArgs: 1,
      maxArgs: 1,
      validators: [
        function validator(args) {
          receivedArgumentCount = arguments.length;
          receivedExpressionCount = args.length;
          return [];
        },
      ],
    };
    const catalog: FunctionCatalog = new Map([['custom', definition]]);

    expect(getDiagnostics('custom(1)', { catalog })).toEqual([]);
    expect(receivedArgumentCount).toBe(1);
    expect(receivedExpressionCount).toBe(1);
  });
});

describe('function catalog compatibility', () => {
  it('gives an explicit catalog precedence over legacy names', () => {
    const catalog: FunctionCatalog = new Map([
      ['catalog_only', { name: 'catalog_only', minArgs: 0, maxArgs: null }],
    ]);
    const options = {
      catalog,
      functions: new Set(['legacy_only']),
    };

    expect(getDiagnostics('catalog_only()', options)).toEqual([]);
    expect(getDiagnostics('legacy_only()', options)).toEqual([
      expect.objectContaining({ code: 'unknown-function' }),
    ]);
  });

  it('uses the catalog key in arity diagnostics when metadata drifts', () => {
    const catalog: FunctionCatalog = new Map([
      ['called_name', { name: 'metadata_name', minArgs: 1, maxArgs: 1 }],
    ]);

    const diagnostics = getDiagnostics('called_name()', { catalog });
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'function-argument-count',
        message: expect.stringContaining("'called_name'"),
      }),
    ]);
  });

  it('accepts a legacy direct function with arbitrary arity', () => {
    expect(
      getDiagnostics('custom(1, 2, 3, 4)', {
        functions: new Set(['custom']),
      })
    ).toEqual([]);
  });

  it('keeps namespaced member calls independent from direct functions', () => {
    expect(
      getDiagnostics('tools.run(1, 2, 3)', {
        functions: new Set(['custom']),
        namespacedFunctions: { tools: new Set(['run']) },
      })
    ).toEqual([]);
  });
});
