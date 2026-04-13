/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { SchemaInfo } from './core/types.js';
import type { LintPass } from './core/analysis/lint.js';

/**
 * Configuration for a dialect. After implementing this interface, register
 * the dialect in `packages/lsp/src/dialect-registry.ts` so all LSP servers
 * and the UI pick it up automatically.
 */
export interface DialectConfig {
  /** Unique name for this dialect (e.g., 'agentscript', 'agentforce'). Derived from package name. */
  readonly name: string;

  /** Human-readable display name (e.g., 'AgentScript', 'Agentforce'). */
  readonly displayName: string;

  /** Short description for UI display. */
  readonly description: string;

  /** Dialect version from package.json (e.g., '2.2.6'). */
  readonly version: string;

  /** Full schema metadata: root schema, aliases, and global scopes. Single source of truth. */
  readonly schemaInfo: SchemaInfo;

  /** Factory that creates fresh lint passes for each analysis run. */
  readonly createRules: () => LintPass[];

  /** Diagnostic source tag (defaults to `${name}-lint`). */
  readonly source?: string;
}
