/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { isNamedMap } from '@agentscript/language';
import {
  attachError,
  extractStringValue,
  hasOwnNonNull,
  schemaFieldKeys,
  type AstLike,
} from './shared.js';

function extractValidatedOutputType(
  prop: Record<string, unknown>,
  node: AstLike,
  path: string
): string | undefined {
  const type = extractStringValue(prop.type);
  const allowedTypes = new Set([
    'string',
    'number',
    'integer',
    'boolean',
    'array',
    'object',
  ]);
  if (!type || !allowedTypes.has(type)) {
    attachError(
      node,
      `${path}: 'type' is required and must be one of string, number, integer, boolean, array, object.`,
      'output-structure-type'
    );
    return undefined;
  }
  return type;
}

function isUnsupportedOutputKeyword(key: string): boolean {
  const unsupported = [
    'additionalProperties',
    'anyOf',
    'oneOf',
    'allOf',
    '$ref',
    '$defs',
  ];
  return unsupported.includes(key);
}

function reportUnsupportedOutputKeywords(
  prop: Record<string, unknown>,
  node: AstLike,
  path: string
): void {
  const unsupported = [
    'additionalProperties',
    'anyOf',
    'oneOf',
    'allOf',
    '$ref',
    '$defs',
  ];
  for (const key of unsupported) {
    if (Object.prototype.hasOwnProperty.call(prop, key)) {
      attachError(
        node,
        `${path}: '${key}' is not supported in output_structure.`,
        'output-structure-unsupported'
      );
    }
  }
}

function allowedOutputFieldsForType(type: string): Set<string> {
  const common = new Set(['type', 'description', 'default', 'enum']);
  const stringOnly = new Set(['pattern', 'minLength', 'maxLength']);
  const numberOnly = new Set([
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
  ]);
  const arrayOnly = new Set(['items', 'minItems', 'maxItems']);
  const objectOnly = new Set(['properties', 'required']);

  const allowed = new Set(common);
  if (type === 'string') stringOnly.forEach(k => allowed.add(k));
  if (type === 'number' || type === 'integer')
    numberOnly.forEach(k => allowed.add(k));
  if (type === 'array') arrayOnly.forEach(k => allowed.add(k));
  if (type === 'object') objectOnly.forEach(k => allowed.add(k));
  return allowed;
}

function validateOutputProperty(
  prop: Record<string, unknown>,
  node: AstLike,
  path: string
): void {
  const type = extractValidatedOutputType(prop, node, path);
  if (!type) return;

  reportUnsupportedOutputKeywords(prop, node, path);
  const allowed = allowedOutputFieldsForType(type);
  for (const key of schemaFieldKeys(prop)) {
    if (isUnsupportedOutputKeyword(key)) continue;
    if (!allowed.has(key)) {
      attachError(
        node,
        `${path}: field '${key}' is not valid for type '${type}'.`,
        'output-structure-field'
      );
    }
  }

  if (type === 'array' && !hasOwnNonNull(prop, 'items')) {
    attachError(
      node,
      `${path}: array type requires 'items'.`,
      'output-structure-items-required'
    );
  }
  if (type === 'object') {
    const p = prop.properties;
    if (!isNamedMap(p)) {
      attachError(
        node,
        `${path}: object type requires 'properties'.`,
        'output-structure-properties-required'
      );
    } else {
      for (const [childName, childDef] of p) {
        if (childDef && typeof childDef === 'object') {
          validateOutputProperty(
            childDef as Record<string, unknown>,
            node,
            `${path}.properties.${childName}`
          );
        }
      }
    }
  }
}

export function checkOutputStructureRules(root: Record<string, unknown>): void {
  const validateGroup = (
    group: unknown,
    outputSelector: (rec: Record<string, unknown>) => unknown,
    pathPrefix: string
  ): void => {
    if (!isNamedMap(group)) return;
    for (const [, entry] of group) {
      if (entry == null || typeof entry !== 'object') continue;
      const rec = entry as Record<string, unknown>;
      const os = outputSelector(rec);
      if (os == null || typeof os !== 'object') continue;
      const props = (os as Record<string, unknown>).properties;
      if (!isNamedMap(props)) continue;
      for (const [propName, propDef] of props) {
        validateOutputProperty(
          propDef as Record<string, unknown>,
          entry as AstLike,
          `${pathPrefix}.${propName}`
        );
      }
    }
  };

  validateGroup(
    root.orchestrator,
    rec => (rec.reasoning as Record<string, unknown> | undefined)?.outputs,
    'reasoning.outputs'
  );
  validateGroup(
    root.subagent,
    rec => (rec.reasoning as Record<string, unknown> | undefined)?.outputs,
    'reasoning.outputs'
  );
  validateGroup(root.generator, rec => rec.outputs, 'outputs');
}
