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
        inbound_filler_words_detection: True
        inbound_keywords:
            keywords:
                - "urgent"
                - "help"
        voice_id: "test_voice_123"
        outbound_speed: 1.1
        outbound_style_exaggeration: 0.5
        outbound_stability: 0.75
        outbound_similarity: 0.8
        pronunciation_dict:
            - grapheme: "SQL"
              phoneme: "ɛs kju ɛl"
              type: "IPA"
        outbound_filler_sentences:
            - waiting: ["Message one"]
        additional_configs:
            speak_up_config:
                speak_up_first_wait_time_ms: 5000
                speak_up_follow_up_wait_time_ms: 3000
                speak_up_message: "Hello?"
            endpointing_config:
                max_wait_time_ms: 2000
            beepboop_config:
                max_wait_time_ms: 1500

start_agent main:
    description: "test"
`;

console.log('=== Testing Voice Field Annotations ===\n');

const { rootNode: root } = parse(source);
const mappingNode = root.namedChildren.find(n => n.type === 'mapping') ?? root;
const parseResult = dialect.parse(mappingNode, AgentforceSchema);
const compileResult = compile(parseResult.value);

if (compileResult.diagnostics.length > 0) {
  console.log(
    '❌ Compilation failed:',
    compileResult.diagnostics.map(d => d.message).join('\n')
  );
  process.exit(1);
}

const voice = compileResult.output.agent_version.modality_parameters.voice;
const annotations = compileResult.annotations;

// Fields that should be annotated
const expectedAnnotations = [
  'inbound_filler_words_detection',
  'inbound_keywords',
  'voice_id',
  'outbound_speed',
  'outbound_style_exaggeration',
  'outbound_stability',
  'outbound_similarity',
  'pronunciation_dict',
  'outbound_filler_sentences',
  'additional_configs',
];

console.log('Checking top-level voice field annotations:');
let allPresent = true;

for (const field of expectedAnnotations) {
  const hasAnnotation = annotations.getAnnotation(voice, field);
  console.log(`${hasAnnotation ? '✅' : '❌'} ${field}`);
  if (!hasAnnotation) allPresent = false;
}

// Check nested annotations
console.log('\nChecking nested field annotations:');

const checks = [
  {
    obj: voice.inbound_keywords,
    field: 'keywords',
    label: 'inbound_keywords.keywords',
  },
  {
    obj: voice.additional_configs,
    field: 'speak_up_config',
    label: 'additional_configs.speak_up_config',
  },
  {
    obj: voice.additional_configs?.speak_up_config,
    field: 'speak_up_first_wait_time_ms',
    label: 'speak_up_config.speak_up_first_wait_time_ms',
  },
  {
    obj: voice.additional_configs?.speak_up_config,
    field: 'speak_up_follow_up_wait_time_ms',
    label: 'speak_up_config.speak_up_follow_up_wait_time_ms',
  },
  {
    obj: voice.additional_configs?.speak_up_config,
    field: 'speak_up_message',
    label: 'speak_up_config.speak_up_message',
  },
  {
    obj: voice.additional_configs,
    field: 'endpointing_config',
    label: 'additional_configs.endpointing_config',
  },
  {
    obj: voice.additional_configs?.endpointing_config,
    field: 'max_wait_time_ms',
    label: 'endpointing_config.max_wait_time_ms',
  },
  {
    obj: voice.additional_configs,
    field: 'beepboop_config',
    label: 'additional_configs.beepboop_config',
  },
  {
    obj: voice.additional_configs?.beepboop_config,
    field: 'max_wait_time_ms',
    label: 'beepboop_config.max_wait_time_ms',
  },
];

for (const { obj, field, label } of checks) {
  if (obj) {
    const hasAnnotation = annotations.getAnnotation(obj, field);
    console.log(`${hasAnnotation ? '✅' : '❌'} ${label}`);
    if (!hasAnnotation) allPresent = false;
  } else {
    console.log(`⚠️  ${label} (object not present)`);
  }
}

console.log(
  `\n${allPresent ? '✅' : '❌'} ${allPresent ? 'SUCCESS' : 'FAILURE'}: All expected annotations are present`
);

if (!allPresent) process.exit(1);
