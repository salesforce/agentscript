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
import { commerceShopperVariant } from '../../schema.js';
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
    const collection = (root as Record<string, unknown>)['subagent'];
    if (!collection || !isNamedMap(collection)) return;

    for (const [name, block] of collection as NamedMap<unknown>) {
      if (!block || typeof block !== 'object') continue;

      const rec = block as Record<string, unknown>;
      const schemaValue = extractStringValue(rec['schema']);
      if (!schemaValue || !schemaValue.startsWith(NODE_SCHEMA_PREFIX)) continue;

      validateBlock(name, rec, schemaValue);
    }
  }
}

export function customSubagentValidationRule(): LintPass {
  return new CustomSubagentValidationPass();
}
