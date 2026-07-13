#!/usr/bin/env node

/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Post-process generated zod schema files to use snake_case property names.
 *
 * The OpenAPI → zod generator outputs camelCase keys. This script transforms
 * property names inside z.object() calls to snake_case to match the AgentJSON
 * output format used by the Python compiler.
 *
 * Usage: node transform-snake-case.mjs <file.ts>
 *
 * ---
 *
 * Why this is scope-aware (do not "simplify" back to a bare per-line regex):
 *
 * A property only ever appears inside an object literal `z.object({ ... })`.
 * But since @hey-api/openapi-ts 0.99.0, discriminated unions are emitted as
 * bare schema references inside a `z.union([ ... ])` ARRAY, e.g.
 *
 *     z.union([
 *         action,
 *         handOffAction,   // <- a reference, NOT a property
 *     ])
 *
 * A context-free transform sees a 4-space-indented identifier and rewrites it
 * as if it were object shorthand:
 *
 *     handOffAction  ->  hand_off_action: handOffAction   // syntax error in an array!
 *
 * which produces `',' expected` parse errors. So we must know, for every line,
 * whether the enclosing bracket is `{` (object → transform) or `[`/`(` (array
 * or call → leave alone). We compute that by scanning the file once, tracking a
 * bracket stack while skipping over strings, comments, and regex literals (all
 * of which contain stray brackets: doc comments have `[` `]`, regexes have
 * `[A-Za-z]`, `(...)`, etc.).
 */

import { readFileSync, writeFileSync } from 'fs';

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node transform-snake-case.mjs <file.ts>');
  process.exit(1);
}

function camelToSnake(str) {
  return str.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/**
 * A `/` starts a regex literal (rather than division) when the previous
 * significant character is one that cannot end an expression. The generated
 * code only ever emits regexes as `.regex(/.../)`, so the preceding char is
 * `(`, but we keep the general heuristic to be safe.
 */
function isRegexStart(content, slashIndex) {
  let j = slashIndex - 1;
  while (j >= 0 && /\s/.test(content[j])) j--;
  if (j < 0) return true;
  return '([{,;:=&|!?+-*%<>~^'.includes(content[j]);
}

/**
 * Scan the whole file once and return, for each line index, the character of
 * the innermost open bracket (`{`, `[`, or `(`) at the start of that line — or
 * '' if the line is at top level. Strings, template literals, comments, and
 * regex literals are skipped so their brackets never affect the stack.
 */
function computeLineContexts(content) {
  const stack = [];
  const top = () => (stack.length ? stack[stack.length - 1] : '');

  const contexts = [top()]; // context at the start of line 0
  let state = 'normal'; // normal | line | block | sq | dq | tpl | regex | regexClass

  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    const c2 = content[i + 1];

    if (c === '\n') {
      if (state === 'line') state = 'normal'; // line comments end at newline
      contexts.push(top());
      continue;
    }

    switch (state) {
      case 'normal':
        if (c === '/' && c2 === '/') {
          state = 'line';
          i++;
        } else if (c === '/' && c2 === '*') {
          state = 'block';
          i++;
        } else if (c === "'") state = 'sq';
        else if (c === '"') state = 'dq';
        else if (c === '`') state = 'tpl';
        else if (c === '/' && isRegexStart(content, i)) state = 'regex';
        else if (c === '{' || c === '[' || c === '(') stack.push(c);
        else if (c === '}' || c === ']' || c === ')') stack.pop();
        break;
      case 'block':
        if (c === '*' && c2 === '/') {
          state = 'normal';
          i++;
        }
        break;
      case 'sq':
        if (c === '\\') i++;
        else if (c === "'") state = 'normal';
        break;
      case 'dq':
        if (c === '\\') i++;
        else if (c === '"') state = 'normal';
        break;
      case 'tpl':
        if (c === '\\') i++;
        else if (c === '`') state = 'normal';
        break;
      case 'regex':
        if (c === '\\') i++;
        else if (c === '[')
          state = 'regexClass'; // `/` inside a char class is literal
        else if (c === '/') state = 'normal';
        break;
      case 'regexClass':
        if (c === '\\') i++;
        else if (c === ']') state = 'regex';
        break;
      // 'line' consumes everything until the newline handled above
    }
  }

  return contexts;
}

const content = readFileSync(filePath, 'utf8');
const contexts = computeLineContexts(content);

// Match property definitions indented with exactly 4 spaces followed by an
// identifier. Two forms:
//   1. Explicit:  "    developerName: z.string()"  ->  "    developer_name: z.string()"
//   2. Shorthand: "    agentType,"                  ->  "    agent_type: agentType,"
// Continuation lines (8+ spaces) never match because position 5 is a space.
const propertyRe = /^(\s{4})([a-zA-Z]\w*)(\s*\??\s*:.+|[,]?\s*)$/;

const transformed = content
  .split('\n')
  .map((line, index) => {
    // Only rewrite when the line sits directly inside an object literal.
    // Inside `z.union([ ... ])` (context '[') the identifiers are schema
    // references, not properties — leave them untouched.
    if (contexts[index] !== '{') return line;

    return line.replace(propertyRe, (_match, indent, name, rest) => {
      const snake = camelToSnake(name);
      const trimmed = rest.trim();

      // Explicit property — rename the key, keep the value.
      if (/^\??:/.test(trimmed)) {
        return `${indent}${snake}${rest}`;
      }

      // Shorthand property — expand to explicit `key: value`.
      if (trimmed === ',' || trimmed === '') {
        if (snake !== name) {
          return `${indent}${snake}: ${name}${trimmed}`;
        }
      }

      return `${indent}${snake}${rest}`;
    });
  })
  .join('\n');

writeFileSync(filePath, transformed);
console.log(`Transformed ${filePath} to snake_case property names.`);
