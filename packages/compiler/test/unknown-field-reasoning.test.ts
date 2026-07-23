/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import { parseSource } from './test-utils.js';

describe('unknown fields in reasoning actions', () => {
  it('should emit error for unrecognized fields in reasoning actions', () => {
    const source = `config:
    agent_type: "customer_facing"

actions:
    Lookup_Order:
        description: "Lookup order"
        inputs:
            order_number: string
        outputs:
            status: string

subagent main:
    description: "Main agent"
    reasoning:
        instructions: ->
            | Hello
        actions:
            lookup: @actions.Lookup_Order
                description: "Looks up an order"
                unknown_field: "this should error"
                another_bad: "also bad"
                with order_number=@variables.order_number`;

    const { diagnostics } = compile(parseSource(source));

    const unknownFieldErrors = diagnostics.filter(d =>
      d.message.includes('Unknown field')
    );
    expect(unknownFieldErrors).toHaveLength(2);
    expect(unknownFieldErrors[0].message).toContain('unknown_field');
    expect(unknownFieldErrors[0].message).toContain('lookup');
    expect(unknownFieldErrors[1].message).toContain('another_bad');
  });

  it('should not error for known fields (description, label)', () => {
    const source = `config:
    agent_type: "customer_facing"

actions:
    Lookup_Order:
        description: "Lookup order"
        inputs:
            order_number: string
        outputs:
            status: string

subagent main:
    description: "Main agent"
    reasoning:
        instructions: ->
            | Hello
        actions:
            lookup: @actions.Lookup_Order
                description: "Looks up an order"
                label: "Order Lookup"
                with order_number=@variables.order_number`;

    const { diagnostics } = compile(parseSource(source));

    const unknownFieldErrors = diagnostics.filter(d =>
      d.message.includes('Unknown field')
    );
    expect(unknownFieldErrors).toHaveLength(0);
  });

  it('should emit error for unknown fields on transition actions', () => {
    const source = `config:
    agent_type: "customer_facing"

subagent main:
    description: "Main agent"
    reasoning:
        instructions: ->
            | Hello
        actions:
            go_to_other: @utils.transition to @subagent.Other
                description: "Go to other"
                bad_field: "nope"

subagent Other:
    description: "Other agent"
    reasoning:
        instructions: ->
            | Other`;

    const { diagnostics } = compile(parseSource(source));

    const unknownFieldErrors = diagnostics.filter(d =>
      d.message.includes('Unknown field')
    );
    expect(unknownFieldErrors).toHaveLength(1);
    expect(unknownFieldErrors[0].message).toContain('bad_field');
    expect(unknownFieldErrors[0].message).toContain('go_to_other');
  });
});
