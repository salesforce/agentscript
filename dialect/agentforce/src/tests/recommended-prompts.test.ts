/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { parseDocument, emitDocument } from './test-utils.js';

describe('recommended_prompts block', () => {
  const fullSource = `
system:
    instructions: "Help the user"
    recommended_prompts:
        in_conversation: True
        welcome_screen: True
        starter_prompts:
            - "How can I help?"
            - "Track my order"
            - "Return a product"

config:
    agent_name: "TestAgent"
    agent_type: "AgentforceEmployeeAgent"

start_agent main:
    description: "Test"

    reasoning:
        instructions: ->
            | Help the user
`;

  it('should parse recommended_prompts under system', () => {
    const parsed = parseDocument(fullSource);
    const system = parsed.system as Record<string, unknown>;
    expect(system).toBeDefined();
    expect(system.recommended_prompts).toBeDefined();
  });

  it('should parse in_conversation and welcome_screen booleans', () => {
    const parsed = parseDocument(fullSource);
    const system = parsed.system as Record<string, unknown>;
    const recs = system.recommended_prompts as Record<string, unknown>;
    expect(recs.in_conversation).toBeDefined();
    expect(recs.welcome_screen).toBeDefined();
  });

  it('should parse welcome_starter_prompts sequence', () => {
    const parsed = parseDocument(fullSource);
    const system = parsed.system as Record<string, unknown>;
    const recs = system.recommended_prompts as Record<string, unknown>;
    expect(recs.starter_prompts).toBeDefined();
  });

  it('should emit recommended_prompts round-trip', () => {
    const parsed = parseDocument(fullSource);
    const emitted = emitDocument(parsed);
    expect(emitted).toContain('recommended_prompts:');
    expect(emitted).toContain('in_conversation: True');
    expect(emitted).toContain('welcome_screen: True');
    expect(emitted).toContain('starter_prompts:');
  });
});
