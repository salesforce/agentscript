/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Robustness tests: the parser must NEVER crash, must always recover,
 * and must preserve all source text in the CST output.
 *
 * Every byte of the source must appear somewhere in the CST.
 * Errors become ERROR nodes, not crashes.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parse } from '../src/index.js';
import type { CSTNode } from '../src/cst-node.js';

/** Check that the parser doesn't crash and returns a valid tree. */
function assertParses(source: string, label: string) {
  let rootNode: CSTNode;
  try {
    const result = parse(source);
    rootNode = result.rootNode;
  } catch (e) {
    throw new Error(`Parser CRASHED on "${label}": ${e}`);
  }
  expect(rootNode).toBeDefined();
  expect(rootNode.type).toBe('source_file');
  return rootNode;
}

/** Verify that the CST spans the entire source (no bytes lost). */
function assertSourcePreserved(
  source: string,
  rootNode: CSTNode,
  _label: string
) {
  // The CST root should span from the start to the end of the source.
  // We check that the root's text covers the source content.
  // (This is a structural check, not a byte-exact check — whitespace
  // at start/end may be trimmed by the parser.)
  const cstText = rootNode.text;

  // Every non-whitespace word in the source should appear in the CST text
  const words = source.match(/[a-zA-Z_@][a-zA-Z0-9_.]*/g) ?? [];
  for (const word of words) {
    expect(cstText).toContain(word);
  }
}

describe('robustness: parser never crashes', () => {
  // ── Missing delimiters ──
  const missingDelimiters = [
    ['unclosed string', 'key: "hello world'],
    ['unclosed string mid-line', 'key: "hello\nother: value'],
    ['unclosed paren', 'key: foo(bar'],
    ['unclosed bracket', 'key: [1, 2, 3'],
    ['unclosed brace', 'key: {a: 1, b: 2'],
    ['unclosed template expr', 'key: | hello {!@var'],
    ['extra close paren', 'key: foo())'],
    ['extra close bracket', 'key: [1, 2]]'],
    ['extra close brace', 'key: {a: 1}}'],
    ['mismatched delimiters', 'key: [1, 2)'],
  ];

  for (const [label, source] of missingDelimiters) {
    it(`doesn't crash: ${label}`, () => {
      const root = assertParses(source!, label!);
      assertSourcePreserved(source!, root, label!);
    });
  }

  // ── Missing syntax ──
  const missingSyntax = [
    ['missing colon', 'key value'],
    ['missing colon before block', 'key\n  nested: value'],
    ['missing value after colon', 'key:'],
    ['missing value after colon with newline', 'key:\n'],
    ['missing condition after if', 'key: ->\n  if\n    run @action'],
    ['missing colon after if', 'key: ->\n  if @var.ready\n    run @action'],
    ['missing target after run', 'key: ->\n  run\n'],
    ['missing value after set', 'key: ->\n  set\n'],
    ['missing param after with', 'key: ->\n  run @action\n    with\n'],
    ['missing equals in with', 'key: ->\n  run @action\n    with param\n'],
    ['missing value in set', 'key: ->\n  set @var.x =\n'],
    ['empty arrow body', 'key: ->\n'],
    ['arrow without block', 'key: ->'],
    ['missing colon before arrow', 'key ->\n  | test\n'],
    [
      'missing colon before at-expression',
      'key @actions.Test\n  with param=...\n',
    ],
    ['transition without target', 'key: ->\n  transition to\n'],
    ['double modifier', 'var: mutable linked string'],
    ['available without when', 'key: ->\n  available @var\n'],
  ];

  for (const [label, source] of missingSyntax) {
    it(`doesn't crash: ${label}`, () => {
      const root = assertParses(source!, label!);
      assertSourcePreserved(source!, root, label!);
    });
  }

  // ── Invalid syntax ──
  const invalidSyntax = [
    ['standalone else', 'key: value\nelse:\n  other: thing'],
    ['for loop (unsupported)', 'key: ->\n  for x in list:\n    run @action'],
    ['single equals in if', 'key: ->\n  if @var = True:\n    run @action'],
    ['double equals in set', 'key: ->\n  set @var == "value"'],
    ['single quoted string', "key: 'hello world'"],
    ['backtick string', 'key: `hello world`'],
    ['three word key', 'one two three: value'],
    ['hyphenated key', 'my-key: value'],
    ['digit-starting identifier', '123abc: value'],
    ['modulo operator', 'key: 10 % 3'],
    ['power operator', 'key: 2 ** 8'],
    ['semicolon', 'key: value; other: thing'],
    ['tab characters', 'key:\n\tvalue: 123'],
    ['unicode identifier', 'clé: valeur'],
    ['keyword as key', 'if: True\nrun: False\nset: None'],
    ['nested keywords as keys', 'config:\n  if: True\n  run: False'],
  ];

  for (const [label, source] of invalidSyntax) {
    it(`doesn't crash: ${label}`, () => {
      const root = assertParses(source!, label!);
      assertSourcePreserved(source!, root, label!);
    });
  }

  // ── Edge cases ──
  const edgeCases = [
    ['empty input', ''],
    ['only whitespace', '   \n  \n   '],
    ['only newlines', '\n\n\n'],
    ['only comment', '# just a comment'],
    ['multiple comments', '# one\n# two\n# three'],
    [
      'deep nesting',
      'a:\n  b:\n    c:\n      d:\n        e:\n          f: "deep"',
    ],
    ['very long line', `key: "${'x'.repeat(10000)}"`],
    [
      'many keys',
      Array.from({ length: 100 }, (_, i) => `key${i}: ${i}`).join('\n'),
    ],
    ['mixed indent styles', 'key:\n  a: 1\n\tb: 2\n    c: 3'],
    ['trailing whitespace', 'key: value   \n'],
    ['CRLF line endings', 'key: value\r\nother: thing\r\n'],
    ['null byte', 'key: val\x00ue'],
    ['BOM', '\uFEFFkey: value'],
    ['line continuation', 'key: 1 + \\\n  2 + 3'],
    ['bare dash sequence', '- \n- \n- '],
    ['nested sequence', 'list:\n  - a: 1\n  - b: 2'],
    ['expression as root', '1 + 2 * 3'],
    ['assignment as root', 'x = 42'],
    ['at_id as root', '@variable.name'],
    ['template at root level', 'key: | hello world'],
    ['template with many expressions', 'key: | {!a} {!b} {!c} {!d}'],
    ['multiline template', 'key: |\n  line one\n  line two\n  line three'],
    [
      'comment in every position',
      '# before\nkey: value # inline\n# between\nother: thing\n# after',
    ],
    ['completely garbage', '!@#$%^&*()_+{}|:"<>?'],
    ['emoji', 'key: "hello 🌍"'],
    ['only operators', '+ - * / = == != < > <= >='],
    [
      'if-elif-else chain',
      'x: ->\n  if a:\n    run @a\n  elif b:\n    run @b\n  elif c:\n    run @c\n  else:\n    run @d',
    ],
    [
      'run with deep with/set',
      'x: ->\n  run @action\n    with a=1\n    with b=2\n    set @x.y = @result.z\n    set @x.w = @result.v',
    ],
    ['available when', 'x: ->\n  run @action\n    available when @var.ready'],
    ['ternary expression', 'key: "yes" if @var.ready else "no"'],
    ['chained member access', 'key: @a.b.c.d.e.f.g'],
    ['list with nested lists', 'key: [[1, 2], [3, 4], [5, 6]]'],
    ['dict literal', 'key: {a: 1, b: "two", c: True}'],
    ['datetime literal', 'key: 2025-09-04T12:01:59.123Z'],
  ];

  for (const [label, source] of edgeCases) {
    it(`doesn't crash: ${label}`, () => {
      assertParses(source!, label!);
    });
  }
});

describe('robustness: error_recovery corpus tests never crash', () => {
  // Parse every error_recovery.txt test case and verify no crash
  const errorRecoveryFile = join(__dirname, 'corpus', 'error_recovery.txt');

  const testCases: { name: string; input: string }[] = [];
  try {
    const content = readFileSync(errorRecoveryFile, 'utf-8');
    const lines = content.split('\n');
    let i = 0;
    while (i < lines.length) {
      if (!lines[i]!.startsWith('====')) {
        i++;
        continue;
      }
      i++; // skip separator
      const name = lines[i]!.trim();
      i++;
      while (i < lines.length && lines[i]!.startsWith('====')) i++;
      const inputLines: string[] = [];
      while (i < lines.length && lines[i] !== '---') {
        inputLines.push(lines[i]!);
        i++;
      }
      i++; // skip ---
      while (i < lines.length && !lines[i]!.startsWith('====')) i++;
      while (inputLines.length > 0 && inputLines[0]!.trim() === '')
        inputLines.shift();
      while (
        inputLines.length > 0 &&
        inputLines[inputLines.length - 1]!.trim() === ''
      )
        inputLines.pop();
      testCases.push({ name, input: inputLines.join('\n') });
    }
  } catch {
    /* file might not exist in CI */
  }

  for (const tc of testCases) {
    it(`doesn't crash: ${tc.name}`, () => {
      assertParses(tc.input, tc.name);
    });
  }
});

describe('robustness: SOT file mutations', () => {
  const sotFile = join(__dirname, '../sot/source.agent');
  let sotSource = '';
  try {
    sotSource = readFileSync(sotFile, 'utf-8');
  } catch {
    /* */
  }

  it('handles SOT file with every line deleted one at a time', () => {
    if (!sotSource) return;
    const lines = sotSource.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const mutated = [...lines.slice(0, i), ...lines.slice(i + 1)].join('\n');
      try {
        parse(mutated);
      } catch (e) {
        throw new Error(
          `Parser crashed deleting line ${i + 1} ("${lines[i]!.slice(0, 40)}"): ${e}`
        );
      }
    }
  });

  it('handles SOT file with random lines duplicated', () => {
    if (!sotSource) return;
    const lines = sotSource.split('\n');
    for (let i = 0; i < lines.length; i += 10) {
      // every 10th line
      const mutated = [
        ...lines.slice(0, i),
        lines[i]!,
        lines[i]!,
        ...lines.slice(i + 1),
      ].join('\n');
      try {
        parse(mutated);
      } catch (e) {
        throw new Error(`Parser crashed duplicating line ${i + 1}: ${e}`);
      }
    }
  });
});

describe('robustness: real-world error patterns', () => {
  it('handles incomplete document being typed', () => {
    // Simulate someone typing a document character by character
    const fullDoc = `topic test:
   description: "A test topic"
   reasoning:
      instructions: ->
         if @variables.ready:
            run @actions.do_thing
               with param=@variables.value
               set @variables.result = @result.output
         | Template with {!@variables.name} here`;

    // Try every prefix
    for (let i = 0; i < fullDoc.length; i++) {
      const prefix = fullDoc.slice(0, i);
      try {
        parse(prefix);
      } catch (e) {
        throw new Error(
          `Parser crashed at position ${i} (char '${fullDoc[i]}'): ${e}\nPrefix: "${prefix.slice(-30)}"`
        );
      }
    }
  });

  it('handles random character deletion', () => {
    const doc = `system:
   instructions: "Hello world"
config:
   name: "test"
variables:
   x: mutable string = "value"`;

    for (let i = 0; i < doc.length; i++) {
      const mutated = doc.slice(0, i) + doc.slice(i + 1);
      try {
        parse(mutated);
      } catch (e) {
        throw new Error(
          `Parser crashed with char ${i} deleted ('${doc[i]}'): ${e}`
        );
      }
    }
  });

  it('handles random character insertion', () => {
    const doc = `key: "value"\nother: 123`;
    const insertChars = [
      '"',
      ':',
      '\n',
      '{',
      '}',
      '(',
      ')',
      '[',
      ']',
      '@',
      '#',
      '|',
      '-',
      '\\',
      ' ',
    ];

    for (let i = 0; i <= doc.length; i++) {
      for (const ch of insertChars) {
        const mutated = doc.slice(0, i) + ch + doc.slice(i);
        try {
          parse(mutated);
        } catch (e) {
          throw new Error(
            `Parser crashed inserting '${ch}' at pos ${i}: ${e}\nMutated: "${mutated.slice(Math.max(0, i - 10), i + 10)}"`
          );
        }
      }
    }
  });
});

// ── Helpers for structured recovery assertions ──

/** Recursively find all named nodes of a given type. */
function findNodes(node: CSTNode, type: string): CSTNode[] {
  const results: CSTNode[] = [];
  if (node.type === type) results.push(node);
  for (const child of node.children) {
    if (child.isNamed) results.push(...findNodes(child, type));
  }
  return results;
}

/** Find the first mapping_element whose key text matches. */
function findMappingElement(
  root: CSTNode,
  keyText: string
): CSTNode | undefined {
  const elements = findNodes(root, 'mapping_element');
  return elements.find(el => {
    const key = el.children.find(c => c.type === 'key');
    return key?.text?.trim() === keyText;
  });
}

describe('robustness: block value error recovery', () => {
  it('recovers from unquoted multi-word text in block value — sibling parses', () => {
    const source = `system:
    messages:
        welcome:
            Hi, I'm an AI service assistant. How can I help you?
        error: "Sorry, it looks like something has gone wrong."`;

    const root = assertParses(source, 'unquoted multi-word block');
    assertSourcePreserved(source, root, 'unquoted multi-word block');

    // welcome: should have an ERROR child (the unquoted text)
    const welcome = findMappingElement(root, 'welcome');
    expect(welcome).toBeDefined();
    const welcomeErrors = findNodes(welcome!, 'ERROR');
    expect(welcomeErrors.length).toBeGreaterThan(0);

    // error: should parse correctly as a sibling
    const error = findMappingElement(root, 'error');
    expect(error).toBeDefined();
    const errorErrors = findNodes(error!, 'ERROR');
    expect(errorErrors.length).toBe(0);
  });

  it('recovers from unquoted multi-word text — downstream blocks parse', () => {
    const source = `system:
    instructions: "You are an AI Agent."

    messages:
        welcome:
            Hi, I'm an AI service assistant. How can I help you?
        error: "Sorry, it looks like something has gone wrong."

config:
    agent_label: "test_agent_1"`;

    const root = assertParses(source, 'unquoted text with downstream');
    assertSourcePreserved(source, root, 'unquoted text with downstream');

    // config: should parse correctly despite earlier error
    const config = findMappingElement(root, 'config');
    expect(config).toBeDefined();
    const configErrors = findNodes(config!, 'ERROR');
    expect(configErrors.length).toBe(0);

    // agent_label should be accessible
    const agentLabel = findMappingElement(root, 'agent_label');
    expect(agentLabel).toBeDefined();
  });

  it('recovers from unquoted text with special characters', () => {
    const source = `system:
    messages:
        greeting:
            Hello! How are you doing today? I'd love to help.
        farewell: "Goodbye!"`;

    const root = assertParses(source, 'unquoted with special chars');

    const greeting = findMappingElement(root, 'greeting');
    expect(greeting).toBeDefined();
    const greetingErrors = findNodes(greeting!, 'ERROR');
    expect(greetingErrors.length).toBeGreaterThan(0);

    // farewell should still parse fine
    const farewell = findMappingElement(root, 'farewell');
    expect(farewell).toBeDefined();
    const farewellErrors = findNodes(farewell!, 'ERROR');
    expect(farewellErrors.length).toBe(0);
  });

  it('recovers from multiple unquoted block values', () => {
    const source = `messages:
    welcome:
        Hi there, how can I help?
    error:
        Oops, something went wrong!
    goodbye: "See you later"`;

    const root = assertParses(source, 'multiple unquoted blocks');

    // Both welcome and error should have errors
    const welcome = findMappingElement(root, 'welcome');
    expect(welcome).toBeDefined();
    expect(findNodes(welcome!, 'ERROR').length).toBeGreaterThan(0);

    const error = findMappingElement(root, 'error');
    expect(error).toBeDefined();
    expect(findNodes(error!, 'ERROR').length).toBeGreaterThan(0);

    // goodbye should parse correctly
    const goodbye = findMappingElement(root, 'goodbye');
    expect(goodbye).toBeDefined();
    expect(findNodes(goodbye!, 'ERROR').length).toBe(0);
  });

  it('recovers from unquoted text followed by valid nested mapping', () => {
    const source = `system:
    bad_field:
        This is not valid syntax at all!
    config:
        nested_key: "valid value"
        other_key: 42`;

    const root = assertParses(source, 'unquoted then nested mapping');

    const nestedKey = findMappingElement(root, 'nested_key');
    expect(nestedKey).toBeDefined();
    expect(findNodes(nestedKey!, 'ERROR').length).toBe(0);

    const otherKey = findMappingElement(root, 'other_key');
    expect(otherKey).toBeDefined();
    expect(findNodes(otherKey!, 'ERROR').length).toBe(0);
  });

  it('indented to-clause continuation produces same CST as single-line form', () => {
    const multiLine = `topic orders:
      reasoning:
          actions:
              go_to_returns: @utils.transition
                  to @topic.returns`;

    const singleLine = `topic orders:
      reasoning:
          actions:
              go_to_returns: @utils.transition to @topic.returns`;

    const multiRoot = assertParses(multiLine, 'multi-line to continuation');
    assertSourcePreserved(multiLine, multiRoot, 'multi-line to continuation');

    const singleRoot = assertParses(singleLine, 'single-line to clause');
    assertSourcePreserved(singleLine, singleRoot, 'single-line to clause');

    // Both forms must produce identical CST structure (s-expressions)
    expect(multiRoot.toSExp()).toBe(singleRoot.toSExp());

    // No ERROR nodes in either form
    expect(findNodes(multiRoot, 'ERROR').length).toBe(0);
    expect(findNodes(singleRoot, 'ERROR').length).toBe(0);

    // The go_to_returns mapping_element should have a with_to_statement_list
    const goToReturns = findMappingElement(multiRoot, 'go_to_returns');
    expect(goToReturns).toBeDefined();
    const ewt = findNodes(goToReturns!, 'expression_with_to');
    expect(ewt.length).toBe(1);
    const withToList = findNodes(ewt[0], 'with_to_statement_list');
    expect(withToList.length).toBe(1);
    const toStmt = findNodes(withToList[0], 'to_statement');
    expect(toStmt.length).toBe(1);
  });
});
