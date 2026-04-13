/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Detect dialect from AgentScript source via the `# @dialect: NAME` annotation.
 *
 * Delegates to `parseDialectAnnotation()` from @agentscript/language so the UI
 * stays in sync with what the language server resolves.
 */

import type { DialectConfig } from '@agentscript/language';
import { parseDialectAnnotation } from '@agentscript/language';
import { dialects } from '~/lib/dialects';

/** Default dialect when no annotation is present (matches LSP worker order). */
export const DEFAULT_DIALECT_ID = 'agentforce';

/**
 * Parse the dialect id from a `# @dialect: NAME` annotation in the first 10 lines.
 * Returns the default dialect id when no annotation is found or when the
 * annotated dialect is not in the available list.
 */
export function detectDialectId(source: string | null | undefined): string {
  if (!source) return DEFAULT_DIALECT_ID;

  const annotation = parseDialectAnnotation(source);
  if (!annotation) return DEFAULT_DIALECT_ID;

  const known = dialects.find(d => d.name === annotation.name);
  return known ? known.name : DEFAULT_DIALECT_ID;
}

/**
 * Insert or replace the `# @dialect:` annotation in source.
 *
 * Only considers the first 10 lines when detecting an existing annotation.
 * The replacement is scoped to those same lines to avoid modifying a stray
 * match deeper in the file.
 */
export function setDialectAnnotation(
  source: string,
  dialectId: string
): string {
  const annotation = parseDialectAnnotation(source);
  if (annotation) {
    const lines = source.split('\n');
    lines[annotation.line] = `# @dialect: ${dialectId}`;
    return lines.join('\n');
  }
  return `# @dialect: ${dialectId}\n${source}`;
}

/** Look up DialectConfig by name (id). */
export function getDialectInfo(id: string): DialectConfig | undefined {
  return dialects.find(d => d.name === id);
}
