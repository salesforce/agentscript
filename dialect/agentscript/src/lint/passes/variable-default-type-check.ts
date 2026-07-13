/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Variable default-value type checking — validates that a variable's
 * declared type matches the inferred type of its default value literal.
 *
 * Conservative: only checks literal default values; refs/calls are skipped.
 * Diagnostic: variable-default-type-mismatch (Warning severity)
 */

import type {
  AstRoot,
  LintPass,
  NamedMap,
  PassStore,
} from '@agentscript/language';
import type { CstMeta } from '@agentscript/types';
import {
  isNamedMap,
  storeKey,
  typeMismatchDiagnostic,
  attachDiagnostic,
  LINT_SOURCE,
  DiagnosticSeverity,
} from '@agentscript/language';
import { typeMapKey } from './type-map.js';

function inferDefaultValueType(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  switch (obj.__kind) {
    case 'StringLiteral':
    case 'TemplateExpression':
      return 'string';
    case 'NumberLiteral':
      return 'number';
    case 'BooleanLiteral':
      return 'boolean';
    case 'ListLiteral':
      return 'list';
    case 'DictLiteral':
      return 'object';
    default:
      return null;
  }
}

function typesCompatible(declared: string, actual: string): boolean {
  const d = declared.toLowerCase();
  const a = actual.toLowerCase();
  if (d === a) return true;
  if (d === 'object' || a === 'object') return true;
  return false;
}

class VariableDefaultTypeCheckPass implements LintPass {
  readonly id = storeKey<void>('variable-default-type-check');
  readonly description =
    'Validates that variable default values match their declared types';
  readonly requires = [typeMapKey];

  run(store: PassStore, root: AstRoot): void {
    const typeMap = store.get(typeMapKey);
    if (!typeMap) return;

    const varsMap = (root as Record<string, unknown>).variables;
    if (!varsMap || !isNamedMap(varsMap)) return;

    for (const [name, decl] of varsMap as NamedMap<unknown>) {
      if (!decl || typeof decl !== 'object') continue;
      const declObj = decl as Record<string, unknown>;
      const defaultValue = declObj.defaultValue;
      if (!defaultValue) continue;

      const actualType = inferDefaultValueType(defaultValue);
      if (!actualType) continue;

      const declared = typeMap.variables.get(name)?.type;
      if (!declared) continue;

      if (typesCompatible(declared, actualType)) continue;

      const cst = (defaultValue as Record<string, unknown>).__cst as
        | CstMeta
        | undefined;
      if (!cst) continue;

      const diag = typeMismatchDiagnostic(
        cst.range,
        `Type mismatch: variable '${name}' is declared as '${declared}' but default value is '${actualType}'`,
        declared,
        actualType,
        LINT_SOURCE
      );
      diag.severity = DiagnosticSeverity.Warning;
      diag.code = 'variable-default-type-mismatch';
      attachDiagnostic(declObj, diag);
    }
  }
}

export function variableDefaultTypeCheckRule(): LintPass {
  return new VariableDefaultTypeCheckPass();
}
