/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Lint pass that flags blocks written with no content.
 *
 * Several Agentforce blocks type all of their fields as optional, so the schema
 * accepts an empty block even though it carries no configuration and is
 * behaviourally identical to omitting the block. An empty block is almost
 * always an authoring leftover — and for integration-style blocks (`connection`,
 * `knowledge`, `modality`) it is a genuine trap: it reads as "something is wired
 * up" while doing nothing. We surface all of them as errors.
 *
 * This covers a block/collection written with no entries (e.g. a bare
 * `connection:` or `modality:`). It also covers empty *named entries* whose
 * block requires no single specific field but must carry at least one — a
 * `modality voice:` with no properties identifies no voice and does nothing.
 * (Entries whose block has a genuinely required field — `subagent`'s
 * `description`, `connection`'s configuration fields — are already rejected by
 * those required-field checks, so they are not listed here.)
 *
 * Diagnostic: empty-block.
 */

import type { AstNodeLike, AstRoot } from '@agentscript/language';
import type { LintPass, PassStore } from '@agentscript/language';
import {
  storeKey,
  attachDiagnostic,
  lintDiagnostic,
  isNamedMap,
} from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import { getBlockRange } from '../utils.js';

/** Top-level blocks whose fields are all optional but must not be empty. */
const MUST_NOT_BE_EMPTY = [
  'system',
  'variables',
  'model_config',
  'knowledge',
  'connection',
  'modality',
  'access',
  'context',
] as const;

/**
 * Named collections whose *entries* have no single required field but must
 * carry at least one property (an empty entry is meaningless). Each entry is
 * checked with the same emptiness test as a top-level block.
 */
const ENTRIES_MUST_NOT_BE_EMPTY = ['modality'] as const;

/**
 * A block is empty when it holds no authored content. Collection blocks expose
 * a numeric `size`; plain blocks carry one own key per authored field alongside
 * internal `__`-prefixed bookkeeping keys.
 */
function isEmptyBlock(block: AstNodeLike): boolean {
  const size = (block as { size?: unknown }).size;
  if (typeof size === 'number') return size === 0;
  return !Object.keys(block).some(key => !key.startsWith('__'));
}

/** Whether the block already carries a diagnostic with the given code. */
function hasDiagnostic(block: AstNodeLike, code: string): boolean {
  const diagnostics = (block as { __diagnostics?: { code?: string }[] })
    .__diagnostics;
  return Array.isArray(diagnostics) && diagnostics.some(d => d.code === code);
}

function reportEmpty(block: AstNodeLike, label: string): void {
  attachDiagnostic(
    block,
    lintDiagnostic(
      getBlockRange(block),
      `Empty '${label}' block: it has no content and will have no effect. Add configuration or remove the block.`,
      DiagnosticSeverity.Error,
      'empty-block'
    )
  );
}

class EmptyBlockPass implements LintPass {
  readonly id = storeKey('empty-block-agentforce');
  readonly description =
    'Flags blocks (connection, knowledge, modality, …) written with no content';

  run(_store: PassStore, root: AstRoot): void {
    for (const key of MUST_NOT_BE_EMPTY) {
      const block = (root as Record<string, unknown>)[key];
      if (!block || typeof block !== 'object') continue;
      if (isEmptyBlock(block as AstNodeLike))
        reportEmpty(block as AstNodeLike, key);
    }

    // An empty *entry* of these collections (e.g. `modality voice:` with no
    // properties) is just as meaningless as an empty collection.
    for (const key of ENTRIES_MUST_NOT_BE_EMPTY) {
      const collection = (root as Record<string, unknown>)[key];
      if (!isNamedMap(collection)) continue;
      for (const [name, entry] of collection.entries()) {
        if (!entry || typeof entry !== 'object') continue;
        // An unknown-variant entry is empty only because field parsing was
        // skipped; the unknown-variant diagnostic already covers it.
        if (hasDiagnostic(entry as AstNodeLike, 'unknown-variant')) continue;
        if (isEmptyBlock(entry as AstNodeLike))
          reportEmpty(entry as AstNodeLike, `${key} ${name}`);
      }
    }
  }
}

export function emptyBlockRule(): LintPass {
  return new EmptyBlockPass();
}
