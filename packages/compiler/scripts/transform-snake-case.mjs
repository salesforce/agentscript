#!/usr/bin/env node

/**
 * Post-process generated zod schema files to use snake_case property names.
 *
 * The OpenAPI → zod generator outputs camelCase keys. This script transforms
 * property names inside z.object() calls to snake_case to match the AgentJSON
 * output format used by the Python compiler.
 *
 * Usage: node transform-snake-case.mjs <file.ts>
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

const content = readFileSync(filePath, 'utf8');

// Match property definitions inside z.object() calls.
// These are lines indented with exactly 4 spaces followed by an identifier.
//
// Two forms:
//   1. Explicit:  "    developerName: z.string()"  →  "    developer_name: z.string()"
//   2. Shorthand: "    agentType,"                  →  "    agent_type: agentType,"
//
// Lines indented with 8+ spaces (continuation lines) are NOT matched
// because position 5 would be a space, not [a-zA-Z].
const transformed = content.replace(
  /^(\s{4})([a-zA-Z]\w*)(\s*\??\s*:.+|[,]?\s*)$/gm,
  (_match, indent, name, rest) => {
    const snake = camelToSnake(name);
    const trimmed = rest.trim();

    // Explicit property — rename the key, keep the value
    if (/^\??:/.test(trimmed)) {
      return `${indent}${snake}${rest}`;
    }

    // Shorthand property — expand to explicit key: value
    if (trimmed === ',' || trimmed === '') {
      if (snake !== name) {
        return `${indent}${snake}: ${name}${trimmed}`;
      }
    }

    return `${indent}${snake}${rest}`;
  }
);

writeFileSync(filePath, transformed);
console.log(`Transformed ${filePath} to snake_case property names.`);
