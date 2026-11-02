/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Lint rules for the `ask for` statement:
 * - `collect-target-already-set`: the target variable already holds a literal
 *   when the `ask for` is reached (a literal default, or a literal `set` earlier
 *   in the procedure), so the step is already answered and the user is never
 *   asked.
 * - `collect-condition-contradicts`: the `ask for` is wrapped in an `if` whose
 *   condition can never be true while the target is None.
 *
 * Every test spells out its full script, so the input and the expected result
 * can be read together.
 */

import { describe, it, expect } from 'vitest';
import { DiagnosticSeverity } from '@agentscript/types';
import type { Diagnostic } from '@agentscript/types';
import { parseDocument, testSchemaCtx } from './test-utils.js';
import { createLintEngine } from '../lint/index.js';

function codes(source: string, code: string): Diagnostic[] {
  const ast = parseDocument(source);
  const { diagnostics } = createLintEngine().run(ast, testSchemaCtx);
  return diagnostics.filter(d => d.code === code);
}

describe('collect-target-already-set: literal default', () => {
  const CODE = 'collect-target-already-set';

  it('warns when the target defaults to an empty string', () => {
    const source = `variables:
  city: mutable string = ""
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      ask for @variables.city
        instructions: "Which city are you in?"
`;
    expect(codes(source, CODE)).toHaveLength(1);
  });

  it('warns when the target defaults to zero', () => {
    const source = `variables:
  city: mutable number = 0
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      ask for @variables.city
        instructions: "Which city are you in?"
`;
    expect(codes(source, CODE)).toHaveLength(1);
  });

  it('warns when the target defaults to False', () => {
    const source = `variables:
  city: mutable boolean = False
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      ask for @variables.city
        instructions: "Which city are you in?"
`;
    expect(codes(source, CODE)).toHaveLength(1);
  });

  it('warns when the target defaults to an empty list', () => {
    const source = `variables:
  city: mutable list = []
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      ask for @variables.city
        instructions: "Which city are you in?"
`;
    expect(codes(source, CODE)).toHaveLength(1);
  });

  it('warns when the target defaults to a negative number', () => {
    const source = `variables:
  city: mutable number = -1
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      ask for @variables.city
        instructions: "Which city are you in?"
`;
    expect(codes(source, CODE)).toHaveLength(1);
  });

  it('names the variable and the literal, as a warning', () => {
    const source = `variables:
  city: mutable string = ""
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      ask for @variables.city
        instructions: "Which city are you in?"
`;
    const [diag] = codes(source, CODE);
    expect(diag.severity).toBe(DiagnosticSeverity.Warning);
    expect(diag.message).toContain("'city'");
    expect(diag.message).toContain('`""`');
  });

  it('does not warn when the target has no default', () => {
    const source = `variables:
  city: mutable string
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      ask for @variables.city
        instructions: "Which city are you in?"
`;
    expect(codes(source, CODE)).toHaveLength(0);
  });

  it('does not warn when the target defaults to None', () => {
    const source = `variables:
  city: mutable string = None
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      ask for @variables.city
        instructions: "Which city are you in?"
`;
    expect(codes(source, CODE)).toHaveLength(0);
  });

  it('does not warn when the target is a linked variable', () => {
    const source = `variables:
  city: linked string
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      ask for @variables.city
        instructions: "Which city are you in?"
`;
    expect(codes(source, CODE)).toHaveLength(0);
  });

  it('does not warn when the target is not a declared variable', () => {
    const source = `subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      ask for @variables.city
        instructions: "Which city are you in?"
`;
    expect(codes(source, CODE)).toHaveLength(0);
  });
});

describe('collect-target-already-set: literal set earlier in the procedure', () => {
  const CODE = 'collect-target-already-set';

  describe('warns', () => {
    it('when the target is set to a literal just before the `ask for`', () => {
      const source = `variables:
  city: mutable string
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      set @variables.city = ""
      ask for @variables.city
        instructions: "Which city are you in?"
`;
      const [diag] = codes(source, CODE);
      expect(diag.severity).toBe(DiagnosticSeverity.Warning);
      expect(diag.message).toContain('\'city\' is set to a literal (`""`)');
    });

    it('when the `set` is outside the `if` that wraps the `ask for`', () => {
      const source = `variables:
  city: mutable string
  region: mutable string
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      set @variables.city = "unknown"
      if @variables.region == "eu":
        ask for @variables.city
          instructions: "Which city are you in?"
`;
      expect(codes(source, CODE)).toHaveLength(1);
    });

    it('even though the declared default is None', () => {
      const source = `variables:
  city: mutable string = None
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      set @variables.city = ""
      ask for @variables.city
        instructions: "Which city are you in?"
`;
      expect(codes(source, CODE)).toHaveLength(1);
    });

    it('once, not twice, when the default and the `set` are both literals', () => {
      const source = `variables:
  city: mutable string = ""
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      set @variables.city = "unknown"
      ask for @variables.city
        instructions: "Which city are you in?"
`;
      expect(codes(source, CODE)).toHaveLength(1);
    });
  });

  describe('does not warn', () => {
    it('when the target is set to None', () => {
      const source = `variables:
  city: mutable string
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      set @variables.city = None
      ask for @variables.city
        instructions: "Which city are you in?"
`;
      expect(codes(source, CODE)).toHaveLength(0);
    });

    it('when the target is set to another variable', () => {
      const source = `variables:
  city: mutable string
  region: mutable string
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      set @variables.city = @variables.region
      ask for @variables.city
        instructions: "Which city are you in?"
`;
      expect(codes(source, CODE)).toHaveLength(0);
    });

    it('when the target is reset to None after being set', () => {
      const source = `variables:
  city: mutable string
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      set @variables.city = ""
      set @variables.city = None
      ask for @variables.city
        instructions: "Which city are you in?"
`;
      expect(codes(source, CODE)).toHaveLength(0);
    });

    it('when a different variable is set', () => {
      const source = `variables:
  city: mutable string
  region: mutable string
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      set @variables.region = "eu"
      ask for @variables.city
        instructions: "Which city are you in?"
`;
      expect(codes(source, CODE)).toHaveLength(0);
    });

    it('when the `set` comes after the `ask for`', () => {
      const source = `variables:
  city: mutable string
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      ask for @variables.city
        instructions: "Which city are you in?"
      set @variables.city = ""
`;
      expect(codes(source, CODE)).toHaveLength(0);
    });

    it('when the `set` is in a different branch of the same `if`', () => {
      const source = `variables:
  city: mutable string
  region: mutable string
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      if @variables.region == "eu":
        set @variables.city = ""
      else:
        ask for @variables.city
          instructions: "Which city are you in?"
`;
      expect(codes(source, CODE)).toHaveLength(0);
    });

    it('when the `set` is inside an earlier `if` and may not have run', () => {
      const source = `variables:
  city: mutable string
  region: mutable string
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      if @variables.region == "eu":
        set @variables.city = ""
      ask for @variables.city
        instructions: "Which city are you in?"
`;
      expect(codes(source, CODE)).toHaveLength(0);
    });

    it('when an earlier `if` may have reset the target to None', () => {
      const source = `variables:
  city: mutable string
  region: mutable string
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      set @variables.city = ""
      if @variables.region == "eu":
        set @variables.city = None
      ask for @variables.city
        instructions: "Which city are you in?"
`;
      expect(codes(source, CODE)).toHaveLength(0);
    });

    it('when an earlier `else` may have reset the target to None', () => {
      const source = `variables:
  city: mutable string
  region: mutable string
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      set @variables.city = ""
      if @variables.region == "eu":
        set @variables.region = "fr"
      else:
        set @variables.city = None
      ask for @variables.city
        instructions: "Which city are you in?"
`;
      expect(codes(source, CODE)).toHaveLength(0);
    });

    it('when an action run rewrites the target in between', () => {
      const source = `variables:
  city: mutable string
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      set @variables.city = ""
      run @actions.lookup_city
        set @variables.city = @outputs.city
      ask for @variables.city
        instructions: "Which city are you in?"
`;
      expect(codes(source, CODE)).toHaveLength(0);
    });

    it('when a literal default is reset to None', () => {
      const source = `variables:
  city: mutable string = ""
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      set @variables.city = None
      ask for @variables.city
        instructions: "Which city are you in?"
`;
      expect(codes(source, CODE)).toHaveLength(0);
    });

    it('when a literal default is overwritten by another variable', () => {
      const source = `variables:
  city: mutable string = ""
  home_city: mutable string
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      set @variables.city = @variables.home_city
      ask for @variables.city
        instructions: "Which city are you in?"
`;
      expect(codes(source, CODE)).toHaveLength(0);
    });

    it('when an earlier `if` may have reset a literal default to None', () => {
      const source = `variables:
  city: mutable string = ""
  region: mutable string
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      if @variables.region == "eu":
        set @variables.city = None
      ask for @variables.city
        instructions: "Which city are you in?"
`;
      expect(codes(source, CODE)).toHaveLength(0);
    });
  });
});

describe('collect-condition-contradicts', () => {
  const CODE = 'collect-condition-contradicts';

  describe('warns when the condition is always false while the target is None', () => {
    it('for `X == ""`', () => {
      const source = `variables:
  city: mutable string
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      if @variables.city == "":
        ask for @variables.city
          instructions: "Which city are you in?"
`;
      expect(codes(source, CODE)).toHaveLength(1);
    });

    it('for `X == -1`', () => {
      const source = `variables:
  city: mutable number
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      if @variables.city == -1:
        ask for @variables.city
          instructions: "Which city are you in?"
`;
      expect(codes(source, CODE)).toHaveLength(1);
    });

    it('for a bare `X` (None is falsy)', () => {
      const source = `variables:
  city: mutable string
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      if @variables.city:
        ask for @variables.city
          instructions: "Which city are you in?"
`;
      expect(codes(source, CODE)).toHaveLength(1);
    });

    it('for `X is not None`', () => {
      const source = `variables:
  city: mutable string
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      if @variables.city is not None:
        ask for @variables.city
          instructions: "Which city are you in?"
`;
      expect(codes(source, CODE)).toHaveLength(1);
    });

    it('for `X == "" and Y == "a"` (one part is always false)', () => {
      const source = `variables:
  city: mutable string
  region: mutable string
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      if @variables.city == "" and @variables.region == "a":
        ask for @variables.city
          instructions: "Which city are you in?"
`;
      expect(codes(source, CODE)).toHaveLength(1);
    });

    it('for `X == "" or X == "n/a"` (every part is always false)', () => {
      const source = `variables:
  city: mutable string
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      if @variables.city == "" or @variables.city == "n/a":
        ask for @variables.city
          instructions: "Which city are you in?"
`;
      expect(codes(source, CODE)).toHaveLength(1);
    });

    it('as a warning that names the variable', () => {
      const source = `variables:
  city: mutable string
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      if @variables.city == "":
        ask for @variables.city
          instructions: "Which city are you in?"
`;
      const [diag] = codes(source, CODE);
      expect(diag.severity).toBe(DiagnosticSeverity.Warning);
      expect(diag.message).toContain("'city'");
    });
  });

  describe('does not warn when the condition can be true while the target is None', () => {
    it('for `X is None`', () => {
      const source = `variables:
  city: mutable string
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      if @variables.city is None:
        ask for @variables.city
          instructions: "Which city are you in?"
`;
      expect(codes(source, CODE)).toHaveLength(0);
    });

    it('for `X != ""`', () => {
      const source = `variables:
  city: mutable string
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      if @variables.city != "":
        ask for @variables.city
          instructions: "Which city are you in?"
`;
      expect(codes(source, CODE)).toHaveLength(0);
    });

    it('for `not X`', () => {
      const source = `variables:
  city: mutable string
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      if not @variables.city:
        ask for @variables.city
          instructions: "Which city are you in?"
`;
      expect(codes(source, CODE)).toHaveLength(0);
    });

    it('for `X == "" or Y == "a"` (the other variable may be true)', () => {
      const source = `variables:
  city: mutable string
  region: mutable string
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      if @variables.city == "" or @variables.region == "a":
        ask for @variables.city
          instructions: "Which city are you in?"
`;
      expect(codes(source, CODE)).toHaveLength(0);
    });

    it('for a condition on a different variable', () => {
      const source = `variables:
  city: mutable string
  region: mutable string
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      if @variables.region == "":
        ask for @variables.city
          instructions: "Which city are you in?"
`;
      expect(codes(source, CODE)).toHaveLength(0);
    });

    it('for X compared to another variable', () => {
      const source = `variables:
  city: mutable string
  region: mutable string
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      if @variables.city == @variables.region:
        ask for @variables.city
          instructions: "Which city are you in?"
`;
      expect(codes(source, CODE)).toHaveLength(0);
    });
  });

  it('does not warn for an `ask for` that is not inside an `if`', () => {
    const source = `variables:
  city: mutable string
subagent intake:
  description: "Gather a city."
  reasoning:
    instructions: ->
      ask for @variables.city
        instructions: "Which city are you in?"
`;
    expect(codes(source, CODE)).toHaveLength(0);
  });
});
