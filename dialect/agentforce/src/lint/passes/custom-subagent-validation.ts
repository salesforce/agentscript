/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Lint pass that validates custom subagent variants against their schema.
 *
 * When a subagent block has a schema matching node://..., resolves the expected
 * variant schema and reports errors for any fields not defined in that schema.
 *
 * Diagnostic: custom-subagent-validation
 */

import type { AstNodeLike, NamedMap } from '@agentscript/language';
import type { LintPass, PassStore, AstRoot } from '@agentscript/language';
import {
  storeKey,
  attachDiagnostic,
  lintDiagnostic,
  isNamedMap,
} from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import { COMMERCE_SHOPPER_SCHEMA } from '../../variants/commerce-cloud-shopper.js';
import { TABLEAU_ANALYZE_DATA_SCHEMA } from '../../variants/tableau-analyze-data.js';
import { BYON_SCHEMA_PREFIX } from '../../variants/byon.js';
import {
  commerceShopperVariant,
  tableauAnalyzeDataVariant,
} from '../../schema.js';
import { extractStringValue, getBlockRange } from '../utils.js';

const NODE_SCHEMA_PREFIX = 'node://';

/** Prefix used by the parser for internal metadata fields. */
const INTERNAL_FIELD_PREFIX = '__';

/**
 * Maps schema URIs to their pre-merge variant field sets.
 * NamedBlock.resolveSchemaForDiscriminant merges variant fields with the base,
 * so we use the raw variant definitions to determine what's actually allowed.
 */
const VARIANT_ALLOWED_FIELDS: Record<string, Set<string>> = {
  [COMMERCE_SHOPPER_SCHEMA]: new Set(Object.keys(commerceShopperVariant)),
  [TABLEAU_ANALYZE_DATA_SCHEMA]: new Set(
    Object.keys(tableauAnalyzeDataVariant)
  ),
};

/**
 * Validate a single custom subagent block against its variant schema.
 * Reports errors for any fields not defined in the variant's own schema.
 */
function validateBlock(
  name: string,
  block: Record<string, unknown>,
  schemaValue: string
): void {
  const allowedFields = VARIANT_ALLOWED_FIELDS[schemaValue];
  if (!allowedFields) return;

  for (const field of Object.keys(block)) {
    if (field.startsWith(INTERNAL_FIELD_PREFIX)) continue;
    if (allowedFields.has(field)) continue;

    const fieldValue = block[field];
    if (fieldValue == null) continue;

    const range = getBlockRange(fieldValue) ?? getBlockRange(block);

    attachDiagnostic(
      block as AstNodeLike,
      lintDiagnostic(
        range,
        `'${field}' is not allowed on custom subagent '${name}'.`,
        DiagnosticSeverity.Error,
        'custom-subagent-validation'
      )
    );
  }
}

class CustomSubagentValidationPass implements LintPass {
  readonly id = storeKey('custom-subagent-validation');
  readonly description =
    'Validates custom subagent variants against their schema';

  run(_store: PassStore, root: AstRoot): void {
    for (const key of ['subagent', 'start_agent'] as const) {
      const collection = root[key];
      if (!isNamedMap(collection)) continue;

      for (const [name, block] of collection as NamedMap<unknown>) {
        if (!block || typeof block !== 'object') continue;

        const rec = block as Record<string, unknown>;
        const schemaValue = extractStringValue(rec['schema']);
        if (!schemaValue || !schemaValue.startsWith(NODE_SCHEMA_PREFIX))
          continue;

        if (schemaValue.startsWith(BYON_SCHEMA_PREFIX)) {
          warnByonNotForProd(name, rec);
          continue;
        }

        validateBlock(name, rec, schemaValue);
      }
    }
  }
}

/**
 * Emit a warning that node://byon/* schemas are intended for test / lower
 * environments only and not approved for production use.
 */
function warnByonNotForProd(
  name: string,
  block: Record<string, unknown>
): void {
  const range = getBlockRange(block['schema']) ?? getBlockRange(block);
  attachDiagnostic(
    block as AstNodeLike,
    lintDiagnostic(
      range,
      `Custom subagent '${name}' uses a node://byon/* schema. ` +
        `BYON nodes are for test and lower environments only — not for production use.`,
      DiagnosticSeverity.Warning,
      'byon-not-for-production'
    )
  );
}

export function customSubagentValidationRule(): LintPass {
  return new CustomSubagentValidationPass();
}
