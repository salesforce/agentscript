#!/usr/bin/env node

/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { compile } from './packages/compiler/dist/index.js';
import { parse } from './packages/parser-javascript/dist/index.js';
import { Dialect } from './packages/language/dist/index.js';
import { AgentforceSchema } from './dialect/agentforce/dist/index.js';

const dialect = new Dialect();

const source = `
config:
    agent_name: "test"

modality voice:
    config:
        pronunciation_dict:
            - grapheme: "Eliquis"
              phoneme: "ɛlɪkwɪs"
              type: "IPA"
            - grapheme: "SQL"
              phoneme: "ɛs kju ɛl"
              type: "IPA"
            - grapheme: "API"
              phoneme: "eɪ pi aɪ"
              type: "IPA"

        outbound_filler_sentences:
            - waiting: ["Let me check that..."]
            - waiting: ["One moment please..."]

start_agent main:
    description: "test"
`;

console.log(
  '=== Testing Pronunciation Dict & Filler Sentences Extraction ===\n'
);

const { rootNode: root } = parse(source);
const mappingNode = root.namedChildren.find(n => n.type === 'mapping') ?? root;
const parseResult = dialect.parse(mappingNode, AgentforceSchema);
const compileResult = compile(parseResult.value);

if (compileResult.diagnostics.length > 0) {
  console.log(
    'Diagnostics:',
    compileResult.diagnostics
      .map(d => `${d.severity}: ${d.message}`)
      .join('\n  ')
  );
  process.exit(1);
}

const voice = compileResult.output.agent_version.modality_parameters.voice;

// Test pronunciation_dict
console.log('=== Pronunciation Dict ===');
const pronunciations = voice?.pronunciation_dict?.pronunciations || [];
console.log(
  `${pronunciations.length === 3 ? '✅' : '❌'} Count: ${pronunciations.length} (expected 3)`
);

if (pronunciations.length > 0) {
  console.log('Entries:');
  pronunciations.forEach((p, i) => {
    console.log(`  ${i + 1}. ${p.grapheme} → ${p.phoneme} (${p.type})`);
  });
}

// Test outbound_filler_sentences
console.log('\n=== Filler Sentences ===');
const fillers = voice?.outbound_filler_sentences || [];
console.log(
  `${fillers.length === 2 ? '✅' : '❌'} Count: ${fillers.length} (expected 2)`
);

if (fillers.length > 0) {
  console.log('Entries:');
  fillers.forEach((f, i) => {
    console.log(`  ${i + 1}. ${f.filler_sentences.waiting.join(', ')}`);
  });
}

const success = pronunciations.length === 3 && fillers.length === 2;
console.log(
  `\n${success ? '✅' : '❌'} ${success ? 'SUCCESS' : 'FAILURE'}: extractSequenceBlocks helper works correctly!`
);

if (!success) process.exit(1);
