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
 * - concat(parts, sep=""): each part joins into a string; the sep keyword must
 *   be a string.
 *
 * Lives at the dialect layer because type inference needs the typeMap. Reports
 * only when a type is positively known-wrong; null (dynamic) is skipped, except
 * for concat parts.
 *
 * Diagnostic: function-argument-type (Warning or Error)
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
  NoneLiteral,
  KeywordArgument,
  ListLiteral,
  DictLiteral,
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

/**
 * Classify a positional `concat` argument:
 * - `'skip'`         — string or `list[string]`: allowed.
 * - `'warn-list'`    — bare `list` or list literal: elements may not be strings.
 * - `'warn-unknown'` — un-inferable (`null`): data-dependent call (json_path,
 *                      from_json), ternary, unresolved ref.
 * - `'error'`        — anything else (None, number, boolean, dict/object,
 *                      `list[number]`, dict literal): can never be a part.
 *
 * List/dict literals infer to `null`, so they are matched on the AST node first.
 */
function classifyConcatPart(
  expr: Expression,
  type: string | null
): 'skip' | 'warn-list' | 'warn-unknown' | 'error' {
  if (expr instanceof NoneLiteral) return 'error';
  if (expr instanceof ListLiteral) return 'warn-list';
  if (expr instanceof DictLiteral) return 'error';
  if (type === 'string' || type === 'list[string]') return 'skip';
  if (type === 'list') return 'warn-list';
  // Any other statically-known list (e.g. list[number]) has non-string elements.
  if (isListType(type ?? '')) return 'error';
  if (type === null) return 'warn-unknown';
  // Any other statically-known type (number, boolean, dict, object) is not a
  // string and cannot be joined.
  return 'error';
}

/** A single (argument, message) finding produced by a function rule. */
interface ArgFinding {
  readonly arg: Expression;
  readonly message: string;
  /** Diagnostic severity for this finding. Defaults to Warning in `run()`. */
  readonly severity?: DiagnosticSeverity;
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

  // concat(parts, sep=""): parts must be string or list[string]; sep must be a
  // string. Bare list / list literal / un-inferable part warns; any other known
  // non-string part errors.
  concat: args => {
    const findings: ArgFinding[] = [];
    for (const arg of args) {
      // sep=...: must be a string. Any known non-string (including a literal
      // None) is a hard error.
      if (arg.expr instanceof KeywordArgument) {
        if (arg.expr.value instanceof NoneLiteral) {
          findings.push({
            arg: arg.expr,
            message: `'concat' sep must be a string, but got None`,
            severity: DiagnosticSeverity.Error,
          });
        } else if (arg.type !== null && arg.type !== 'string') {
          findings.push({
            arg: arg.expr,
            message: `'concat' sep must be a string, but got ${inferredTypeLabel(arg.type)}`,
            severity: DiagnosticSeverity.Error,
          });
        }
        continue;
      }

      // Positional part.
      const kind = classifyConcatPart(arg.expr, arg.type);
      if (kind === 'skip') continue;

      if (kind === 'warn-list') {
        const label =
          arg.expr instanceof ListLiteral
            ? 'a list'
            : inferredTypeLabel(arg.type as string);
        findings.push({
          arg: arg.expr,
          message: `'concat' joins a list only when its elements are strings, but got ${label} — this raises an error at runtime if any element is not a string`,
        });
        continue;
      }

      if (kind === 'warn-unknown') {
        findings.push({
          arg: arg.expr,
          message: `'concat' expects a string or list of strings; this argument's type can't be determined and will raise an error at runtime if it is neither`,
        });
        continue;
      }

      // kind === 'error'
      const label =
        arg.expr instanceof NoneLiteral
          ? 'None'
          : arg.expr instanceof DictLiteral
            ? 'a dictionary'
            : inferredTypeLabel(arg.type as string);
      findings.push({
        arg: arg.expr,
        message: `'concat' expects string arguments, but got ${label}`,
        severity: DiagnosticSeverity.Error,
      });
    }
    return findings;
  },
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
      'Validates argument types of built-in function calls (json_path, len, max, min, lower, upper, to_json, from_json, concat)',
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
              finding.severity ?? DiagnosticSeverity.Warning,
              'function-argument-type'
            )
          );
        }
      });
    },
  };
}
