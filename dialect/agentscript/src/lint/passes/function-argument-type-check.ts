/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Argument-type checks for built-in calls, per the graph-expressions guide:
 * - len(obj): list, dict, or string (one arg).
 * - min/max: multiple scalar args OR a single iterable (list/dict/string).
 * - json_path(obj, ...): object or list (not in the guide; AgentScript-added).
 * - lower(s)/upper(s): string (one arg).
 * - from_json(s): string (one arg).
 * - to_json(obj): any type — no positively-wrong shape, so unchecked.
 *
 * Lives at the dialect layer because type inference needs the typeMap. Warns
 * only when a type is positively known-wrong; null (dynamic) is skipped.
 *
 * Diagnostic: function-argument-type (Warning)
 */

import type { AstRoot, LintPass, AstNodeLike } from '@agentscript/language';
import type { CstMeta } from '@agentscript/types';
import {
  storeKey,
  walkAstExpressions,
  attachDiagnostic,
  lintDiagnostic,
  inferExpressionType,
  inferredTypeLabel,
  schemaContextKey,
  resolveGlobalMemberType,
  CallExpression,
  Identifier,
  type Expression,
} from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import type { PassStore } from '@agentscript/language';
import { typeMapKey } from './type-map.js';

/** List type: `list` or `list[...]`. */
function isListType(type: string): boolean {
  return type === 'list' || type.startsWith('list[');
}

/** Iterable len()/min()/max() accept: list, dict, object, or string. */
function isIterableType(type: string): boolean {
  return (
    type === 'dict' ||
    type === 'object' ||
    type === 'string' ||
    isListType(type)
  );
}

/** Type JSONPath can descend into. */
function isJsonPathTarget(type: string): boolean {
  return type === 'object' || type === 'dict' || isListType(type);
}

/** A single (argument, message) finding produced by a function rule. */
interface ArgFinding {
  readonly arg: Expression;
  readonly message: string;
}

/**
 * Per-function validator. Receives every argument paired with its inferred
 * type (`null` = not statically determinable) and returns findings for
 * positively-wrong arguments only.
 */
type FunctionArgValidator = (
  args: readonly { expr: Expression; type: string | null }[]
) => ArgFinding[];

const FUNCTION_VALIDATORS: Readonly<Record<string, FunctionArgValidator>> = {
  // len(obj): list, dict, or string.
  len: args =>
    args
      .filter(a => a.type !== null && !isIterableType(a.type))
      .map(a => ({
        arg: a.expr,
        message: `'len' expects a list, dict, or string, but got ${inferredTypeLabel(a.type as string)}`,
      })),

  // min/max: a single iterable, OR multiple scalar args. Only the single-arg
  // form requires an iterable — flag a lone scalar; multi-arg comparison of
  // scalars (or anything else) is left alone.
  min: minMaxValidator('min'),
  max: minMaxValidator('max'),

  // json_path(obj, path, default?): first arg must be an object or list.
  json_path: args => {
    const first = args[0];
    if (!first || first.type === null || isJsonPathTarget(first.type))
      return [];
    return [
      {
        arg: first.expr,
        message: `'json_path' expects an object or list, but got ${inferredTypeLabel(first.type)}`,
      },
    ];
  },

  // lower(s)/upper(s): a single string argument.
  lower: stringArgValidator('lower'),
  upper: stringArgValidator('upper'),

  // from_json(s): parses a JSON string — a single string argument.
  from_json: stringArgValidator('from_json'),

  // to_json(obj): accepts dict/list/primitive/model — no positively-wrong
  // shape to flag, so left unvalidated.
};

function stringArgValidator(name: string): FunctionArgValidator {
  return args => {
    const only = args[0];
    if (!only || only.type === null || only.type === 'string') return [];
    return [
      {
        arg: only.expr,
        message: `'${name}' expects a string, but got ${inferredTypeLabel(only.type)}`,
      },
    ];
  };
}

function minMaxValidator(name: 'min' | 'max'): FunctionArgValidator {
  return args => {
    if (args.length !== 1) return [];
    const only = args[0];
    if (only.type === null || isIterableType(only.type)) return [];
    return [
      {
        arg: only.expr,
        message: `'${name}' with a single argument expects a list, dict, or string, but got ${inferredTypeLabel(only.type)}`,
      },
    ];
  };
}

export const functionArgumentTypeCheckKey = storeKey<void>(
  'function-argument-type-check'
);

// Plain LintPass (not defineRule): needs both typeMap/schemaCtx deps and a full
// expression walk — built-in calls can appear in any expression position.
export function functionArgumentTypeCheckRule(): LintPass {
  return {
    id: functionArgumentTypeCheckKey,
    description:
      'Validates argument types of built-in function calls (json_path, len, max, min, lower, upper, to_json, from_json)',
    requires: [typeMapKey, schemaContextKey],

    run(store: PassStore, root: AstRoot): void {
      const typeMap = store.get(typeMapKey);
      const schemaCtx = store.get(schemaContextKey);
      if (!typeMap || !schemaCtx) return;

      const resolveVar = (name: string) =>
        typeMap.variables.get(name)?.type ?? null;

      const resolveGlobalMember = (
        namespace: string,
        path: readonly string[]
      ) => resolveGlobalMemberType(schemaCtx, namespace, path) ?? null;

      walkAstExpressions(root, expr => {
        if (!(expr instanceof CallExpression)) return;

        const func = expr.func;
        if (!(func instanceof Identifier)) return;

        const validate = FUNCTION_VALIDATORS[func.name];
        if (!validate) return;

        const args = expr.args.map(arg => ({
          expr: arg,
          type: inferExpressionType(arg, resolveVar, resolveGlobalMember),
        }));

        for (const finding of validate(args)) {
          const cst = (finding.arg as unknown as AstNodeLike).__cst as
            | CstMeta
            | undefined;
          if (!cst) continue;

          attachDiagnostic(
            finding.arg as unknown as AstNodeLike,
            lintDiagnostic(
              cst.range,
              finding.message,
              DiagnosticSeverity.Warning,
              'function-argument-type'
            )
          );
        }
      });
    },
  };
}
