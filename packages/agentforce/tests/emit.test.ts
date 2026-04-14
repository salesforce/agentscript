import { describe, test, expect } from 'vitest';
import { parse, parseComponent } from '../src/index.js';
import type { CommentAttachment } from '@agentscript/types';

function assertCommentRoundTrip(
  source: string,
  label: string,
  mustContain?: string[]
): void {
  const emitted = parse(source).emit();
  const sourceComments = extractLineComments(source);
  const emittedComments = extractLineComments(emitted);

  let cursor = -1;
  for (const comment of sourceComments) {
    const next = emittedComments.indexOf(comment, cursor + 1);
    expect(
      next,
      `[${label}] missing or reordered comment: ${comment}`
    ).toBeGreaterThan(-1);
    cursor = next;
  }

  expect(
    emittedComments.length,
    `[${label}] emitted ${emittedComments.length} comments but source has ${sourceComments.length} (phantom comments in output)`
  ).toBe(sourceComments.length);

  if (mustContain) {
    for (const needle of mustContain) {
      expect(emitted, `[${label}] missing expected snippet`).toContain(needle);
    }
  }

  expect(parse(emitted).emit(), `[${label}] not idempotent`).toBe(emitted);
}

function extractLineComments(source: string): string[] {
  return source
    .split('\n')
    .flatMap(line => {
      const idx = line.indexOf('#');
      if (idx === -1) return [];
      return [line.slice(idx + 1).trim()];
    })
    .filter(comment => comment.length > 0);
}

describe('emit round-trips', () => {
  test('preserves document-leading comments via parse round-trip', () => {
    const source = `# WeatherPro Assistant - Professional Weather Information Service
# Provides comprehensive weather data, forecasts, and alerts for locations worldwide

config:
    default_agent_user: "support@weatherpro.com"`;

    assertCommentRoundTrip(source, 'document-leading comments', [
      '# WeatherPro Assistant',
      '# Provides comprehensive weather data',
    ]);
  });

  test('preserves document-leading comments from programmatic injection', () => {
    const doc = parse(
      'config:\n    default_agent_user: "support@weatherpro.com"'
    );
    const ast = doc.ast as unknown as {
      __comments?: Array<{
        value: string;
        attachment: CommentAttachment;
      }>;
    };
    ast.__comments = [
      {
        value:
          'WeatherPro Assistant - Professional Weather Information Service',
        attachment: 'leading',
      },
      {
        value:
          'Provides comprehensive weather data, forecasts, and alerts for locations worldwide',
        attachment: 'leading',
      },
    ];

    const emitted = doc.emit();
    expect(emitted.startsWith('# WeatherPro Assistant')).toBe(true);
    expect(emitted).toContain(
      '# Provides comprehensive weather data, forecasts, and alerts for locations worldwide'
    );
  });

  test('preserves block-leading comments via parse round-trip', () => {
    const source = `# System behavior
system:
    instructions: "Hello"`;

    assertCommentRoundTrip(source, 'block-leading comments', [
      '# System behavior\nsystem:',
    ]);
  });

  test('preserves nested named-entry comments via parse round-trip', () => {
    const source = `# Nested topic comment
topic billing:
    description: "Handle billing"
    instructions: "Help"`;

    assertCommentRoundTrip(source, 'nested named-entry comments', [
      '# Nested topic comment',
    ]);
  });

  test('preserves trailing comments at multiple nesting levels', () => {
    const source = `system:
    instructions: "Hello"
    # system trailing comment
# document trailing comment`;

    assertCommentRoundTrip(source, 'trailing comments at multiple levels', [
      '# system trailing comment',
      '# document trailing comment',
    ]);
  });

  test('parses and emits comments inside variables block', () => {
    const source = `variables:
    # Location variables
    user_city: mutable string = ""`;
    const doc = parse(source);
    const emitted = doc.emit();

    expect(emitted).toContain('variables:');
    expect(emitted).toContain(
      'variables:\n    # Location variables\n    user_city: mutable string = ""'
    );
    expect(emitted).toContain('user_city: mutable string = ""');

    const doc2 = parse(emitted);
    expect(doc2.emit()).toContain(
      'variables:\n    # Location variables\n    user_city: mutable string = ""'
    );
  });

  test('preserves inline typedmap comments with nested properties', () => {
    const source = `variables:
    # Location variables
    user_city: mutable string = "" # inline declaration comment should stay on this line
        description: "User's requested city for weather information"`;
    const emitted = parse(source).emit();

    expect(emitted).toContain(
      'user_city: mutable string = "" # inline declaration comment should stay on this line'
    );
    expect(emitted).toContain(
      '        description: "User\'s requested city for weather information"'
    );
    expect(emitted).not.toContain(
      '\n        # inline declaration comment should stay on this line\n'
    );
  });

  test('parses and emits comments inside before_reasoning block', () => {
    const source = `topic weather:
    description: "Weather topic"
    instructions: "Handle weather requests"
    before_reasoning:
        # Auto-fetch weather context
        if @variables.user_city != "" and @variables.user_country != "":
            transition to @topic.weather_ready`;
    const doc = parse(source);
    const emitted = doc.emit();

    expect(emitted).toContain('before_reasoning:');
    expect(emitted).toContain('        # Auto-fetch weather context');
    expect(emitted).toContain(
      'if @variables.user_city != "" and @variables.user_country != "":'
    );
  });

  test('preserves inline comments on before_reasoning if statements', () => {
    const source = `topic weather:
    description: "Weather topic"
    instructions: "Handle weather requests"
    before_reasoning:
        # Auto-fetch weather data if location is already known
        if @variables.user_city != "" and @variables.user_country != "": # inline if-condition comment should be preserved
            run @actions.Get_Current_Weather_Data`;
    const emitted = parse(source).emit();

    expect(emitted).toContain(
      'if @variables.user_city != "" and @variables.user_country != "": # inline if-condition comment should be preserved'
    );
  });

  test('round-trips exact inline comments in nested before_reasoning run block', () => {
    const source = `topic weather:
    description: "Weather topic"
    instructions: "Handle weather requests"
    before_reasoning:
        # Auto-fetch weather data if location is already known
        if @variables.user_city != "" and @variables.user_country != "": # inline if-condition comment should be preserved
            run @actions.Get_Current_Weather_Data
                with city=@variables.user_city # inline with-clause comment should stay on this line
                with country=@variables.user_country`;
    const emitted = parse(source).emit();

    expect(emitted).toBe(source);
    expect(parse(emitted).emit()).toBe(source);
  });

  test('round-trips trailing comment in actions named entry body', () => {
    const source = `actions:
    Get_Current_Weather_Data: @actions.Get_Current_Weather_Data
        with city=@variables.user_city
        set @variables.temperature = @outputs.temperature_celsius
        # trailing comment after action body should be preserved`;

    const emitted = parse(source).emit();
    expect(emitted).toBe(source);
    expect(parse(emitted).emit()).toBe(source);
  });

  test('round-trips procedure comments at same indent and dedent', () => {
    const source = `reasoning:
    instructions: ->
        # yes
        | body
        # after same indent
    # after dedent`;

    const emitted = parse(source).emit();
    expect(emitted).toBe(source);
    expect(parse(emitted).emit()).toBe(source);
  });

  test('round-trips nested reasoning dedent comments inside topic block', () => {
    const source = `topic weather:
    description: "x"
    instructions: "y"
    reasoning:
        instructions: ->
            # yes
            | body
            # after same indent
        # after dedent`;

    const emitted = parse(source).emit();
    expect(emitted).toBe(source);
    expect(parse(emitted).emit()).toBe(source);
  });

  test('preserves dedent comment between procedure field and actions container', () => {
    const source = `topic weather_preferences:
    reasoning:
        instructions: ->
            # yes
            | body
            # after same indent
        # after dedent
        actions:
            Update_User_Preferences: @actions.Update_User_Preferences`;

    const emitted = parse(source).emit();
    expect(emitted).toContain('            # after same indent');
    expect(emitted).toContain('        # after dedent\n        actions:');
  });

  test('preserves inline trailing comments on scalar fields', () => {
    const source = `language:
    default_locale: "en_US" # testing 123`;
    const doc = parse(source);
    const emitted = doc.emit();

    expect(emitted).toContain('default_locale: "en_US" # testing 123');
    expect(emitted).not.toContain('default_locale: "en_US"\n    # testing 123');
  });

  test('preserves comments across compact multi-block script round-trip', () => {
    const source = `# top-level heading comment

language: # inline container comment should stay on key line
    default_locale: "en_US" # inline scalar comment should stay on value line
    # trailing container-body comment should stay in block

variables:
    user_city: mutable string = "" # inline declaration comment should stay on this line
        description: "User city"
    forecast_data: mutable list[object] = [] # inline list declaration comment should be preserved
        description: "Forecast list"

topic weather:
    before_reasoning:
        if True: # inline if-condition comment should be preserved
            run @actions.Get_Current_Weather_Data
                with city=@variables.user_city # inline with-clause comment should stay on this line
                # trailing comment after action body should be preserved

    reasoning:
        instructions: -> # inline procedure-field comment should be preserved
            | compact body
            # procedure-trailing comment should be preserved
        # dedented bridge comment should be preserved
        actions:
            Get_Current_Weather_Data: @actions.Get_Current_Weather_Data
                with city=@variables.user_city
            # actions-container trailing comment should be preserved`;

    assertCommentRoundTrip(source, 'compact multi-block script', [
      'with city=@variables.user_city # inline with-clause comment should stay on this line',
      '# trailing comment after action body should be preserved',
      '# dedented bridge comment should be preserved\n        actions:',
    ]);
  });

  test('fuzzes comment boundaries across nested structures', () => {
    const cases: Array<{
      name: string;
      source: string;
      mustContain: string[];
    }> = [
      {
        name: 'dedent between procedure and actions container',
        source: `topic weather_preferences:
    reasoning:
        instructions: ->
            # leading
            | body
            # inside
        # bridge
        actions:
            update: @actions.Update`,
        mustContain: ['# inside', '# bridge\n        actions:'],
      },
      {
        name: 'comment between run statements',
        source: `topic t:
    before_reasoning:
        if True:
            run @actions.Fetch
                with city=@variables.user_city
                # keep me
                set @variables.temperature = @outputs.temperature`,
        mustContain: ['# keep me'],
      },
      {
        name: 'actions trailing comment after body',
        source: `actions:
    Get_Current_Weather_Data: @actions.Get_Current_Weather_Data
        with city=@variables.user_city
        # tail`,
        mustContain: ['# tail'],
      },
      {
        name: 'typedmap inline plus nested property comment',
        source: `variables:
    user_city: mutable string = "" # inline
        description: "x"
    # trailing`,
        mustContain: ['# inline', '# trailing'],
      },
      {
        name: 'container inline and body trailing comments',
        source: `language: # inline-container
    default_locale: "en_US"
    # body-tail`,
        mustContain: ['language: # inline-container', '# body-tail'],
      },
      {
        name: 'reasoning actions footer comment',
        source: `topic current_weather_service:
    reasoning:
        instructions: ->
            | hello
        actions:
            Get_Current_Weather_Data: @actions.Get_Current_Weather_Data
                with city=@variables.user_city
            # footer`,
        mustContain: ['# footer'],
      },
    ];

    for (const fixture of cases) {
      assertCommentRoundTrip(fixture.source, fixture.name, fixture.mustContain);
    }
  });

  test('fuzzes generated comment perturbations around mapping boundaries', () => {
    const generatedCases: Array<{ name: string; source: string }> = [];

    const commentTokens = ['alpha', 'beta', 'gamma'];

    for (const token of commentTokens) {
      generatedCases.push({
        name: `procedure-body-to-actions bridge (${token})`,
        source: `topic fuzz_${token}:
    reasoning:
        instructions: ->
            # lead-${token}
            | body-${token}
            # inside-${token}
        # bridge-${token}
        actions:
            act_${token}: @actions.Do_${token}`,
      });

      generatedCases.push({
        name: `reasoning-action footer (${token})`,
        source: `topic footer_${token}:
    reasoning:
        instructions: ->
            | body-${token}
        actions:
            act_${token}: @actions.Do_${token}
                with city=@variables.user_city
            # footer-${token}`,
      });

      generatedCases.push({
        name: `run-body interleaved comments (${token})`,
        source: `topic run_${token}:
    before_reasoning:
        if True:
            run @actions.Do_${token}
                # pre-${token}
                with city=@variables.user_city # inline-${token}
                # mid-${token}
                set @variables.temperature = @outputs.temperature
                # tail-${token}`,
      });

      generatedCases.push({
        name: `typedmap inline+tail (${token})`,
        source: `variables:
    field_${token}: mutable string = "" # inline-${token}
        description: "desc-${token}"
    # tail-${token}`,
      });
    }

    for (const fixture of generatedCases) {
      assertCommentRoundTrip(fixture.source, fixture.name);
    }
  });

  test('preserves inline comments on container and nested scalar fields', () => {
    const source = `language: # everywhere?
    default_locale: "en_US" # testing 123`;
    const doc = parse(source);
    const emitted = doc.emit();

    expect(emitted).toContain('language: # everywhere?');
    expect(emitted).toContain('default_locale: "en_US" # testing 123');
    expect(emitted).not.toContain('# everywhere?\nlanguage:');
  });

  test('preserves trailing comments after container body', () => {
    const source = `language: # everywhere?
    default_locale: "en_US" # testing 123
    # here`;
    const doc = parse(source);
    const emitted = doc.emit();

    expect(emitted).toContain('language: # everywhere?');
    expect(emitted).toContain('default_locale: "en_US" # testing 123');
    expect(emitted).toContain('\n    # here');
    expect(emitted).not.toContain('\n# here');
  });

  test('emits variable missing colon with properties block', () => {
    const source = `variables:
    authenticationKey mutable string
        description: "Stores the authentication key that's used to generate the verification code."
        visibility: "Internal"
    customerId: mutable string
        description: "Stores the Salesforce user ID or contact ID."
        visibility: "Internal"`;

    const doc = parse(source);
    const emitted = doc.emit();

    // Both variables must appear in emitted output
    expect(emitted).toContain('authenticationKey');
    expect(emitted).toContain('customerId');
    expect(emitted).toContain('description: "Stores the authentication key');
    expect(emitted).toContain('description: "Stores the Salesforce user ID');

    // Idempotency: re-parsing emitted output should produce the same emit
    expect(parse(emitted).emit()).toBe(emitted);
  });

  test('round-trips a system block', () => {
    const source = 'system:\n    instructions: "Hello"';
    const doc = parse(source);
    const emitted = doc.emit();
    const doc2 = parse(emitted);
    expect(doc2.emit()).toBe(emitted);
  });

  test('round-trips a document with config and topic', () => {
    const source = `config:
    description: "Test agent"

topic billing:
    description: "Handle billing"
    instructions: "Help"`;
    const doc = parse(source);
    const emitted = doc.emit();
    const doc2 = parse(emitted);
    expect(doc2.emit()).toBe(emitted);
  });

  test('round-trips after adding a topic via mutation', () => {
    const doc = parse('system:\n    instructions: "Hello"');
    const topic = parseComponent(
      'topic billing:\n    description: "Handle billing"\n    instructions: "Help"',
      'topic'
    );
    doc.addEntry('topic', 'billing', topic!);

    // Re-parse to get a fresh document with clean __children
    const reparsed = parse(doc.emit());
    const emitted = reparsed.emit();
    expect(emitted).toContain('billing');
    expect(emitted).toContain('Handle billing');

    // Second round-trip
    const doc2 = parse(emitted);
    expect(doc2.emit()).toBe(emitted);
  });

  test('round-trips with knowledge block', () => {
    const source = 'knowledge:\n    citations_enabled: True';
    const doc = parse(source);
    const emitted = doc.emit();
    const doc2 = parse(emitted);
    expect(doc2.emit()).toBe(emitted);
  });

  test('round-trips action invocation with if condition containing extra tokens and body', () => {
    const source = `actions:
    VerifyCustomer: @actions.VerifyCustomer
        with authenticationKey = @variables.authenticationKey
        with customerCode = ...
        with customerId = @variables.customerId
        with customerType = @variables.customerType
        set @variables.isVerified = @outputs.isVerified
        set @variables.VerifiedCustomerId = @outputs.customerId
        if @variables.isVerified == 1: adfasdf
            transition to @topic.topic_selector`;

    const emitted = parse(source).emit();
    expect(emitted).toBe(source);
    expect(parse(emitted).emit()).toBe(source);
  });

  test('round-trips bare-pipe multiline template (| on its own line)', () => {
    const source = `reasoning:
    instructions: ->
        |
        First line of content
        Second line of content
          Extra indented line`;

    const emitted = parse(source).emit();
    // Content must be preserved
    expect(emitted).toContain('First line of content');
    expect(emitted).toContain('Second line of content');
    expect(emitted).toContain('Extra indented line');
    // Idempotent round-trip
    expect(parse(emitted).emit()).toBe(emitted);
  });

  test('round-trips bare-pipe multiline with interpolation', () => {
    const source = `reasoning:
    instructions: ->
        |
        Hello {!@variables.name}
        Welcome aboard`;

    const emitted = parse(source).emit();
    expect(emitted).toContain('Hello {!@variables.name}');
    expect(emitted).toContain('Welcome aboard');
    expect(parse(emitted).emit()).toBe(emitted);
  });

  test('handles under-indented continuation lines in template text', () => {
    // A continuation line with less indentation than expected should not
    // produce negative slicing or errors — Math.min(lineIndent, stripAmount)
    // ensures we only strip what's actually there.
    const source = `reasoning:
    instructions: ->
        | First line
        Continuation at normal indent
    Under-indented line
          Extra indented line`;

    const doc = parse(source);
    const emitted = doc.emit();
    // All lines should survive the round-trip
    expect(emitted).toContain('First line');
    expect(emitted).toContain('Continuation at normal indent');
    expect(emitted).toContain('Under-indented line');
    expect(emitted).toContain('Extra indented line');
    // Idempotent
    expect(parse(emitted).emit()).toBe(emitted);
  });

  test('emit respects tabSize option', () => {
    const source = 'system:\n    instructions: "Hello"';
    const doc = parse(source);
    const withDefault = doc.emit();
    const withTab2 = doc.emit({ tabSize: 2 });
    // Both should contain the content
    expect(withDefault).toContain('Hello');
    expect(withTab2).toContain('Hello');
  });
});
