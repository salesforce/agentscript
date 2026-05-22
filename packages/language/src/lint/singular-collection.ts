/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { AstRoot, Range, FieldType } from '../core/types.js';
import { isNamedMap, hasCstRange } from '../core/types.js';
import { DiagnosticSeverity, attachDiagnostic } from '../core/diagnostics.js';
import {
  storeKey,
  schemaContextKey,
  type LintPass,
  type PassStore,
} from '../core/analysis/lint-engine.js';
import { lintDiagnostic } from './lint-utils.js';

/**
 * Lint pass that enforces at most one entry in collection fields marked
 * with `.singular()` in the schema metadata.
 *
 * Some collection blocks (e.g., `start_agent`) are parsed as NamedMaps for
 * consistency but semantically allow only a single entry.
 */
class SingularCollectionPass implements LintPass {
  readonly id = storeKey('singular-collection');
  readonly description =
    'Enforces that collection fields marked singular contain at most one entry';

  finalize(store: PassStore, root: AstRoot): void {
    const ctx = store.get(schemaContextKey);
    if (!ctx) return;

    const schema = ctx.info.schema;
    const rootObj = root as Record<string, unknown>;

    for (const [key, fieldType] of Object.entries(schema)) {
      if (!isSingularField(fieldType)) continue;

      const collection = rootObj[key];
      if (!isNamedMap(collection) || collection.size <= 1) continue;

      let index = 0;
      for (const [, entry] of collection) {
        if (index === 0) {
          index++;
          continue;
        }

        const range = getEntryRange(entry);
        if (range) {
          attachDiagnostic(
            root,
            lintDiagnostic(
              range,
              `Only one '${key}' is allowed, but found multiple entries`,
              DiagnosticSeverity.Error,
              'singular-collection'
            )
          );
        }
        index++;
      }
    }
  }
}

function isSingularField(fieldType: FieldType): boolean {
  return fieldType.__metadata?.singular === true;
}

/** Get the source range for a collection entry (for diagnostic positioning). */
function getEntryRange(entry: unknown): Range | undefined {
  return hasCstRange(entry) ? entry.__cst.range : undefined;
}

/**
 * Create a lint pass that enforces singular collection fields.
 * Reads the `singular` flag from field metadata set via `.singular()`.
 */
export function singularCollectionPass(): LintPass {
  return new SingularCollectionPass();
}
