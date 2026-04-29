/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * @file AgentScriptAwl grammar for tree-sitter
 * @author Allen Li <allen@allen.li>
 * @license None
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

export default grammar({
  name: 'agentscript',

  word: $ => $.id,

  extras: $ => [
    $.comment,
    /[\s\f\uFEFF\u2060\u200B]|\r?\n/,
    $.line_continuation,
  ],

  externals: $ => [
    $._newline,
    $._indent,
    $._dedent,
    $.template_content,
    $._template_end,

    // Mark comments as external tokens so that the external scanner is always
    // invoked, even if no external token is expected. This allows for better
    // error recovery, because the external scanner can maintain the overall
    // structure by returning dedent tokens whenever a dedent occurs, even
    // if no dedent is expected.
    $.comment,

    $.error_sentinel,

    $._open_paren,
    $._close_paren,
  ],

  supertypes: $ => [
    $.colinear_value,
    $.block_value,
    $.simple_statement,
    $.compound_statement,
  ],

  inline: $ => [$._sequence_block_value_suite],

  conflicts: $ => [],

  rules: {
    source_file: $ =>
      choice($.mapping, $.sequence, $.assignment_expression, $.expression), // mapping/sequence for full scripts; param wrapped in runner; expression for expression snippets

    colinear_value: $ =>
      choice(
        $.template,
        $.variable_declaration,
        $.expression_with_to,
        $.assignment_expression
      ),

    block_value: $ => choice($.mapping, $.sequence, $.atom, $.empty_keyword),

    empty_keyword: $ => 'empty',

    variable_declaration: $ =>
      seq(
        choice('mutable', 'linked'),
        ' ',
        field('type', $.expression),
        optional(seq('=', field('default', $.expression)))
      ),

    assignment_expression: $ =>
      seq(field('left', $.expression), '=', field('right', $.expression)),

    template: $ =>
      seq(
        '|',
        repeat(choice($.template_content, $.template_expression)),
        $._template_end
      ),

    mapping: $ => repeat1($._mapping_item),

    _mapping_item: $ => choice($.mapping_element, $._statement),

    mapping_element: $ =>
      seq(
        field('key', $.key),
        ':',
        choice(
          seq(
            optional(field('colinear_value', $.colinear_value)),
            optional(
              seq($._indent, field('block_value', $.block_value), $._dedent)
            )
          ),
          seq('->', $._indent, field('block_value', $.procedure), $._dedent)
        ),
        $._newline
      ),

    sequence: $ => repeat1($.sequence_element),

    _sequence_element_colinear_mapping_element: $ =>
      seq(field('key', $.key), ':', field('colinear_value', $.colinear_value)),

    _sequence_block_value_suite: $ =>
      seq($._newline, $._indent, field('block_value', $.mapping), $._dedent),

    sequence_element: $ =>
      seq(
        choice(
          seq(
            '- ',
            choice(
              field('colinear_value', $.colinear_value),
              seq(
                field(
                  'colinear_mapping_element',
                  alias(
                    $._sequence_element_colinear_mapping_element,
                    $.mapping_element
                  )
                ),
                optional($._sequence_block_value_suite)
              ),
              $._sequence_block_value_suite
            )
          ),
          seq('-', optional($._sequence_block_value_suite))
        ),
        $._newline
      ),

    template_expression: $ => seq('{!', field('expression', $.expression), '}'),

    key: $ => seq($._name, optional(seq(token.immediate(' '), $._name))),

    _name: $ => choice($.id, $.string),

    id: $ => /[a-zA-Z_][a-zA-Z0-9_]*/,

    at_id: $ => seq('@', $.id),

    comment: _ => token(seq('#', /[^\r\n]*/)),

    line_continuation: _ =>
      token(seq('\\', choice(seq(optional('\r'), '\n'), '\0'))),

    // Procedures
    procedure: $ => repeat1($._statement),

    // All statements end in a newline.
    _statement: $ => choice($._simple_statements, $.compound_statement),

    _simple_statements: $ => seq($.simple_statement, $._newline),

    simple_statement: $ =>
      choice(
        $.template,
        $.transition_statement,
        $.with_statement,
        $.set_statement,
        $.run_statement,
        $.available_when_statement
      ),

    compound_statement: $ => choice($.if_statement, $.run_statement),

    if_statement: $ =>
      seq(
        'if',
        field('condition', $.expression),
        ':',
        $._indent,
        field('consequence', $.procedure),
        $._dedent,
        $._newline,
        repeat(field('alternative', $.elif_clause)),
        optional(field('alternative', $.else_clause))
      ),

    elif_clause: $ =>
      seq(
        'elif',
        field('condition', $.expression),
        ':',
        $._indent,
        field('consequence', $.procedure),
        $._dedent,
        $._newline
      ),

    else_clause: $ =>
      seq(
        'else',
        ':',
        $._indent,
        field('consequence', $.procedure),
        $._dedent,
        $._newline
      ),

    run_statement: $ =>
      seq(
        'run',
        field('target', $.expression),
        optional(seq($._indent, field('block_value', $.procedure), $._dedent)),
        $._newline
      ),

    expression_with_to: $ =>
      seq(
        field('expression', $.expression),
        optional(field('with_to_statement_list', $.with_to_statement_list))
      ),

    with_to_statement_list: $ =>
      commaSep1(choice($.with_statement, $.to_statement)),

    with_statement: $ =>
      prec.right(
        seq(
          'with',
          commaSep1(
            prec.right(
              seq(field('param', $._name), '=', field('value', $.expression))
            )
          )
        )
      ),

    set_statement: $ =>
      seq(
        'set',
        field('target', $.expression),
        '=',
        field('value', $.expression)
      ),

    to_statement: $ => seq('to', field('target', $.expression)),

    available_when_statement: $ =>
      seq('available when', field('condition', $.expression)),

    transition_statement: $ =>
      seq(
        'transition',
        optional(field('with_to_statement_list', $.with_to_statement_list))
      ),

    // Expressions

    expression: $ =>
      choice(
        $.ternary_expression,
        $.parenthesized_expression,
        $.binary_expression,
        $.comparison_expression,
        $.unary_expression,
        $.spread_expression,
        $.call_expression,
        $.member_expression,
        $.subscript_expression,
        $.atom
      ),

    call_expression: $ =>
      prec.left(
        8,
        seq(
          field('function', $.expression),
          $._open_paren,
          optional(commaSep1(field('argument', $.expression))),
          $._close_paren
        )
      ),

    // Python-style ternary: a if condition else b (lowest precedence, right-associative)
    ternary_expression: $ =>
      prec.right(
        0,
        seq(
          field('consequence', $.expression),
          'if',
          field('condition', $.expression),
          'else',
          field('alternative', $.expression)
        )
      ),

    parenthesized_expression: $ =>
      prec(9, seq('(', field('expression', $.expression), ')')),

    binary_expression: $ =>
      choice(
        prec.left(1, seq($.expression, 'or', $.expression)),
        prec.left(2, seq($.expression, 'and', $.expression)),
        prec.left(5, seq($.expression, '+', $.expression)),
        prec.left(5, seq($.expression, '-', $.expression)),
        prec.left(6, seq($.expression, '*', $.expression)),
        prec.left(6, seq($.expression, '/', $.expression))
      ),

    unary_expression: $ =>
      choice(
        prec(3, seq('not', $.expression)),
        prec(7, seq('+', $.expression)),
        prec(7, seq('-', $.expression))
      ),

    spread_expression: $ =>
      prec(7, seq('*', field('expression', $.expression))),

    comparison_expression: $ =>
      choice(
        prec.left(4, seq($.expression, '==', $.expression)),
        prec.left(4, seq($.expression, '!=', $.expression)),
        prec.left(4, seq($.expression, '<=', $.expression)),
        prec.left(4, seq($.expression, '>=', $.expression)),
        prec.left(4, seq($.expression, '<', $.expression)),
        prec.left(4, seq($.expression, '>', $.expression)),
        prec.left(4, seq($.expression, 'is not', $.expression)),
        prec.left(4, seq($.expression, 'is', $.expression))
      ),

    member_expression: $ => prec.left(8, seq($.expression, '.', $.id)),

    subscript_expression: $ =>
      prec.left(8, seq($.expression, '[', $.expression, ']')),

    atom: $ =>
      choice(
        'True',
        'False',
        'None',
        $.datetime_literal,
        $.number,
        $.id,
        $.at_id,
        $.string,
        $.list,
        $.dictionary,
        $.ellipsis
      ),

    ellipsis: $ => '...',

    // ISO 8601 date/datetime: 2025-09-04, 2025-09-04T12:01, 2025-09-04T12:01:59, 2025-09-04T12:01:59.123Z
    datetime_literal: _ =>
      token(/\d{4}-\d{2}-\d{2}(T\d{1,2}(:\d{2})?(:\d{2})?(\.\d+)?Z?)?/),

    list: $ => seq('[', optional(commaSep1($.expression)), ']'),

    dictionary: $ => seq('{', optional(commaSep1($.dictionary_pair)), '}'),

    dictionary_pair: $ =>
      seq(field('key', $.key), ':', field('value', $.expression)),

    number: $ => /\d+\.?\d*|\.\d+/,

    string: $ =>
      seq('"', repeat(choice($.string_content, $.escape_sequence)), '"'),

    string_content: $ => /[^"\\]+/,

    // Must match ESCAPE_TABLE in @agentscript/language (packages/language/src/core/string-escapes.ts)
    escape_sequence: $ => /\\["'\\nrt0]/,
  },
});

/**
 * Creates a rule to match one or more occurrences of `rule` separated by `sep`
 *
 * @param {RuleOrLiteral} rule
 *
 * @param {RuleOrLiteral} separator
 *
 * @returns {SeqRule}
 */
function sep1(rule, separator) {
  return seq(rule, repeat(seq(separator, rule)));
}

/**
 * Creates a rule to match one or more of the rules separated by a comma
 *
 * @param {RuleOrLiteral} rule
 *
 * @returns {SeqRule}
 */
function commaSep1(rule) {
  return sep1(rule, ',');
}
