/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { LintEngine } from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import type { Diagnostic } from '@agentscript/types';
import { parseDocument, testSchemaCtx } from './test-utils.js';
import { defaultRules } from '../lint/passes/index.js';

// ---------------------------------------------------------------------------
// Source builders. Each helper assembles an in-memory `.agent` source string
// for the lint engine to run against. A render body under test looks like:
//
//     when @connection.messaging
//         render: @connection.messaging.response_formats.rich
//             with title = @outputs.a_title
//
// so every built source declares a `messaging` connection with a `rich`
// response_format, and a topic whose reasoning action renders it.
// ---------------------------------------------------------------------------

/**
 * Engine-only lint run. `engine.run` already merges `collectDiagnostics(root)`,
 * so we must NOT additionally call `collectDiagnostics` here — doing so
 * double-counts every `attachDiagnostic`-based diagnostic.
 */
function runLint(source: string): Diagnostic[] {
  const ast = parseDocument(source);
  const engine = new LintEngine({ passes: defaultRules() });
  return engine.run(ast, testSchemaCtx).diagnostics;
}

function byCode(diags: Diagnostic[], code: string): Diagnostic[] {
  return diags.filter(d => d.code === code);
}

/** All render-with-* diagnostics, regardless of specific code. */
function renderWithCodes(diags: Diagnostic[]): Diagnostic[] {
  return diags.filter(d => String(d.code).startsWith('render-with'));
}

/** Options for the {@link doc} source builder. */
interface DocOptions {
  /**
   * Body of the action's `outputs:` map, already indented to the outputs
   * column. Defaults to the common `n/flag/text` set.
   */
  outputs?: string;
  /**
   * A block of `variables:` declarations to prepend before the connection.
   * Callers pass the fully-formed top-level block (no extra indentation).
   */
  variables?: string;
}

const DEFAULT_OUTPUTS = [
  '                n: number',
  '                flag: boolean',
  '                text: string',
].join('\n');

/**
 * Build a document with a `messaging` connection declaring the given
 * response_format inputs, and a topic whose reasoning action renders that
 * format with the given `with`-binding body.
 */
function doc(
  inputs: string,
  renderBody: string,
  options: DocOptions = {}
): string {
  const outputs = options.outputs ?? DEFAULT_OUTPUTS;
  const prefix = options.variables ? `${options.variables}\n\n` : '';
  return `${prefix}${`
connection messaging:
    response_formats:
        rich:
            description: "d"
            target: "apex://H"
            inputs:
${inputs}
topic Foo:
    description: "d"
    actions:
        DoThing:
            description: "does"
            target: "apex://Do"
            outputs:
${outputs}
    reasoning:
        instructions: ->
            |Do the thing
        actions:
            act: @actions.DoThing
                when @connection.messaging
                    render: @connection.messaging.response_formats.rich
${renderBody}
`.trimStart()}`;
}

/**
 * A rich set of inputs reused across cases:
 *   tone     — enum string
 *   count    — integer with minimum/maximum
 *   title    — required string
 *   nickname — optional string
 *   block    — object with required `label` + `version`
 *   rows     — list of objects
 */
const RICH_INPUTS = [
  '                tone:',
  '                    type: string',
  '                        enum:',
  '                            - "casual"',
  '                            - "pro"',
  '                count:',
  '                    type: integer',
  '                        minimum: 1',
  '                        maximum: 10',
  '                title: string',
  '                nickname:',
  '                    type: string',
  '                    is_required: False',
  '                block:',
  '                    type: object',
  '                        fields:',
  '                            version: number',
  '                            label:',
  '                                type: string',
  '                                is_required: True',
  '                rows:',
  '                    type: list',
  '                        value: object',
  '                            fields:',
  '                                cell: string',
].join('\n');

/** Indent a with-body line to the render-body column. */
function w(...lines: string[]): string {
  return lines.map(l => '                        ' + l).join('\n');
}

/** Indent one or more lines to the response_format `inputs:` column. */
function inp(...lines: string[]): string {
  return lines.map(l => '                ' + l).join('\n');
}

/**
 * Render-with binding validation.
 *
 * The `per-code contract` block proves each diagnostic code once (fires +
 * severity + message shape); the `render-with use cases` block then walks the
 * space an author actually touches: every primitive type family, every
 * constraint kind, object/list nesting, unintrospectable values, whole-format
 * skips, and target resolution. Each built source uses a SINGLE declared input
 * wherever possible so a bound value produces no missing-required noise from
 * unrelated inputs — each assertion sees only the diagnostics it is about.
 *
 * Bindings are runtime no-ops today, so every diagnostic here is purely author
 * feedback.
 */

/**
 * Per-code contract: one case per diagnostic code, asserting it fires with the
 * right severity and message shape. The value matrix lives in the use-case
 * block below.
 */
describe('render-with binding diagnostics — per-code contract', () => {
  it('render-with-unknown-input: Error, names the input, suggests a near name', () => {
    const diags = byCode(
      runLint(doc(RICH_INPUTS, w('with titl = "x"'))),
      'render-with-unknown-input'
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe(1); // Error
    expect(diags[0].message).toContain('titl');
    expect(diags[0].data?.suggestion).toBe('title');
  });

  it('render-with-missing-required-input: one consolidated Error listing every unbound required input', () => {
    const diags = byCode(
      runLint(doc(RICH_INPUTS, w('with tone = "casual"'))),
      'render-with-missing-required-input'
    );
    // Consolidated: one lint per level, listing all missing top-level inputs.
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe(1); // Error
    expect(diags[0].message).toContain('count');
  });

  it('render-with-type-mismatch: Warning, names the expected type', () => {
    // `count` is an integer input; a string value clashes. (A `string` input
    // would accept anything, so it can't demonstrate a mismatch.)
    const diags = byCode(
      runLint(doc(RICH_INPUTS, w('with count = "x"'))),
      'render-with-type-mismatch'
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe(2); // Warning
    expect(diags[0].message).toContain('integer');
  });

  it('render-with-constraint-violation: Warning, names the allowed set', () => {
    const diags = byCode(
      runLint(doc(RICH_INPUTS, w('with tone = "loud"'))),
      'render-with-constraint-violation'
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe(2); // Warning
    expect(diags[0].message).toContain('casual');
  });

  it('render-with-nested-unknown-field: Error, names the stray field', () => {
    const diags = byCode(
      runLint(
        doc(RICH_INPUTS, w('with block = {version: 1, label: "L", bogus: 2}'))
      ),
      'render-with-nested-unknown-field'
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe(1); // Error
    expect(diags[0].message).toContain('bogus');
  });

  it('render-with-nested-missing-required-field: Error, names the missing field', () => {
    const diags = byCode(
      runLint(doc(RICH_INPUTS, w('with block = {version: 1}'))),
      'render-with-nested-missing-required-field'
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe(1); // Error
    expect(diags[0].message).toContain('label');
  });

  it('render-with-duplicate-input: Warning, names the repeated input', () => {
    const diags = byCode(
      runLint(doc(RICH_INPUTS, w('with title = "a"', 'with title = "b"'))),
      'render-with-duplicate-input'
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe(2); // Warning
    expect(diags[0].message).toContain('title');
  });

  it('render-with-ellipsis: Error, names the input left as `...`', () => {
    const diags = byCode(
      runLint(doc(RICH_INPUTS, w('with title = ...'))),
      'render-with-ellipsis'
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe(1); // Error
    expect(diags[0].message).toContain('title');
  });
});

/** A doc whose response_format declares exactly one input. */
function single(inputLines: string[], renderBody: string): string {
  return doc(inp(...inputLines), renderBody);
}

/**
 * An output schema (indented to the `outputs:` column) that mixes scalar and
 * container types, so `@outputs.X` references can be resolved against it.
 */
const OUTPUTS_WITH_CONTAINERS = [
  '                n: number',
  '                text: string',
  '                obj_out: object',
  '                list_out: list[integer]',
].join('\n');

/** Like {@link single}, but the action declares the container-typed outputs. */
function singleOut(inputLines: string[], renderBody: string): string {
  return doc(inp(...inputLines), renderBody, {
    outputs: OUTPUTS_WITH_CONTAINERS,
  });
}

describe('render-with use cases', () => {
  // ------------------------------------------------------------------
  // Scalar type families — which literal kinds bind to which primitive.
  // ------------------------------------------------------------------
  describe('scalar type-family compatibility', () => {
    interface FamilyCase {
      label: string;
      type: string;
      value: string;
      /** true → expect exactly one type-mismatch; false → expect none. */
      mismatch: boolean;
    }

    const CASES: FamilyCase[] = [
      // string family
      {
        label: 'string <- string',
        type: 'string',
        value: '"x"',
        mismatch: false,
      },
      {
        label: 'string <- number',
        type: 'string',
        value: '42',
        mismatch: true,
      },
      {
        label: 'string <- boolean',
        type: 'string',
        value: 'True',
        mismatch: true,
      },
      // id is string-backed
      { label: 'id <- string', type: 'id', value: '"001xx"', mismatch: false },
      { label: 'id <- number', type: 'id', value: '5', mismatch: true },
      // date/datetime/time are authored as strings, reject numbers
      {
        label: 'date <- string',
        type: 'date',
        value: '"2026-01-01"',
        mismatch: false,
      },
      { label: 'date <- number', type: 'date', value: '5', mismatch: true },
      {
        label: 'datetime <- string',
        type: 'datetime',
        value: '"2026-01-01T00:00"',
        mismatch: false,
      },
      {
        label: 'datetime <- number',
        type: 'datetime',
        value: '5',
        mismatch: true,
      },
      {
        label: 'time <- string',
        type: 'time',
        value: '"12:00"',
        mismatch: false,
      },
      { label: 'time <- number', type: 'time', value: '5', mismatch: true },
      // numeric family
      {
        label: 'number <- integer',
        type: 'number',
        value: '5',
        mismatch: false,
      },
      {
        label: 'number <- fractional',
        type: 'number',
        value: '2.5',
        mismatch: false,
      },
      {
        label: 'integer <- integer',
        type: 'integer',
        value: '5',
        mismatch: false,
      },
      { label: 'long <- integer', type: 'long', value: '5', mismatch: false },
      { label: 'long <- string', type: 'long', value: '"x"', mismatch: true },
      // currency & timestamp straddle both families (number OR string)
      {
        label: 'currency <- number',
        type: 'currency',
        value: '42',
        mismatch: false,
      },
      {
        label: 'currency <- string',
        type: 'currency',
        value: '"42"',
        mismatch: false,
      },
      {
        label: 'timestamp <- number',
        type: 'timestamp',
        value: '5',
        mismatch: false,
      },
      {
        label: 'timestamp <- string',
        type: 'timestamp',
        value: '"2026"',
        mismatch: false,
      },
      {
        label: 'timestamp <- boolean',
        type: 'timestamp',
        value: 'True',
        mismatch: true,
      },
      // boolean only accepts boolean
      {
        label: 'boolean <- True',
        type: 'boolean',
        value: 'True',
        mismatch: false,
      },
      {
        label: 'boolean <- string',
        type: 'boolean',
        value: '"yes"',
        mismatch: true,
      },
      {
        label: 'boolean <- number',
        type: 'boolean',
        value: '1',
        mismatch: true,
      },
    ];

    it.each(CASES)('$label', ({ type, value, mismatch }) => {
      const diags = byCode(
        runLint(
          single(['field:', `    type: ${type}`], w(`with field = ${value}`))
        ),
        'render-with-type-mismatch'
      );
      expect(diags).toHaveLength(mismatch ? 1 : 0);
    });

    it('flags a fractional literal bound to integer (value-level, not family)', () => {
      const diags = byCode(
        runLint(single(['field:', '    type: integer'], w('with field = 2.5'))),
        'render-with-type-mismatch'
      );
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain(
        'expects an integer, but got a decimal number'
      );
    });

    it('flags a fractional literal bound to long', () => {
      const diags = byCode(
        runLint(single(['field:', '    type: long'], w('with field = 5.5'))),
        'render-with-type-mismatch'
      );
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain(
        'expects a long, but got a decimal number'
      );
    });

    it('accepts a negative integer bound to an integer', () => {
      const diags = renderWithCodes(
        runLint(single(['field:', '    type: integer'], w('with field = -3')))
      );
      expect(diags).toHaveLength(0);
    });
  });

  // ------------------------------------------------------------------
  // Numeric constraints (minimum / maximum), including negatives.
  // ------------------------------------------------------------------
  describe('numeric constraints', () => {
    const RANGE = [
      'level:',
      '    type: integer',
      '        minimum: 1',
      '        maximum: 10',
    ];

    it.each([
      { label: 'below minimum', value: '0', hit: true, needle: 'at least 1' },
      { label: 'at minimum', value: '1', hit: false },
      { label: 'in range', value: '5', hit: false },
      { label: 'at maximum', value: '10', hit: false },
      { label: 'above maximum', value: '11', hit: true, needle: 'at most 10' },
      {
        label: 'negative below minimum',
        value: '-5',
        hit: true,
        needle: 'at least 1',
      },
    ])('$label', ({ value, hit, needle }) => {
      const diags = byCode(
        runLint(single(RANGE, w(`with level = ${value}`))),
        'render-with-constraint-violation'
      );
      expect(diags).toHaveLength(hit ? 1 : 0);
      if (needle) expect(diags[0].message).toContain(needle);
    });

    it('does not constraint-check a dynamic @outputs value', () => {
      const diags = byCode(
        runLint(single(RANGE, w('with level = @outputs.n'))),
        'render-with-constraint-violation'
      );
      expect(diags).toHaveLength(0);
    });

    it('checks a numeric enum on an integer input', () => {
      const enumInt = [
        'level:',
        '    type: integer',
        '        enum:',
        '            - 1',
        '            - 2',
      ];
      expect(
        byCode(
          runLint(single(enumInt, w('with level = 3'))),
          'render-with-constraint-violation'
        )
      ).toHaveLength(1);
      // An in-set value passes.
      expect(
        byCode(
          runLint(single(enumInt, w('with level = 2'))),
          'render-with-constraint-violation'
        )
      ).toHaveLength(0);
    });
  });

  // ------------------------------------------------------------------
  // String constraints — length + enum membership.
  // ------------------------------------------------------------------
  describe('string constraints', () => {
    const LEN = [
      'code:',
      '    type: string',
      '        min_length: 2',
      '        max_length: 4',
    ];

    it.each([
      { label: 'too short', value: '"x"', hit: true, needle: 'at least 2' },
      { label: 'min ok', value: '"ab"', hit: false },
      { label: 'max ok', value: '"abcd"', hit: false },
      { label: 'too long', value: '"abcde"', hit: true, needle: 'at most 4' },
    ])('$label', ({ value, hit, needle }) => {
      const diags = byCode(
        runLint(single(LEN, w(`with code = ${value}`))),
        'render-with-constraint-violation'
      );
      expect(diags).toHaveLength(hit ? 1 : 0);
      if (needle) expect(diags[0].message).toContain(needle);
    });

    const ENUM = [
      'mode:',
      '    type: string',
      '        enum:',
      '            - "a"',
      '            - "b"',
    ];

    it('flags a value outside the enum and names the allowed set', () => {
      const diags = byCode(
        runLint(single(ENUM, w('with mode = "z"'))),
        'render-with-constraint-violation'
      );
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain('"a"');
      expect(diags[0].message).toContain('"b"');
    });

    it('accepts an enum member', () => {
      const diags = byCode(
        runLint(single(ENUM, w('with mode = "a"'))),
        'render-with-constraint-violation'
      );
      expect(diags).toHaveLength(0);
    });
  });

  // ------------------------------------------------------------------
  // List inputs — element type, per-element constraints, item counts.
  // ------------------------------------------------------------------
  describe('list inputs', () => {
    it('flags a wrong-typed primitive element and names its index', () => {
      const diags = byCode(
        runLint(
          single(
            ['nums:', '    type: list', '        value: integer'],
            w('with nums = [1, "x", 3]')
          )
        ),
        'render-with-type-mismatch'
      );
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain('item 2');
    });

    it('checks a per-element enum on a list of primitives', () => {
      const enumList = [
        'kinds:',
        '    type: list',
        '        value: string',
        '            enum:',
        '                - "a"',
        '                - "b"',
      ];
      const diags = byCode(
        runLint(single(enumList, w('with kinds = ["a", "x"]'))),
        'render-with-constraint-violation'
      );
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain('item 2');
    });

    it('checks a per-element min_length on a list of primitives', () => {
      const lenList = [
        'codes:',
        '    type: list',
        '        value: string',
        '            min_length: 2',
      ];
      const diags = byCode(
        runLint(single(lenList, w('with codes = ["x", "ok"]'))),
        'render-with-constraint-violation'
      );
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain('item 1');
    });

    it('accepts an empty list when no min_items is declared', () => {
      const diags = renderWithCodes(
        runLint(
          single(
            ['nums:', '    type: list', '        value: integer'],
            w('with nums = []')
          )
        )
      );
      expect(diags).toHaveLength(0);
    });

    it('accepts a list-typed @outputs passthrough without introspecting elements', () => {
      // `@outputs.list_out` resolves to a list, so its kind matches — the
      // element types (integer output vs string input) are NOT introspected.
      const diags = renderWithCodes(
        runLint(
          singleOut(
            ['nums:', '    type: list', '        value: string'],
            w('with nums = @outputs.list_out')
          )
        )
      );
      expect(diags).toHaveLength(0);
    });

    it('flags a wrong-typed element in a short-form `list[integer]` input', () => {
      // Short-form `list[X]` is read by a different shape-index branch from
      // long-form `type: list` + `value:`, but its element type still checks.
      const diags = byCode(
        runLint(single(['nums: list[integer]'], w('with nums = [1, "x"]'))),
        'render-with-type-mismatch'
      );
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain('item 2');
    });

    it('treats a short-form `list[object]` element as a closed empty object', () => {
      // Short-form cannot declare `fields:`, so the element object has none —
      // any inline key is unknown.
      const diags = byCode(
        runLint(single(['rows: list[object]'], w('with rows = [{a: 1}]'))),
        'render-with-nested-unknown-field'
      );
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain('a');
    });

    it('flags a missing required field on an object element of a list', () => {
      const diags = byCode(
        runLint(
          single(
            [
              'rows:',
              '    type: list',
              '        value: object',
              '            fields:',
              '                cell:',
              '                    type: string',
              '                    is_required: True',
            ],
            w('with rows = [{}]')
          )
        ),
        'render-with-nested-missing-required-field'
      );
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain('cell');
    });

    it('flags a scalar-typed resolved value bound to a list input', () => {
      // `@outputs.n` resolves to a number; a number can never be a list.
      const diags = byCode(
        runLint(
          single(
            ['nums:', '    type: list', '        value: string'],
            w('with nums = @outputs.n')
          )
        ),
        'render-with-type-mismatch'
      );
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain('expects a list, but got a number');
    });

    describe('item-count constraints', () => {
      const COUNTED = [
        'tags:',
        '    type: list',
        '        value: string',
        '        min_items: 2',
        '        max_items: 3',
      ];

      it.each([
        {
          label: 'below min_items',
          value: '["a"]',
          hit: true,
          needle: 'at least 2',
        },
        { label: 'at min', value: '["a", "b"]', hit: false },
        { label: 'at max', value: '["a", "b", "c"]', hit: false },
        {
          label: 'above max_items',
          value: '["a", "b", "c", "d"]',
          hit: true,
          needle: 'at most 3',
        },
      ])('$label', ({ value, hit, needle }) => {
        const diags = byCode(
          runLint(single(COUNTED, w(`with tags = ${value}`))),
          'render-with-constraint-violation'
        );
        expect(diags).toHaveLength(hit ? 1 : 0);
        if (needle) expect(diags[0].message).toContain(needle);
      });

      it('flags an inline `...` element and suppresses the count check', () => {
        for (const body of ['[...]', '["a", "b", "c", "d", ...]']) {
          const diags = renderWithCodes(
            runLint(single(COUNTED, w(`with tags = ${body}`)))
          );
          // The `...` is rejected outright (exactly once); the item-count check
          // is skipped (the count is unknowable) rather than piling on a report.
          expect(byCode(diags, 'render-with-ellipsis')).toHaveLength(1);
          expect(
            byCode(diags, 'render-with-constraint-violation')
          ).toHaveLength(0);
        }
      });
    });
  });

  // ------------------------------------------------------------------
  // Object inputs — nested fields, openness, and required-field checks.
  // ------------------------------------------------------------------
  describe('object inputs', () => {
    const OBJ = [
      'author:',
      '    type: object',
      '        fields:',
      '            name: string',
      '            handle:',
      '                type: string',
      '                is_required: True',
    ];

    it('accepts a complete inline object literal', () => {
      const diags = renderWithCodes(
        runLint(single(OBJ, w('with author = {name: "n", handle: "h"}')))
      );
      expect(diags).toHaveLength(0);
    });

    it('flags an unknown nested field as an Error', () => {
      const diags = byCode(
        runLint(
          single(OBJ, w('with author = {name: "n", handle: "h", bogus: 1}'))
        ),
        'render-with-nested-unknown-field'
      );
      expect(diags).toHaveLength(1);
      expect(diags[0].severity).toBe(1);
      expect(diags[0].message).toContain('bogus');
    });

    it('flags a missing required nested field as an Error', () => {
      const diags = byCode(
        runLint(single(OBJ, w('with author = {name: "n"}'))),
        'render-with-nested-missing-required-field'
      );
      expect(diags).toHaveLength(1);
      expect(diags[0].severity).toBe(1);
      expect(diags[0].message).toContain('handle');
    });

    it('flags a wrong-typed nested field value', () => {
      // `age` is numeric — a string clashes. (A string field would cast, so it
      // can't show a nested mismatch.)
      const numObj = [
        'author:',
        '    type: object',
        '        fields:',
        '            age: number',
        '            handle: string',
      ];
      const diags = byCode(
        runLint(single(numObj, w('with author = {age: "old", handle: "h"}'))),
        'render-with-type-mismatch'
      );
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain("field 'age'");
    });

    it('reports both missing required fields for an empty object literal in one consolidated lint', () => {
      const req = [
        'pair:',
        '    type: object',
        '        fields:',
        '            a:',
        '                type: string',
        '                is_required: True',
        '            b:',
        '                type: string',
        '                is_required: True',
      ];
      const diags = byCode(
        runLint(single(req, w('with pair = {}'))),
        'render-with-nested-missing-required-field'
      );
      // Consolidated: one lint per object level listing all missing fields.
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain('a');
      expect(diags[0].message).toContain('b');
    });

    it('a fields-less object rejects every sub-input (closed empty set)', () => {
      const diags = byCode(
        runLint(
          single(
            ['bag:', '    type: object'],
            w('with bag = {anything: 1, at_all: "y"}')
          )
        ),
        'render-with-nested-unknown-field'
      );
      expect(diags).toHaveLength(2);
      expect(diags.every(d => d.severity === 1)).toBe(true);
    });

    it('accepts an object-typed @outputs passthrough without introspecting fields', () => {
      // `@outputs.obj_out` resolves to an object → kind matches, fields not
      // introspected (the output schema is flat).
      const diags = renderWithCodes(
        runLint(singleOut(OBJ, w('with author = @outputs.obj_out')))
      );
      expect(diags).toHaveLength(0);
    });

    it('does not introspect a multi-line (block) dict value (known gap)', () => {
      // A block-style value spread across indented lines is not parsed as an
      // inline DictLiteral, so nested field checks do not reach it. Documented
      // so a future parser change that closes this gap trips this test.
      const diags = renderWithCodes(
        runLint(
          single(OBJ, w('with author =', '    name: 5', '    handle: "h"'))
        )
      );
      expect(diags).toHaveLength(0);
    });
  });

  // ------------------------------------------------------------------
  // Container/scalar kind clashes — literals AND typed expressions.
  // ------------------------------------------------------------------
  describe('kind clashes', () => {
    const OBJ = [
      'block:',
      '    type: object',
      '        fields:',
      '            v: number',
    ];
    const LIST = ['rows:', '    type: list', '        value: string'];

    // An object input accepts any value; when the value clearly isn't an object
    // (a scalar/list) the object's required fields are reported as unbound —
    // the actionable diagnostic — rather than a bare type-mismatch.
    it('reports missing required fields for a scalar bound to an object input', () => {
      const diags = byCode(
        runLint(single(OBJ, w('with block = "x"'))),
        'render-with-nested-missing-required-field'
      );
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain("'v'");
      // ...and NOT a type mismatch.
      expect(
        byCode(
          runLint(single(OBJ, w('with block = "x"'))),
          'render-with-type-mismatch'
        )
      ).toHaveLength(0);
    });

    it('reports missing required fields for a list literal bound to an object input', () => {
      expect(
        byCode(
          runLint(single(OBJ, w('with block = [1, 2]'))),
          'render-with-nested-missing-required-field'
        )
      ).toHaveLength(1);
    });

    it('flags a scalar literal bound to a list input', () => {
      const diags = byCode(
        runLint(single(LIST, w('with rows = "x"'))),
        'render-with-type-mismatch'
      );
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain(
        'expects a list, but got a single value'
      );
    });

    it('flags a dict literal bound to a list input', () => {
      const diags = byCode(
        runLint(single(LIST, w('with rows = {a: 1}'))),
        'render-with-type-mismatch'
      );
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain('expects a list, but got an object');
    });

    it('flags a dict literal bound to a scalar input', () => {
      const diags = byCode(
        runLint(
          single(['count:', '    type: integer'], w('with count = {a: 1}'))
        ),
        'render-with-type-mismatch'
      );
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain(
        'expects an integer, but got an object'
      );
    });

    it('flags a list literal bound to a scalar input', () => {
      const diags = byCode(
        runLint(single(['count:', '    type: integer'], w('with count = [1]'))),
        'render-with-type-mismatch'
      );
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain('expects an integer, but got a list');
    });

    it('reports missing required fields for a scalar-typed @variable bound to an object input', () => {
      const source = `variables:
    Age: linked number
        source: @MessagingSession.Age

${single(OBJ, w('with block = @variables.Age'))}`;
      const diags = byCode(
        runLint(source),
        'render-with-nested-missing-required-field'
      );
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain("'v'");
    });

    it('flags an arithmetic expression bound to a list input', () => {
      const diags = byCode(
        runLint(single(LIST, w('with rows = @outputs.n + 1'))),
        'render-with-type-mismatch'
      );
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain('list');
    });
  });

  // ------------------------------------------------------------------
  // Binary `+` — overloaded as numeric add or string concatenation, matching
  // the expression range action `with` bindings support.
  // ------------------------------------------------------------------
  describe('binary `+` expressions', () => {
    const NUM = ['level:', '    type: number'];

    it('accepts numeric arithmetic bound to a number input', () => {
      const diags = renderWithCodes(
        runLint(single(NUM, w('with level = @outputs.n + 1')))
      );
      expect(diags).toHaveLength(0);
    });

    it('flags string concatenation bound to a number input', () => {
      // Concatenation yields a string, so binding it to a number is a mismatch.
      const diags = byCode(
        runLint(single(NUM, w('with level = @outputs.text + "!"'))),
        'render-with-type-mismatch'
      );
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain('number');
    });

    it('treats a `+` with no string operand as arithmetic (number)', () => {
      // Neither operand resolves, and no operand is a known string, so `+`
      // defaults to arithmetic — accepted against a number input.
      expect(
        renderWithCodes(
          runLint(
            single(NUM, w('with level = @outputs.obj.a + @outputs.obj.b'))
          )
        )
      ).toHaveLength(0);
      // ...and flagged against a boolean input, since the default is number.
      expect(
        byCode(
          runLint(
            single(
              ['flag:', '    type: boolean'],
              w('with flag = @outputs.obj.a + @outputs.obj.b')
            )
          ),
          'render-with-type-mismatch'
        )
      ).toHaveLength(1);
    });
  });

  // ------------------------------------------------------------------
  // Deep composition — objects containing lists containing objects.
  // ------------------------------------------------------------------
  describe('deep composition', () => {
    const DEEP = [
      'report:',
      '    type: object',
      '        fields:',
      '            title: string',
      '            sections:',
      '                type: list',
      '                    value: object',
      '                        fields:',
      '                            rank: number',
    ];

    it('accepts a fully-valid deep literal', () => {
      const diags = renderWithCodes(
        runLint(
          single(DEEP, w('with report = {title: "T", sections: [{rank: 1}]}'))
        )
      );
      expect(diags).toHaveLength(0);
    });

    it('flags a wrong-typed field three levels deep', () => {
      // `rank` is numeric — a string clashes. (A string field would cast.)
      const diags = byCode(
        runLint(
          single(
            DEEP,
            w('with report = {title: "T", sections: [{rank: "high"}]}')
          )
        ),
        'render-with-type-mismatch'
      );
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain('rank');
    });

    it('recurses into a list-of-lists element shape', () => {
      const grid = [
        'grid:',
        '    type: list',
        '        value: list',
        '            value: object',
        '                fields:',
        '                    cell: number',
      ];
      const diags = byCode(
        runLint(single(grid, w('with grid = [[{cell: "x"}]]'))),
        'render-with-type-mismatch'
      );
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain('cell');
    });
  });

  // ------------------------------------------------------------------
  // "Leave it alone" — values the pass must not flag.
  // ------------------------------------------------------------------
  describe('unintrospectable / accepted values', () => {
    const STR = ['title:', '    type: string'];

    it.each([
      { label: 'plain @outputs ref', value: '@outputs.text' },
      { label: 'drilled @outputs member', value: '@outputs.obj.subject' },
      { label: 'interpolated string', value: '"Hi {!@outputs.text}"' },
      { label: 'ternary expression', value: '"a" if @outputs.flag else "b"' },
      { label: 'string concatenation of literals', value: '"a" + "b"' },
      {
        label: 'concatenation of an @outputs ref',
        value: '@outputs.text + "!"',
      },
    ])('does not flag $label bound to a string input', ({ value }) => {
      const diags = renderWithCodes(
        runLint(single(STR, w(`with title = ${value}`)))
      );
      expect(diags).toHaveLength(0);
    });
  });

  // ------------------------------------------------------------------
  // Messaging components — a schema-backed wrapper input. A component is bound
  // through its wrapper input, whose nested `fields:` are the sub-keys. What
  // matters is only whether the wrapper declares any fields: with fields it
  // binds like any object; with none there is nothing to bind, so any binding
  // is an unknown input — the same path as binding to any input-less format.
  // ------------------------------------------------------------------
  describe('messaging component binding', () => {
    // No fields under the wrapper — nothing to bind.
    const COMPONENT_NO_INPUTS = [
      'body: object',
      '    schema: "messaging_component://SomeComponent"',
    ];

    // The wrapper's `fields:` are the bindable sub-keys. Messaging component
    // params must declare defaults, so none is missing-required.
    const COMPONENT_WITH_INPUTS = [
      'body:',
      '    schema: "messaging_component://SomeComponent"',
      '    type: object',
      '        fields:',
      '            heading: string = "hi"',
      '            count: integer = 0',
    ];

    it('component with no inputs: any binding is an unknown input (the wrapper is not bindable)', () => {
      for (const binding of [
        'with body = {foo: 1}',
        'with body = 42',
        'with body = "x"',
        'with anything = 1',
      ]) {
        const diags = byCode(
          runLint(single(COMPONENT_NO_INPUTS, w(binding))),
          'render-with-unknown-input'
        );
        expect(diags).toHaveLength(1);
        expect(diags[0].severity).toBe(1); // Error
      }
    });

    it('component with no inputs: no `with` is clean', () => {
      expect(
        renderWithCodes(
          runLint(single(COMPONENT_NO_INPUTS, w('show_and_return: true')))
        )
      ).toHaveLength(0);
    });

    it('component with inputs: binds its nested fields through the wrapper', () => {
      for (const binding of [
        'with body = {heading: "x"}',
        'with body = {heading: "x", count: 3}',
      ]) {
        expect(
          renderWithCodes(runLint(single(COMPONENT_WITH_INPUTS, w(binding))))
        ).toHaveLength(0);
      }
    });

    it('component with inputs: a flat field name (not through the wrapper) is unknown', () => {
      const diags = byCode(
        runLint(single(COMPONENT_WITH_INPUTS, w('with heading = "x"'))),
        'render-with-unknown-input'
      );
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain('heading');
    });

    it('component with inputs: an unknown nested field is flagged', () => {
      const diags = byCode(
        runLint(single(COMPONENT_WITH_INPUTS, w('with body = {bogus: 1}'))),
        'render-with-nested-unknown-field'
      );
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain('bogus');
    });

    it('component with inputs: no `with` is clean (nested fields all have defaults)', () => {
      expect(
        renderWithCodes(
          runLint(single(COMPONENT_WITH_INPUTS, w('show_and_return: true')))
        )
      ).toHaveLength(0);
    });
  });

  // ------------------------------------------------------------------
  // `...` rejection — binding is all-or-nothing, so LLM-fill is unsupported
  // wherever it appears in a bound value.
  // ------------------------------------------------------------------
  describe('ellipsis rejection', () => {
    it('flags a top-level `...`', () => {
      const diags = byCode(
        runLint(doc(RICH_INPUTS, w('with title = ...'))),
        'render-with-ellipsis'
      );
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain('title');
    });

    it('flags a `...` in a nested object field', () => {
      const diags = byCode(
        runLint(doc(RICH_INPUTS, w('with block = {version: ..., label: "L"}'))),
        'render-with-ellipsis'
      );
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain('version');
    });

    it('flags a `...` list element', () => {
      const diags = byCode(
        runLint(doc(RICH_INPUTS, w('with rows = [{cell: "x"}, ...]'))),
        'render-with-ellipsis'
      );
      expect(diags).toHaveLength(1);
    });

    it('flags a `...` element even in an element-typeless list', () => {
      // A bare `list` (no `value:` element type) still rejects an inline `...`:
      // the element shape is unchecked, but LLM-fill is unsupported regardless.
      const diags = byCode(
        runLint(single(['tags:', '    type: list'], w('with tags = [...]'))),
        'render-with-ellipsis'
      );
      expect(diags).toHaveLength(1);
    });
  });

  // ------------------------------------------------------------------
  // None handling — a required input/field cannot be nulled out; an
  // optional one may be.
  // ------------------------------------------------------------------
  describe('None on required vs optional', () => {
    it('flags None bound to a required scalar input', () => {
      const diags = byCode(
        runLint(single(['title:', '    type: string'], w('with title = None'))),
        'render-with-required-none'
      );
      expect(diags).toHaveLength(1);
      expect(diags[0].severity).toBe(1); // Error
      expect(diags[0].message).toContain('title');
    });

    it('flags None bound to a required object input', () => {
      const diags = byCode(
        runLint(
          single(
            [
              'block:',
              '    type: object',
              '        fields:',
              '            v: number',
            ],
            w('with block = None')
          )
        ),
        'render-with-required-none'
      );
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain('block');
    });

    it('flags None bound to a required list input', () => {
      const diags = byCode(
        runLint(
          single(
            ['rows:', '    type: list', '        value: string'],
            w('with rows = None')
          )
        ),
        'render-with-required-none'
      );
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain('rows');
    });

    it('accepts None bound to an optional input', () => {
      const diags = renderWithCodes(
        runLint(
          single(
            ['nickname:', '    type: string', '    is_required: False'],
            w('with nickname = None')
          )
        )
      );
      expect(diags).toHaveLength(0);
    });

    it('flags None on a required nested field of an inline object', () => {
      const diags = byCode(
        runLint(
          single(
            [
              'block:',
              '    type: object',
              '        fields:',
              '            label:',
              '                type: string',
              '                is_required: True',
              '            note:',
              '                type: string',
              '                is_required: False',
            ],
            w('with block = {label: None, note: None}')
          )
        ),
        'render-with-required-none'
      );
      // `label` (required) is flagged; `note` (optional) is not.
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain('label');
    });
  });

  // ------------------------------------------------------------------
  // Whole-format scenarios exercised through the RICH input set.
  // ------------------------------------------------------------------
  describe('whole-format scenarios', () => {
    it('a fully and correctly bound render produces no diagnostics', () => {
      const diags = renderWithCodes(
        runLint(
          doc(
            RICH_INPUTS,
            w(
              'with tone = "casual"',
              'with count = 5',
              'with title = "Hello"',
              'with nickname = "Nick"',
              'with block = {version: 1, label: "L"}',
              'with rows = [{cell: "a"}, {cell: "b"}]'
            )
          )
        )
      );
      expect(diags).toHaveLength(0);
    });

    it('reports every unbound required input as missing in one consolidated lint (and skips the optional one)', () => {
      const diags = byCode(
        runLint(doc(RICH_INPUTS, w('with title = "only"'))),
        'render-with-missing-required-input'
      );
      // Consolidated: a single top-level lint listing all missing required inputs.
      expect(diags).toHaveLength(1);
      const msg = diags[0].message;
      expect(msg).toContain('tone');
      expect(msg).toContain('count');
      expect(msg).toContain('block');
      expect(msg).toContain('rows');
      expect(msg).not.toContain('nickname'); // optional
      expect(msg).not.toContain('title'); // bound
    });

    it('treats is_required as required when omitted (and skips is_required: False)', () => {
      // An input with no `is_required` defaults to required; `is_required: False`
      // opts out. Binding only `anchor` should flag `needed` but not `skippable`.
      const inputs = inp(
        'anchor: string',
        'needed: string',
        'skippable:',
        '    type: string',
        '    is_required: False'
      );
      const msgs = byCode(
        runLint(doc(inputs, w('with anchor = "x"'))),
        'render-with-missing-required-input'
      ).map(d => d.message);
      expect(msgs.some(m => m.includes("'needed'"))).toBe(true);
      expect(msgs.some(m => m.includes("'skippable'"))).toBe(false);
    });

    it('does not report missing required inputs when the render binds nothing', () => {
      // No `with` clauses: the author has left every input to the LLM, which is
      // allowed. All-or-nothing only kicks in once at least one input is bound.
      const diags = byCode(
        runLint(doc(RICH_INPUTS, w('show_and_return: True'))),
        'render-with-missing-required-input'
      );
      expect(diags).toHaveLength(0);
    });

    it('anchors missing-required to the render line, not the action', () => {
      // The squiggle belongs on `render: ...` (where the binding intent lives),
      // not on the `act: @actions.DoThing` reference above it.
      const source = doc(RICH_INPUTS, w('with title = "only"'));
      const lines = source.split('\n');
      const renderLine = lines.findIndex(l => l.includes('render:'));
      const actionLine = lines.findIndex(l => l.includes('@actions.DoThing'));
      const diags = byCode(
        runLint(source),
        'render-with-missing-required-input'
      );
      expect(diags.length).toBeGreaterThan(0);
      for (const d of diags) {
        expect(d.range.start.line).toBe(renderLine);
        expect(d.range.start.line).not.toBe(actionLine);
      }
    });

    it('does not avalanche missing-required on a paramless (malformed) `with`', () => {
      // `with = 5` error-recovers to a WithClause binding no param. It must not
      // count as opting into all-or-nothing, or a single syntax slip would fire
      // missing-required for every declared input on top of the parse error.
      const diags = byCode(
        runLint(doc(RICH_INPUTS, w('with = 5'))),
        'render-with-missing-required-input'
      );
      expect(diags).toHaveLength(0);
    });

    it('flags an unknown top-level input with a near-name suggestion', () => {
      const diags = byCode(
        runLint(doc(RICH_INPUTS, w('with titl = "x"'))),
        'render-with-unknown-input'
      );
      expect(diags).toHaveLength(1);
      expect(diags[0].severity).toBe(1);
      expect(diags[0].data?.suggestion).toBe('title');
    });

    it('flags a duplicate binding of the same input', () => {
      const diags = byCode(
        runLint(doc(RICH_INPUTS, w('with title = "a"', 'with title = "b"'))),
        'render-with-duplicate-input'
      );
      expect(diags).toHaveLength(1);
    });

    it('flags a duplicate key repeated within one inline dict', () => {
      const diags = byCode(
        runLint(
          doc(
            RICH_INPUTS,
            w('with block = {version: 1, version: 2, label: "L"}')
          )
        ),
        'render-with-duplicate-input'
      );
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain('version');
    });

    it('does not report an input that declares a default as missing', () => {
      const diags = byCode(
        runLint(
          single(
            ['greeting: string = "hi"', 'title: string'],
            w('with title = "x"')
          )
        ),
        'render-with-missing-required-input'
      );
      expect(diags).toHaveLength(0);
    });

    it('treats an object as satisfied when every field declares a default', () => {
      // `block` has no direct default, but both fields do — the definition
      // fully supplies its value, so no binding is required.
      const diags = byCode(
        runLint(
          single(
            [
              'block:',
              '    type: object',
              '        fields:',
              '            version: number = 1',
              '            label: string = "L"',
              'title: string',
            ],
            w('with title = "x"')
          )
        ),
        'render-with-missing-required-input'
      );
      expect(diags).toHaveLength(0);
    });

    it('still reports an object whose field lacks a default', () => {
      // One field (`label`) has no default and is required, so the object is
      // not fully supplied — it must be bound.
      const diags = byCode(
        runLint(
          single(
            [
              'block:',
              '    type: object',
              '        fields:',
              '            version: number = 1',
              '            label: string',
              'title: string',
            ],
            w('with title = "x"')
          )
        ),
        'render-with-missing-required-input'
      );
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain('block');
    });

    it('treats an object as satisfied when its non-defaulted fields are optional', () => {
      // A defaulted field plus an optional field (no default) — nothing is
      // left requiring a value.
      const diags = byCode(
        runLint(
          single(
            [
              'block:',
              '    type: object',
              '        fields:',
              '            version: number = 1',
              '            label:',
              '                type: string',
              '                is_required: False',
              'title: string',
            ],
            w('with title = "x"')
          )
        ),
        'render-with-missing-required-input'
      );
      expect(diags).toHaveLength(0);
    });

    it('treats a list of objects as satisfied when the element fields default', () => {
      const diags = byCode(
        runLint(
          single(
            [
              'rows:',
              '    type: list',
              '        value: object',
              '            fields:',
              '                cell: string = "c"',
              'title: string',
            ],
            w('with title = "x"')
          )
        ),
        'render-with-missing-required-input'
      );
      expect(diags).toHaveLength(0);
    });

    it('still requires a list with a min_items floor even when its element defaults', () => {
      // A `min_items` floor demands real elements, which an element default
      // cannot supply, so the list must still be bound.
      const diags = byCode(
        runLint(
          single(
            [
              'rows:',
              '    type: list',
              '        value: object',
              '            fields:',
              '                cell: string = "c"',
              '        min_items: 2',
              'title: string',
            ],
            w('with title = "x"')
          )
        ),
        'render-with-missing-required-input'
      );
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain('rows');
    });

    it('propagates default satisfaction through nested objects', () => {
      // The grandchild `deep` defaults, so `inner` is satisfied, so `block` is.
      const diags = byCode(
        runLint(
          single(
            [
              'block:',
              '    type: object',
              '        fields:',
              '            inner:',
              '                type: object',
              '                    fields:',
              '                        deep: string = "d"',
              'title: string',
            ],
            w('with title = "x"')
          )
        ),
        'render-with-missing-required-input'
      );
      expect(diags).toHaveLength(0);
    });

    it('does not satisfy a nested required field via sibling defaults', () => {
      // Inside an inline object binding, a field with no default is still
      // required even when its siblings default.
      const diags = byCode(
        runLint(
          single(
            [
              'block:',
              '    type: object',
              '        fields:',
              '            version: number = 1',
              '            label: string',
            ],
            w('with block = {version: 2}')
          )
        ),
        'render-with-nested-missing-required-field'
      );
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain('label');
    });

    it('honors a nested field default inside an inline object binding', () => {
      // `version` defaults, so omitting it from the inline dict is fine; only
      // the non-defaulted required `label` must be present.
      const diags = byCode(
        runLint(
          single(
            [
              'block:',
              '    type: object',
              '        fields:',
              '            version: number = 1',
              '            label: string',
            ],
            w('with block = {label: "L"}')
          )
        ),
        'render-with-nested-missing-required-field'
      );
      expect(diags).toHaveLength(0);
    });
  });

  // ------------------------------------------------------------------
  // Ref forms — how the render target itself is resolved.
  // ------------------------------------------------------------------
  describe('render target resolution', () => {
    it('resolves the shortform `@response_formats.X` against the when-connection', () => {
      // `count` is an integer input; a string clashes — proving the shortform
      // ref resolved to the format and its inputs were checked.
      const source = doc(RICH_INPUTS, w('with count = "x"')).replace(
        'render: @connection.messaging.response_formats.rich',
        'render: @response_formats.rich'
      );
      const diags = byCode(runLint(source), 'render-with-type-mismatch');
      expect(diags).toHaveLength(1);
    });

    it('flags an unknown top-level input when the only input is a fields-less object', () => {
      // A fields-less object still counts as a declared input — binding an
      // unrelated name is an unknown top-level input.
      const diags = byCode(
        runLint(single(['bag:', '    type: object'], w('with nope = 1'))),
        'render-with-unknown-input'
      );
      expect(diags).toHaveLength(1);
    });

    it('flags a `with` on a format that declares no inputs', () => {
      // The format's inputs are a closed set — empty here — so any `with`
      // names an unknown input, regardless of what the target is.
      const source = `
connection messaging:
    response_formats:
        audio:
            description: "d"
            target: "system://MessagingAudio"
topic Foo:
    description: "d"
    actions:
        DoThing:
            description: "does"
            target: "apex://Do"
            outputs:
                n: number
    reasoning:
        instructions: ->
            |x
        actions:
            act: @actions.DoThing
                when @connection.messaging
                    render: @connection.messaging.response_formats.audio
                        with whatever = "x"
`.trimStart();
      const diags = byCode(runLint(source), 'render-with-unknown-input');
      expect(diags).toHaveLength(1);
      expect(diags[0].severity).toBe(1);
    });

    it('does not touch a plain (non-render) topic action binding', () => {
      const source = `
topic Foo:
    description: "d"
    actions:
        DoThing:
            description: "does"
            target: "apex://Do"
            inputs:
                q: string
    reasoning:
        instructions: ->
            |x
        actions:
            act: @actions.DoThing
                with q = "hello"
`.trimStart();
      expect(renderWithCodes(runLint(source))).toHaveLength(0);
    });
  });

  // ------------------------------------------------------------------
  // @outputs references resolved against the action's output schema.
  // Outputs available: n (number), text (string), obj_out (object),
  // list_out (list[integer]). Only the top level is typed — the output
  // schema is flat — so drilled/unknown refs are left alone.
  // ------------------------------------------------------------------
  describe('@outputs references', () => {
    interface OutCase {
      label: string;
      input: string[]; // input declaration lines (under inp column)
      value: string; // the @outputs expression bound
      mismatch: boolean; // true → expect exactly one type-mismatch
    }

    const CASES: OutCase[] = [
      // scalar family: resolved output type checked against the input type.
      // A `string` input accepts only string-family resolved types; a
      // number/object/list source is a mismatch.
      {
        label: 'number output -> string input',
        input: ['f:', '    type: string'],
        value: '@outputs.n',
        mismatch: true,
      },
      {
        label: 'number output -> number input',
        input: ['f:', '    type: number'],
        value: '@outputs.n',
        mismatch: false,
      },
      {
        label: 'number output -> integer input (numeric family)',
        input: ['f:', '    type: integer'],
        value: '@outputs.n',
        mismatch: false,
      },
      {
        label: 'string output -> number input',
        input: ['f:', '    type: number'],
        value: '@outputs.text',
        mismatch: true,
      },
      // container/scalar kind clashes — a `string` target does not accept them.
      {
        label: 'object output -> string input',
        input: ['f:', '    type: string'],
        value: '@outputs.obj_out',
        mismatch: true,
      },
      {
        label: 'list output -> string input',
        input: ['f:', '    type: string'],
        value: '@outputs.list_out',
        mismatch: true,
      },
      {
        label: 'object output -> list input',
        input: ['f:', '    type: list', '        value: string'],
        value: '@outputs.obj_out',
        mismatch: true,
      },
      // NOTE: a resolved-list bound to an object input is NOT a type-mismatch —
      // it reports the object's missing required fields instead (see "kind
      // clashes" > scalar-typed @variable bound to an object input).
      // matching kinds accepted (loose containers, inner shape not checked)
      {
        label: 'object output -> object input (loose)',
        input: [
          'f:',
          '    type: object',
          '        fields:',
          '            k: string',
        ],
        value: '@outputs.obj_out',
        mismatch: false,
      },
      {
        label: 'list output -> list input (loose)',
        input: ['f:', '    type: list', '        value: string'],
        value: '@outputs.list_out',
        mismatch: false,
      },
      // unresolvable → left alone
      {
        label: 'drilled @outputs (flat schema, no nested type)',
        input: ['f:', '    type: string'],
        value: '@outputs.obj_out.k',
        mismatch: false,
      },
      {
        label: 'unknown output name',
        input: ['f:', '    type: string'],
        value: '@outputs.nope',
        mismatch: false,
      },
    ];

    it.each(CASES)('$label', ({ input, value, mismatch }) => {
      const diags = byCode(
        runLint(singleOut(input, w(`with f = ${value}`))),
        'render-with-type-mismatch'
      );
      expect(diags).toHaveLength(mismatch ? 1 : 0);
    });

    it('does not constraint-check a resolvable @outputs scalar', () => {
      // `@outputs.n` is family-compatible with integer, but its runtime value
      // is unknown — so range constraints are not evaluated.
      const diags = byCode(
        runLint(
          singleOut(
            ['f:', '    type: integer', '        minimum: 100'],
            w('with f = @outputs.n')
          )
        ),
        'render-with-constraint-violation'
      );
      expect(diags).toHaveLength(0);
    });

    it('flags a wrong-typed @outputs bound to a nested object field', () => {
      // The dict literal is introspected; its `version` field (number) is bound
      // to `@outputs.text` (string) → a nested type mismatch.
      const diags = byCode(
        runLint(
          singleOut(
            [
              'block:',
              '    type: object',
              '        fields:',
              '            version: number',
            ],
            w('with block = {version: @outputs.text}')
          )
        ),
        'render-with-type-mismatch'
      );
      expect(diags).toHaveLength(1);
      expect(diags[0].message).toContain("field 'version'");
    });
  });
});

// ============================================================================
// Connection inputs as binding values (@inputs.Y / @connection.X.inputs.Y)
// ============================================================================

describe('connection inputs as with-binding values', () => {
  // Two connections: `messaging` (the active one) declares string/integer
  // inputs; `voice` exists so a long-form ref can name a different connection.
  // The `rich` format's inputs are optional, so only the value under test
  // produces diagnostics.
  function docCI(withLine: string): string {
    return `
connection messaging:
    inputs:
        user_name: string
        age: integer
    response_formats:
        rich:
            description: "d"
            target: "apex://H"
            inputs:
                title:
                    type: string
                    is_required: False
                count:
                    type: integer
                    is_required: False
connection voice:
    inputs:
        seat: string
    response_formats:
        spoken:
            description: "d"
            target: "apex://V"
            inputs:
                utterance:
                    type: string
                    is_required: False
topic Foo:
    description: "d"
    actions:
        DoThing:
            description: "does"
            target: "apex://Do"
            outputs:
                text: string
    reasoning:
        instructions: ->
            |Do the thing
        actions:
            act: @actions.DoThing
                when @connection.messaging
                    render: @connection.messaging.response_formats.rich
                        ${withLine}
                        show_and_return: True
`.trimStart();
  }

  it('accepts a valid short-form @inputs.Y value with no spurious undefined-reference', () => {
    const diags = runLint(docCI('with title = @inputs.user_name'));
    expect(renderWithCodes(diags)).toEqual([]);
    // Regression: the short form must not trip undefined-reference here.
    expect(byCode(diags, 'undefined-reference')).toEqual([]);
  });

  it('accepts a valid long-form @connection.X.inputs.Y value', () => {
    const diags = runLint(
      docCI('with title = @connection.messaging.inputs.user_name')
    );
    expect(renderWithCodes(diags)).toEqual([]);
    expect(byCode(diags, 'undefined-reference')).toEqual([]);
  });

  it('type-checks a short-form @inputs.Y value against the target input', () => {
    // user_name is a string; count is an integer — a family clash.
    const diags = byCode(
      runLint(docCI('with count = @inputs.user_name')),
      'render-with-type-mismatch'
    );
    expect(diags).toHaveLength(1);
  });

  it('accepts a family-compatible short-form @inputs.Y value', () => {
    const diags = renderWithCodes(runLint(docCI('with count = @inputs.age')));
    expect(diags).toEqual([]);
  });

  it('type-checks a long-form @connection.X.inputs.Y value against the target input', () => {
    // `user_name` is a string on the active connection `messaging`; binding it
    // to the integer `count` via a long-form ref is a family clash — proving
    // long-form refs to the active connection are type-checked.
    const diags = byCode(
      runLint(docCI('with count = @connection.messaging.inputs.user_name')),
      'render-with-type-mismatch'
    );
    expect(diags).toHaveLength(1);
  });

  it('flags a short-form @inputs.Y naming an input the active connection lacks', () => {
    const diags = byCode(
      runLint(docCI('with title = @inputs.nope')),
      'render-with-unknown-connection-input'
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe(DiagnosticSeverity.Error);
    expect(diags[0].message).toContain('messaging');
    // The false-positive undefined-reference is suppressed in favor of ours.
    expect(
      byCode(runLint(docCI('with title = @inputs.nope')), 'undefined-reference')
    ).toEqual([]);
  });

  it('flags a long-form value naming a connection other than the active one', () => {
    const diags = byCode(
      runLint(docCI('with title = @connection.voice.inputs.seat')),
      'render-with-input-connection-mismatch'
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe(DiagnosticSeverity.Error);
    expect(diags[0].message).toContain('voice');
    expect(diags[0].message).toContain('messaging');
  });

  it('leaves long-form existence errors to the base undefined-reference pass', () => {
    // `ghost` is not a declared connection — the generic pass owns that error,
    // and we add no mismatch (the connection is not in our index).
    const diags = runLint(docCI('with title = @connection.ghost.inputs.seat'));
    expect(byCode(diags, 'render-with-input-connection-mismatch')).toEqual([]);
    expect(byCode(diags, 'undefined-reference').length).toBeGreaterThan(0);
  });
});

// ============================================================================
// Lint consolidation: one root cause → one lint
// ============================================================================

describe('lint consolidation', () => {
  // Duplicate binding — only the winning (last) value is validated.
  describe('duplicate binding validates only the winner', () => {
    it('does not type-check an earlier duplicate whose value is discarded', () => {
      // count is an integer. The losing (first) value is a string clash; the
      // winning (last) value is valid — no type-mismatch should surface.
      const src = single(
        ['count:', '    type: integer', '    is_required: False'],
        w('with count = "bad"', 'with count = 5')
      );
      expect(byCode(runLint(src), 'render-with-type-mismatch')).toHaveLength(0);
      expect(byCode(runLint(src), 'render-with-duplicate-input')).toHaveLength(
        1
      );
    });

    it('type-checks the winning (last) value when it is the wrong type', () => {
      const src = single(
        ['count:', '    type: integer', '    is_required: False'],
        w('with count = 5', 'with count = "bad"')
      );
      // One duplicate warning + exactly one mismatch (on the winner), not two.
      expect(byCode(runLint(src), 'render-with-duplicate-input')).toHaveLength(
        1
      );
      expect(byCode(runLint(src), 'render-with-type-mismatch')).toHaveLength(1);
    });

    it('flags every earlier occurrence when a binding repeats three times', () => {
      // Three occurrences → two duplicate warnings (each earlier one), only the
      // last wins.
      const src = single(
        ['title:', '    type: string', '    is_required: False'],
        w('with title = "a"', 'with title = "b"', 'with title = "c"')
      );
      expect(byCode(runLint(src), 'render-with-duplicate-input')).toHaveLength(
        2
      );
    });
  });

  // A typo whose closest match is a required input/field is the same root cause
  // as that name being "missing" — suppress the missing lint.
  describe('typo suppresses the missing-required for its closest match', () => {
    it('top level: a misspelled required input does not also flag it as missing', () => {
      const src = single(
        ['title: string', 'other: string'],
        w('with titel = "x"')
      );
      const diags = runLint(src);
      const unknown = byCode(diags, 'render-with-unknown-input');
      expect(unknown).toHaveLength(1);
      expect(unknown[0].data?.suggestion).toBe('title');

      const missing = byCode(diags, 'render-with-missing-required-input');
      // 'title' is suppressed (it's the typo's target); only 'other' remains.
      expect(missing).toHaveLength(1);
      expect(missing[0].message).toContain('other');
      expect(missing[0].message).not.toContain('title');
    });

    it('nested: a misspelled required field does not also flag it as missing', () => {
      const src = single(
        [
          'block:',
          '    type: object',
          '        fields:',
          '            version: number',
          '            label:',
          '                type: string',
          '                is_required: True',
        ],
        w('with block = {versoin: 1}')
      );
      const diags = runLint(src);
      const unknown = byCode(diags, 'render-with-nested-unknown-field');
      expect(unknown).toHaveLength(1);
      expect(unknown[0].data?.suggestion).toBe('version');

      const missing = byCode(
        diags,
        'render-with-nested-missing-required-field'
      );
      // 'version' is suppressed (typo target); only 'label' remains.
      expect(missing).toHaveLength(1);
      expect(missing[0].message).toContain('label');
      expect(missing[0].message).not.toContain('version');
    });
  });

  // A wrong connection-input reference is the root cause — do not also
  // type-check the (already-wrong) value against the target.
  it('a mismatched connection-input value is not also type-checked', () => {
    // voice.seat (string) bound to messaging's integer `count`: the ref belongs
    // to the wrong connection. That single mismatch fires; no type-mismatch.
    const src = `
connection messaging:
    inputs:
        user_name: string
    response_formats:
        rich:
            description: "d"
            target: "apex://H"
            inputs:
                count:
                    type: integer
                    is_required: False
connection voice:
    inputs:
        seat: string
topic Foo:
    description: "d"
    actions:
        DoThing:
            description: "does"
            target: "apex://Do"
            outputs:
                text: string
    reasoning:
        instructions: ->
            |Do the thing
        actions:
            act: @actions.DoThing
                when @connection.messaging
                    render: @connection.messaging.response_formats.rich
                        with count = @connection.voice.inputs.seat
                        show_and_return: True
`.trimStart();
    expect(
      byCode(runLint(src), 'render-with-input-connection-mismatch')
    ).toHaveLength(1);
    expect(byCode(runLint(src), 'render-with-type-mismatch')).toHaveLength(0);
  });

  // Missing-required is consolidated into one lint per level, and each level
  // reports only its own keys (one layer deep), not its descendants'.
  it('reports missing keys per level, not merged across levels', () => {
    // Top level requires `extra` (unbound) + `block` (bound, but its inline
    // literal omits the required `label`). Two levels, one lint each.
    const inputs = inp(
      'extra: string',
      'block:',
      '    type: object',
      '        fields:',
      '            version: number',
      '            label:',
      '                type: string',
      '                is_required: True'
    );
    const diags = runLint(doc(inputs, w('with block = {version: 1}')));

    const top = byCode(diags, 'render-with-missing-required-input');
    expect(top).toHaveLength(1);
    expect(top[0].message).toContain('extra');
    expect(top[0].message).not.toContain('label'); // nested — reported below

    const nested = byCode(diags, 'render-with-nested-missing-required-field');
    expect(nested).toHaveLength(1);
    expect(nested[0].message).toContain('label');
    expect(nested[0].message).not.toContain('extra'); // top-level — not here
  });

  it('emits one missing lint per level for a 3-deep inline object', () => {
    // outer/mid/inner are nested objects; each level omits its own required
    // field. Each level reports only its own field, one layer deep.
    const inputs = inp(
      'outer:',
      '    type: object',
      '        fields:',
      '            outer_req: string',
      '            mid:',
      '                type: object',
      '                    fields:',
      '                        mid_req: string',
      '                        inner:',
      '                            type: object',
      '                                fields:',
      '                                    inner_req: string'
    );
    const diags = byCode(
      runLint(doc(inputs, w('with outer = {mid: {inner: {}}}'))),
      'render-with-nested-missing-required-field'
    );
    expect(diags).toHaveLength(3);
    const messages = diags.map(d => d.message).join('\n');
    expect(messages).toContain('outer_req');
    expect(messages).toContain('mid_req');
    expect(messages).toContain('inner_req');
  });

  // The nested (inline-dict) path must mirror the top-level winner-only rule:
  // a discarded duplicate key is not type-checked.
  it('does not type-check a discarded duplicate key inside an inline dict', () => {
    const diags = runLint(
      single(
        [
          'block:',
          '    type: object',
          '        fields:',
          '            version: number',
          '            label:',
          '                type: string',
          '                is_required: True',
        ],
        // `version` bound twice: the losing "bad" (a string) must not clash;
        // the winning `1` (a number) is valid.
        w('with block = {version: "bad", version: 1, label: "L"}')
      )
    );
    expect(byCode(diags, 'render-with-duplicate-input')).toHaveLength(1);
    expect(byCode(diags, 'render-with-type-mismatch')).toHaveLength(0);
  });

  it('a duplicated unknown input reports the unknown once, plus one duplicate', () => {
    const diags = runLint(
      single(
        ['title: string', 'other: string'],
        w('with foo = 1', 'with foo = 2')
      )
    );
    expect(byCode(diags, 'render-with-unknown-input')).toHaveLength(1);
    expect(byCode(diags, 'render-with-duplicate-input')).toHaveLength(1);
  });

  it('a typo that is also duplicated still suppresses its target and flags one duplicate', () => {
    const diags = runLint(
      single(
        ['title: string', 'other: string'],
        w('with titel = "x"', 'with titel = "y"')
      )
    );
    expect(byCode(diags, 'render-with-unknown-input')).toHaveLength(1);
    expect(byCode(diags, 'render-with-duplicate-input')).toHaveLength(1);
    const missing = byCode(diags, 'render-with-missing-required-input');
    expect(missing).toHaveLength(1);
    expect(missing[0].message).toContain('other');
    expect(missing[0].message).not.toContain('title'); // suppressed by the typo
  });

  it('two distinct typos of the same required input both suppress it', () => {
    const diags = runLint(
      single(
        ['title: string', 'other: string'],
        w('with titel = "x"', 'with titl = "y"')
      )
    );
    // Two distinct unknown inputs, both closest to `title`.
    expect(byCode(diags, 'render-with-unknown-input')).toHaveLength(2);
    const missing = byCode(diags, 'render-with-missing-required-input');
    expect(missing).toHaveLength(1);
    expect(missing[0].message).toContain('other');
    expect(missing[0].message).not.toContain('title');
  });

  it('a short-form @inputs typo does not also type-check against the target', () => {
    // `@inputs.nope` is an unknown connection input bound to the integer
    // `count`. The unknown-input error fires; no type-mismatch is stacked.
    const src = `
connection messaging:
    inputs:
        user_name: string
    response_formats:
        rich:
            description: "d"
            target: "apex://H"
            inputs:
                count:
                    type: integer
                    is_required: False
topic Foo:
    description: "d"
    actions:
        DoThing:
            description: "does"
            target: "apex://Do"
            outputs:
                text: string
    reasoning:
        instructions: ->
            |Do the thing
        actions:
            act: @actions.DoThing
                when @connection.messaging
                    render: @connection.messaging.response_formats.rich
                        with count = @inputs.nope
                        show_and_return: True
`.trimStart();
    const diags = runLint(src);
    expect(byCode(diags, 'render-with-unknown-connection-input')).toHaveLength(
      1
    );
    expect(byCode(diags, 'render-with-type-mismatch')).toHaveLength(0);
  });

  it('a single missing required input uses the singular phrasing', () => {
    const diags = byCode(
      runLint(
        single(
          [
            'title: string',
            'extra:',
            '    type: string',
            '    is_required: False',
          ],
          w('with extra = "x"')
        )
      ),
      'render-with-missing-required-input'
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].message).toMatch(/Required input '.+' is not bound/);
  });
});

// ============================================================================
// json (built-in primitive format) — `with` bindings are rejected
//
// The built-in `@response_formats.json` primitive has no fields, so any `with`
// clause is a single primitive-no-fields Error (never a per-clause pile). The
// render-rule *ownership* / empty-when tests live in `render-rules.test.ts`.
// ============================================================================

describe('json primitive format rejects with-bindings', () => {
  it('flags any `with` binding on the built-in json format with one primitive-no-fields Error', () => {
    // A built-in primitive format has no fields to fill in — one explicit
    // error, not a per-clause "unknown input" pile.
    const source = doc(RICH_INPUTS, w('with foo = 1')).replace(
      'render: @connection.messaging.response_formats.rich',
      'render: @response_formats.json'
    );
    const diags = byCode(runLint(source), 'render-with-primitive-no-fields');
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe(DiagnosticSeverity.Error);
    expect(diags[0].message).toContain('json');
    // No misleading "unknown input" (or any other render-with) noise.
    const otherRenderWith = runLint(source).filter(
      d =>
        String(d.code).startsWith('render-with') &&
        d.code !== 'render-with-primitive-no-fields'
    );
    expect(otherRenderWith).toEqual([]);
  });

  it('fails fast: multiple `with` bindings on json yield exactly one error', () => {
    // Fail-fast — several bindings (one of them ill-typed/unknown against a real
    // format) collapse to a single primitive-no-fields error on json.
    const source = doc(
      RICH_INPUTS,
      w('with foo = 1', 'with count = "x"', 'with bogus = {a: 1}')
    ).replace(
      'render: @connection.messaging.response_formats.rich',
      'render: @response_formats.json'
    );
    const renderWith = runLint(source).filter(d =>
      String(d.code).startsWith('render-with')
    );
    expect(renderWith).toHaveLength(1);
    expect(renderWith[0].code).toBe('render-with-primitive-no-fields');
  });

  it('allows a bare `render: @response_formats.json` with no bindings', () => {
    const source = doc(RICH_INPUTS, '').replace(
      'render: @connection.messaging.response_formats.rich',
      'render: @response_formats.json'
    );
    const renderWith = runLint(source).filter(d =>
      String(d.code).startsWith('render-with')
    );
    expect(renderWith).toEqual([]);
  });
});
