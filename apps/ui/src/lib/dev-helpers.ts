/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Development helpers and utilities
 * These are only meant to be used during development
 */

import {
  loadTestScriptsIfNeeded,
  loadAllTestScripts,
} from './load-test-scripts';
import { EXAMPLE_SCRIPTS } from './examples';
import { useAgentStore } from '~/store/agentStore';

/**
 * Initialize development environment
 * Call this in main.tsx or App.tsx during development
 */
export function initDevEnvironment(): void {
  if (import.meta.env.DEV) {
    // Expose helpful utilities on window for debugging
    if (typeof window !== 'undefined') {
      (window as Window & { __dev?: unknown }).__dev = {
        loadTestScripts: loadAllTestScripts,
        loadTestScriptsIfNeeded,
        seedExamples: seedDefaultAgents,
      };
    }
  }
}

/**
 * Seed the store with built-in example scripts if no agents exist yet.
 * Safe to call on every startup — no-ops if agents are already present.
 */
export function seedDefaultAgents(): void {
  const { agents, createAgent, updateAgent } = useAgentStore.getState();
  if (Object.keys(agents).length > 0) return;

  for (const example of EXAMPLE_SCRIPTS) {
    const id = createAgent(example.name);
    updateAgent(id, {
      description: example.description,
      content: example.content,
    });
  }
}

/**
 * Auto-load test scripts if none are present.
 * Runs in both dev and production so that "Reset all data" always re-seeds example scripts.
 */
export async function autoLoadTestScripts(): Promise<void> {
  await loadTestScriptsIfNeeded();
}
