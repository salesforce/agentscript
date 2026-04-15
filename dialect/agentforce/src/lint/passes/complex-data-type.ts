/**
 * Complex data type warning rule for Agentforce.
 *
 * Warns when object-type action inputs/outputs lack schema information:
 * - Inputs: should have complex_data_type_name or schema
 * - Outputs: should have complex_data_type_name
 *
 * Diagnostic: object-type-missing-schema
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

/** Check if a type string represents an object type. */
function isObjectType(typeText: string): boolean {
  return typeText === 'object' || typeText === 'list[object]';
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

          this.checkInputs(act.inputs, actionName);
          this.checkOutputs(act.outputs, actionName);
        }
      }
    }
  }

  private checkInputs(inputs: unknown, actionName: string): void {
    if (!inputs || !isNamedMap(inputs)) return;

    for (const [paramName, decl] of inputs as NamedMap<unknown>) {
      if (!decl || typeof decl !== 'object') continue;
      const obj = decl as AstNodeLike;
      const typeText = getTypeText(obj as Record<string, unknown>);
      if (!typeText || !isObjectType(typeText)) continue;

      const props = (obj as Record<string, unknown>).properties as
        | Record<string, unknown>
        | undefined;
      if (
        !hasStringField(props, 'complex_data_type_name') &&
        !hasStringField(props, 'schema')
      ) {
        attachDiagnostic(
          obj,
          lintDiagnostic(
            getDeclRange(obj),
            `Action input '${paramName}' in '${actionName}' has type '${typeText}' but lacks 'complex_data_type_name' or 'schema'. Consider specifying the object schema for better type validation.`,
            DiagnosticSeverity.Warning,
            'object-type-missing-schema'
          )
        );
      }
    }
  }

  private checkOutputs(outputs: unknown, actionName: string): void {
    if (!outputs || !isNamedMap(outputs)) return;

    for (const [outputName, decl] of outputs as NamedMap<unknown>) {
      if (!decl || typeof decl !== 'object') continue;
      const obj = decl as AstNodeLike;
      const typeText = getTypeText(obj as Record<string, unknown>);
      if (!typeText || !isObjectType(typeText)) continue;

      const props = (obj as Record<string, unknown>).properties as
        | Record<string, unknown>
        | undefined;
      if (!hasStringField(props, 'complex_data_type_name')) {
        attachDiagnostic(
          obj,
          lintDiagnostic(
            getDeclRange(obj),
            `Action output '${outputName}' in '${actionName}' has type '${typeText}' but lacks 'complex_data_type_name'. Consider specifying the object schema for better type validation.`,
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
