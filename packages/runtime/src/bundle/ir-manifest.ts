/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { AgentDSLAuthoring } from '@agentscript/compiler';
import type { ServerBlockConfig } from '../server-block.js';
import type { TriggerSpec } from '../trigger-block.js';

/**
 * Filename of the pre-compiled IR manifest written into a bundle's agents
 * directory. The server auto-detects this file and boots straight from IR,
 * skipping compilation on cold start. Kept next to the raw `.agent` sources so
 * a single `AGENTS_DIR` locates both.
 */
export const IR_MANIFEST_FILENAME = 'agentscript.ir.json';

/**
 * Manifest schema version. Bumped when the manifest shape (not the IR itself)
 * changes so a server loading an older/newer manifest can warn rather than
 * silently misbehave.
 */
export const IR_MANIFEST_VERSION = 1;

/** One pre-compiled agent: its id, IR document, and (optional) server block. */
export interface AgentIrEntry {
  /** Agent id (the `.agent` filename without extension). */
  id: string;
  /** Compiled IR — the same `doc` `createAgent({ doc })` consumes at runtime. */
  doc: AgentDSLAuthoring;
  /**
   * The parsed `server { ... }` block (llm/mcp config with env-refs), when the
   * source declared one. Carried so the server resolves the LLM/MCP the same
   * way it would from source — env-refs are resolved at boot, never baked in.
   */
  serverBlock?: ServerBlockConfig;
  /**
   * The parsed `trigger:` block (git-event bindings), when the source declared
   * one. Carried so a prebuilt manifest can be matched against an inbound git
   * event without recompiling every `.agent` on each delivery. Absent = the
   * workflow is manual-only and never fires on git events.
   */
  trigger?: TriggerSpec;
}

/** The full pre-compiled bundle manifest. */
export interface AgentIrManifest {
  /** {@link IR_MANIFEST_VERSION} the manifest was written with. */
  version: number;
  /** Tool that produced it (for provenance in logs). */
  generator: string;
  /** Pre-compiled agents, sorted by id for stable output. */
  agents: AgentIrEntry[];
}

/**
 * Parse and validate a manifest read from disk. Throws with an actionable
 * message on shape/version mismatch so a corrupt or stale manifest fails
 * loudly at boot instead of producing a half-loaded registry.
 */
export function parseIrManifest(raw: string): AgentIrManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Invalid IR manifest JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid IR manifest: expected a JSON object.');
  }
  const manifest = parsed as Partial<AgentIrManifest>;
  if (typeof manifest.version !== 'number') {
    throw new Error('Invalid IR manifest: missing numeric "version".');
  }
  if (manifest.version !== IR_MANIFEST_VERSION) {
    throw new Error(
      `Unsupported IR manifest version ${manifest.version} (expected ${IR_MANIFEST_VERSION}). Rebuild the bundle with a matching CLI.`
    );
  }
  if (!Array.isArray(manifest.agents)) {
    throw new Error('Invalid IR manifest: "agents" must be an array.');
  }
  for (const entry of manifest.agents) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string') {
      throw new Error('Invalid IR manifest: each agent needs a string "id".');
    }
    if (!('doc' in entry) || entry.doc == null) {
      throw new Error(
        `Invalid IR manifest: agent "${(entry as { id?: string }).id ?? '?'}" is missing its compiled "doc".`
      );
    }
  }
  return manifest as AgentIrManifest;
}
