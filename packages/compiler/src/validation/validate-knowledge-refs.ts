/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { CompilerContext } from '../compiler-context.js';
import type { ParsedKnowledge } from '../parsed-types.js';
import { extractStringValue, extractBooleanValue } from '../ast-helpers.js';

/**
 * Validate @knowledge references in the AST.
 *
 * Walks the knowledge block and populates ctx.knowledgeFields
 * for eager resolution during expression compilation.
 */
export function validateKnowledgeReferences(
  knowledgeBlock: ParsedKnowledge | undefined,
  ctx: CompilerContext
): void {
  if (!knowledgeBlock) return;

  // Extract known knowledge fields
  for (const [key, value] of Object.entries(knowledgeBlock)) {
    if (key.startsWith('__')) continue; // Skip internal metadata

    // Try extracting as string first
    const strValue = extractStringValue(value);
    if (strValue !== undefined) {
      ctx.knowledgeFields.set(key, strValue);
      continue;
    }

    // Try extracting as boolean
    const boolValue = extractBooleanValue(value);
    if (boolValue !== undefined) {
      ctx.knowledgeFields.set(key, boolValue);
    }
  }
}
