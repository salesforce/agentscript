/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

// Run with: npx tsx src/test.ts

import { parse } from '@agentscript/parser';
import { Dialect, AgentScriptSchema } from './index.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const testFilePath = path.resolve(
  __dirname,
  '../../../packages/test-scripts/scripts/matrix.agent'
);
const source = fs.readFileSync(testFilePath, 'utf-8');

console.log('=== Parsing AgentScript file ===\n');
console.log(`File: ${testFilePath}\n`);

const { rootNode: root } = parse(source);
console.log('Parse successful');
console.log(`Root node type: ${root.type}`);
console.log(`Children: ${root.namedChildren.length}`);

console.log(`\n=== Tree Structure ===`);
for (const child of root.namedChildren) {
  console.log(`  ${child.type}`);
  if (child.type === 'mapping') {
    console.log(`    Elements: ${child.namedChildren.length}`);
    for (const el of child.namedChildren.slice(0, 3)) {
      const keyNode = el.childForFieldName('key');
      const ids =
        keyNode?.namedChildren?.filter(
          (n: { type: string }) => n.type === 'id'
        ) ?? [];
      console.log(
        `      ${el.type}: key=[${ids.map((id: { text: string }) => id.text).join(', ')}]`
      );
    }
    if (child.namedChildren.length > 3) {
      console.log(`      ... and ${child.namedChildren.length - 3} more`);
    }
  }
}

// Use the mapping node, not the root
const mappingNode =
  root.namedChildren.find((n: { type: string }) => n.type === 'mapping') ??
  root;
const dialect = new Dialect();
const result = dialect.parse(mappingNode, AgentScriptSchema);

console.log('\n=== Parse Result ===\n');
console.log(`Diagnostics: ${result.diagnostics.length}`);
for (const diag of result.diagnostics) {
  console.log(
    `  - [${diag.severity}] ${diag.message} at ${diag.range.start.line}:${diag.range.start.character}`
  );
}

const value = result.value;
console.log('\n=== Parsed Structure ===\n');

if (value.system) {
  console.log('system:');
  const instructions = (value.system as Record<string, unknown>).instructions;
  const instrObj = instructions as Record<string, unknown> | undefined;
  console.log(
    `  instructions: [${instrObj?.__kind}] "${(instrObj?.value as string)?.slice(0, 50)}..."`
  );
}

if (value.config) {
  console.log('config:');
  const config = value.config as Record<string, { value: string }>;
  console.log(`  developer_name: "${config.developer_name?.value}"`);
  console.log(`  agent_label: "${config.agent_label?.value}"`);
}

if (value.topic instanceof Map) {
  console.log(`topics: ${value.topic.size} entries`);
  for (const [name, topic] of value.topic) {
    console.log(
      `  - ${name}: "${(topic as Record<string, { value: string }>).label?.value}"`
    );
  }
}

if (value.start_agent instanceof Map) {
  console.log(`start_agents: ${value.start_agent.size} entries`);
  for (const [name, agent] of value.start_agent) {
    console.log(
      `  - ${name}: "${(agent as Record<string, { value: string }>).label?.value}"`
    );
  }
}

console.log('\n=== Test Complete ===');
