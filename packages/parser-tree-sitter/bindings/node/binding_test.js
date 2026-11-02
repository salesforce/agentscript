/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import assert from 'node:assert';
import { test } from 'node:test';
import Parser from 'tree-sitter';

test('can load grammar', async () => {
  const parser = new Parser();
  await assert.doesNotReject(async () => {
    const { default: language } = await import('./index.js');
    parser.setLanguage(language);
  });
});

test('parses say text and rejects unsupported payloads', async () => {
  const parser = new Parser();
  const { default: language } = await import('./index.js');
  parser.setLanguage(language);

  const valid = parser.parse(
    'say "Order {!@variables.order_id} has reason {!@variables.return_reason}."'
  );
  assert.equal(valid.rootNode.hasError, false);
  assert.equal(valid.rootNode.descendantsOfType('say_interpolation').length, 2);

  const query = new Parser.Query(language, language.HIGHLIGHTS_QUERY);
  const captures = query.captures(valid.rootNode);
  assert.equal(
    captures.some(
      capture => capture.name === 'keyword' && capture.node.text === 'say'
    ),
    true
  );
  assert.equal(
    captures.some(
      capture =>
        capture.name === 'punctuation.template' && capture.node.text === '{!'
    ),
    true
  );
  assert.equal(
    captures.some(
      capture =>
        capture.name === 'punctuation.template' && capture.node.text === '}'
    ),
    true
  );

  const multiline = parser.parse('say "hello\nworld"');
  assert.equal(multiline.rootNode.hasError, false);
  const multilineContent =
    multiline.rootNode.descendantsOfType('say_string_content');
  assert.deepEqual(
    multilineContent.map(node => ({
      text: node.text,
      start: node.startPosition,
      end: node.endPosition,
    })),
    [
      {
        text: 'hello\nworld',
        start: { row: 0, column: 5 },
        end: { row: 1, column: 5 },
      },
    ]
  );

  for (const source of [
    'say',
    'say | hello',
    'say 42',
    'say "{!@variables.x + 1}"',
    'say "{!@variables.x.value}"',
    'say "{!@variables.x"',
    'say "hello\\"',
  ]) {
    assert.equal(parser.parse(source).rootNode.hasError, true, source);
  }
});
