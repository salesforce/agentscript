/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { AstRoot, FieldType, AstNodeLike, Range } from '../core/types.js';
import { toRange } from '../core/types.js';
import { DiagnosticSeverity, attachDiagnostic } from '../core/diagnostics.js';
import {
  storeKey,
  schemaContextKey,
  type LintPass,
  type PassStore,
} from '../core/analysis/lint.js';
import { lintDiagnostic } from './lint-utils.js';
import { walkSchema } from './schema-walker.js';

function isRequired(fieldType: FieldType): boolean {
  return fieldType.__metadata?.required === true;
}

/**
 * Return the block declaration line range for diagnostics.
 * Navigates from the CST node up to the parent mapping_element's key node
 * so the diagnostic highlights just the declaration (e.g. "start_agent topic_selector:")
 * rather than the entire block content.
 */
function blockHeaderRange(instance: AstNodeLike): Range {
  const fallback: Range = {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 },
  };
  const cst = instance.__cst;
  if (!cst) return fallback;

  const node = cst.node;
  const mappingElement =
    node.type === 'mapping_element'
      ? node
      : node.parent?.type === 'mapping_element'
        ? node.parent
        : null;

  if (mappingElement) {
    const keyNode = mappingElement.childForFieldName('key');
    if (keyNode) {
      return toRange(keyNode);
    }
  }

  return {
    start: cst.range.start,
    end: { line: cst.range.start.line, character: cst.range.start.character },
  };
}

class RequiredFieldPass implements LintPass {
  readonly id = storeKey('required-fields');
  readonly description =
    'Validates that blocks contain all required fields from their schema';
  readonly requires = [schemaContextKey];

  run(store: PassStore, root: AstRoot): void {
    const ctx = store.get(schemaContextKey);
    if (!ctx) return;

    walkSchema(root, ctx.info.schema, {
      visitField(
        value: unknown,
        fieldType: FieldType,
        fieldName: string,
        instance: AstNodeLike
      ) {
        if (isRequired(fieldType) && value === undefined) {
          attachDiagnostic(
            instance,
            lintDiagnostic(
              blockHeaderRange(instance),
              `Missing required field '${fieldName}'`,
              DiagnosticSeverity.Error,
              'missing-required-field'
            )
          );
        }
      },
    });
  }
}

export function requiredFieldPass(): LintPass {
  return new RequiredFieldPass();
}
