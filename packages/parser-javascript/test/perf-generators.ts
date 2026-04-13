/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Synthetic input generators for parser-javascript performance benchmarks.
 *
 * Each function returns a string of AgentScript source code designed
 * to stress a specific parsing axis.
 */

// ---------------------------------------------------------------------------
// 1. File size scaling — flat key: value mappings
// ---------------------------------------------------------------------------

export function generateFlatMappings(count: number): string {
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    lines.push(`key_${i}: value_${i}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 2. Deep nesting — nested blocks with increasing indent
// ---------------------------------------------------------------------------

export function generateDeepNesting(depth: number): string {
  const lines: string[] = [];
  for (let i = 0; i < depth; i++) {
    const indent = '  '.repeat(i);
    lines.push(`${indent}level_${i}:`);
  }
  // Add a leaf value at the deepest level
  const deepIndent = '  '.repeat(depth);
  lines.push(`${deepIndent}leaf: true`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 3. Wide mappings — many sibling keys at the same level
// ---------------------------------------------------------------------------

export function generateWideMappings(count: number): string {
  // Wrap in a parent block so all keys are siblings
  const lines: string[] = ['parent:'];
  for (let i = 0; i < count; i++) {
    lines.push(`  field_${i}: ${i}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 4a. Chained binary expressions — a + b + c + ...
// ---------------------------------------------------------------------------

export function generateChainedExpression(terms: number): string {
  const parts: string[] = [];
  for (let i = 0; i < terms; i++) {
    parts.push(`x${i}`);
  }
  return `result: ${parts.join(' + ')}`;
}

// ---------------------------------------------------------------------------
// 4b. Deeply nested parenthesized expressions
// ---------------------------------------------------------------------------

export function generateNestedParens(depth: number): string {
  const open = '('.repeat(depth);
  const close = ')'.repeat(depth);
  return `result: ${open}1${close}`;
}

// ---------------------------------------------------------------------------
// 4c. Mixed precedence expressions
// ---------------------------------------------------------------------------

export function generateMixedPrecedence(terms: number): string {
  const ops = [' + ', ' * ', ' - ', ' / '];
  const parts: string[] = [];
  for (let i = 0; i < terms; i++) {
    if (i > 0) {
      parts.push(ops[i % ops.length]);
    }
    parts.push(`v${i}`);
  }
  return `result: ${parts.join('')}`;
}

// ---------------------------------------------------------------------------
// 5a. Large string literal
// ---------------------------------------------------------------------------

export function generateLargeString(length: number): string {
  const body = 'a'.repeat(length);
  return `value: "${body}"`;
}

// ---------------------------------------------------------------------------
// 5b. Strings with many escape sequences
// ---------------------------------------------------------------------------

export function generateEscapeHeavyStrings(count: number): string {
  const lines: string[] = [];
  const escapes = '\\n\\t\\r\\\\\\"\\/';
  for (let i = 0; i < count; i++) {
    // each string has several escape sequences
    lines.push(`str_${i}: "${escapes.repeat(10)}"`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 5c. Template literals with many interpolations
// ---------------------------------------------------------------------------

export function generateTemplateHeavy(interpolations: number): string {
  const parts: string[] = [];
  for (let i = 0; i < interpolations; i++) {
    parts.push(`word {! @var_${i} }`);
  }
  return `template: | ${parts.join(' ')}`;
}

// ---------------------------------------------------------------------------
// 6a. Error-heavy input — alternating valid/invalid lines
// ---------------------------------------------------------------------------

export function generateErrorHeavy(lines: number): string {
  const result: string[] = [];
  for (let i = 0; i < lines; i++) {
    if (i % 2 === 0) {
      result.push(`valid_${i}: "value"`);
    } else {
      result.push(`@@@ $$$ %%% ^^^`);
    }
  }
  return result.join('\n');
}

// ---------------------------------------------------------------------------
// 6b. Garbage input — random printable characters
// ---------------------------------------------------------------------------

export function generateGarbageInput(bytes: number): string {
  const chars =
    'abcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?/\n \t';
  const result: string[] = [];
  for (let i = 0; i < bytes; i++) {
    result.push(chars[i % chars.length]);
  }
  return result.join('');
}

// ---------------------------------------------------------------------------
// 6c. Unclosed delimiters at scale
// ---------------------------------------------------------------------------

export function generateUnclosedDelimiters(count: number): string {
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    // Each line has an unclosed paren or bracket
    lines.push(`val_${i}: (${i} + ${i}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 7. Large sequences
// ---------------------------------------------------------------------------

export function generateLargeSequence(items: number): string {
  const lines: string[] = [];
  for (let i = 0; i < items; i++) {
    lines.push(`- item_${i}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 8. Procedure-heavy input (if/run/set statements)
// ---------------------------------------------------------------------------

export function generateProcedureHeavy(count: number): string {
  const lines: string[] = ['actions: ->'];
  for (let i = 0; i < count; i++) {
    switch (i % 3) {
      case 0:
        lines.push(`  if @condition_${i} == true:`);
        lines.push(`    run @action_${i}`);
        break;
      case 1:
        lines.push(`  set @var_${i} = ${i}`);
        break;
      case 2:
        lines.push(`  run @tool_${i} with param = "value_${i}"`);
        break;
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// 9. Realistic agent file — mixed content
// ---------------------------------------------------------------------------

export function generateRealisticAgent(targetLines: number): string {
  const lines: string[] = [];
  let lineCount = 0;

  const addLine = (line: string) => {
    lines.push(line);
    lineCount++;
  };

  while (lineCount < targetLines) {
    // Metadata section
    addLine(`name: "Agent_${lineCount}"`);
    addLine(`description: "A test agent for performance benchmarking"`);
    addLine(`type: agent`);
    addLine('');

    // Variables section
    addLine('variables:');
    for (let v = 0; v < 5 && lineCount < targetLines; v++) {
      addLine(`  counter_${v}: mutable number = ${v}`);
    }
    addLine('');

    // Instructions with procedures
    addLine('instructions: ->');
    for (let s = 0; s < 10 && lineCount < targetLines; s++) {
      if (s % 4 === 0) {
        addLine(`  if @counter_${s % 5} > ${s}:`);
        addLine(`    run @some_action with value = ${s * 10}`);
        addLine(`    set @counter_${s % 5} = @counter_${s % 5} + 1`);
      } else if (s % 4 === 1) {
        addLine(
          `  run @external_tool_${s} with param1 = "hello" param2 = ${s}`
        );
      } else if (s % 4 === 2) {
        addLine(`  set @counter_${s % 5} = @counter_${s % 5} * 2 + 1`);
      } else {
        addLine(`  if @counter_0 == 0 or @counter_1 > 10:`);
        addLine(`    run @fallback_action`);
      }
    }
    addLine('');

    // Template section
    addLine(
      'greeting: | Hello {! @user_name }, you have {! @counter_0 } items.'
    );
    addLine('');

    // Sequence section
    addLine('steps:');
    for (let seq = 0; seq < 5 && lineCount < targetLines; seq++) {
      addLine(`  - step_${seq}`);
    }
    addLine('');
  }

  return lines.join('\n');
}
