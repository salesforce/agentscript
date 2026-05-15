/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Complex data type rule for Agentforce.
 *
 * Only `object` and `list[object]` declarations support a `complex_data_type_name`.
 *
 * - When a whitelisted type (`object` / `list[object]`) lacks schema info:
 *   - Inputs: should have `complex_data_type_name` or `schema` (warning)
 *   - Outputs: should have `complex_data_type_name` (warning)
 * - When a non-whitelisted (primitive) type has `complex_data_type_name`: error.
 *
 * Diagnostics: object-type-missing-schema, complex-data-type-on-primitive
 */

import type { AstNodeLike, AstRoot, NamedMap } from '@agentscript/language';
import type { LintPass, PassStore } from '@agentscript/language';
import {
  storeKey,
  attachDiagnostic,
  lintDiagnostic,
  isNamedMap,
  schemaContextKey,
  resolveNamespaceKeys,
} from '@agentscript/language';
import type { CstMeta } from '@agentscript/types';
import { DiagnosticSeverity } from '@agentscript/types';
import { getBlockRange as getDeclRange } from '../utils.js';

/** Get type text from a declaration's `type` field via CST source. */
function getTypeText(decl: Record<string, unknown>): string | null {
  const type = decl.type as Record<string, unknown> | undefined;
  if (!type) return null;
  const cst = type.__cst as CstMeta | undefined;
  return cst?.node?.text?.trim() ?? null;
}

/**
 * These required complex data types creates a warning without `complex_data_type_name` field.
 * Anything outside this set is treated as a primitive and does not need a `complex_data_type_name`.
 */
const REQURIED_COMPLEX_DATA_TYPE = new Set<string>(['object', 'list[object]']);

function isComplexType(typeText: string): boolean {
  return REQURIED_COMPLEX_DATA_TYPE.has(typeText);
}

/** Check if a field has a non-empty string value. */
function hasStringField(
  properties: Record<string, unknown> | undefined,
  fieldName: string
): boolean {
  if (!properties) return false;
  const field = properties[fieldName];
  if (!field || typeof field !== 'object') return false;
  const obj = field as Record<string, unknown>;
  return typeof obj.value === 'string' && obj.value.trim().length > 0;
}

class ComplexDataTypePass implements LintPass {
  readonly id = storeKey('complex-data-type-warning');
  readonly description =
    'Warns when object-type action inputs/outputs lack complex_data_type_name or schema';
  readonly requires = [schemaContextKey];

  run(store: PassStore, root: AstRoot): void {
    const ctx = store.get(schemaContextKey);
    if (!ctx) return;

    const rootObj = root as AstNodeLike;

    const allKeys = new Set([
      ...resolveNamespaceKeys('topic', ctx),
      ...resolveNamespaceKeys('subagent', ctx),
    ]);

    for (const topicKey of allKeys) {
      const topicMap = rootObj[topicKey];
      if (!topicMap || !isNamedMap(topicMap)) continue;

      for (const [, block] of topicMap as NamedMap<unknown>) {
        if (!block || typeof block !== 'object') continue;
        const topic = block as AstNodeLike;

        const actionsMap = topic.actions;
        if (!actionsMap || !isNamedMap(actionsMap)) continue;

        for (const [actionName, actBlock] of actionsMap as NamedMap<unknown>) {
          if (!actBlock || typeof actBlock !== 'object') continue;
          const act = actBlock as Record<string, unknown>;

          this.checkDecls(act.inputs, actionName, 'input');
          this.checkDecls(act.outputs, actionName, 'output');
        }
      }
    }
  }

  private checkDecls(
    decls: unknown,
    actionName: string,
    kind: 'input' | 'output'
  ): void {
    if (!decls || !isNamedMap(decls)) return;

    for (const [paramName, decl] of decls as NamedMap<unknown>) {
      if (!decl || typeof decl !== 'object') continue;
      const obj = decl as AstNodeLike;
      const typeText = getTypeText(obj as Record<string, unknown>);
      if (!typeText) continue;

      const props = (obj as Record<string, unknown>).properties as
        | Record<string, unknown>
        | undefined;
      const hasComplexDataTypeField = hasStringField(
        props,
        'complex_data_type_name'
      );

      if (!isComplexType(typeText)) {
        // Primitive types must NOT declare complex_data_type_name.
        if (hasComplexDataTypeField) {
          attachDiagnostic(
            obj,
            lintDiagnostic(
              getDeclRange(obj),
              `Action ${kind} '${paramName}' in '${actionName}' has primitive type '${typeText}' and must not specify 'complex_data_type_name'. Only 'object' and 'list[object]' types support 'complex_data_type_name'.`,
              DiagnosticSeverity.Error,
              'complex-data-type-on-primitive'
            )
          );
        }
        continue;
      }

      // Complex types should declare schema info.
      // Inputs may use `schema` as an alternative to `complex_data_type_name`.
      const hasSchema =
        hasComplexDataTypeField ||
        (kind === 'input' && hasStringField(props, 'schema'));
      console.log('Schema: ', hasSchema);
      if (!hasSchema) {
        const required =
          kind === 'input'
            ? `'complex_data_type_name' or 'schema'`
            : `'complex_data_type_name'`;
        attachDiagnostic(
          obj,
          lintDiagnostic(
            getDeclRange(obj),
            `Action ${kind} '${paramName}' in '${actionName}' has type '${typeText}' but lacks ${required}. Consider specifying the object schema for better type validation.`,
            DiagnosticSeverity.Warning,
            'object-type-missing-schema'
          )
        );
      }
    }
  }
}

export function complexDataTypeWarningRule(): LintPass {
  return new ComplexDataTypePass();
}
