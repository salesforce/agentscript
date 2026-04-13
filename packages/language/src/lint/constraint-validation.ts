/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type {
  AstRoot,
  FieldType,
  ConstraintMetadata,
  AstNodeLike,
  BlockCapability,
} from '../core/types.js';
import { isAstNodeLike } from '../core/types.js';
import { DiagnosticSeverity, attachDiagnostic } from '../core/diagnostics.js';
import {
  storeKey,
  schemaContextKey,
  type LintPass,
  type PassStore,
} from '../core/analysis/lint.js';
import type { SchemaContext } from '../core/analysis/scope.js';
import {
  lintDiagnostic,
  findSuggestion,
  formatSuggestionHint,
} from './lint-utils.js';
import {
  decomposeAtMemberExpression,
  MemberExpression,
} from '../core/expressions.js';
import { SequenceNode } from '../core/sequence.js';
import { walkSchema } from './schema-walker.js';

function getConstraints(fieldType: FieldType): ConstraintMetadata | undefined {
  return fieldType.__metadata?.constraints;
}

/**
 * Extract a static primitive from an AST node for validation.
 * Returns undefined for dynamic values (templates, expressions)
 * that cannot be validated at lint time.
 */
function extractStaticValue(
  value: unknown
):
  | { kind: 'string' | 'number' | 'boolean'; raw: string | number | boolean }
  | undefined {
  if (!isAstNodeLike(value)) return undefined;
  const kind = value.__kind;

  if (kind === 'NumberValue') {
    const v = value.value;
    if (typeof v === 'number') return { kind: 'number', raw: v };
  }
  if (kind === 'BooleanValue') {
    const v = value.value;
    if (typeof v === 'boolean') return { kind: 'boolean', raw: v };
  }
  if (kind === 'StringLiteral') {
    const v = value.value;
    if (typeof v === 'string') return { kind: 'string', raw: v };
  }
  return undefined;
}

/** Compiled RegExp cache -- avoids recompiling the same pattern string. */
const patternCache = new Map<string, RegExp | null>();
/** Track the last SchemaContext to clear the cache when the schema changes. */
let lastSchemaContext: SchemaContext | undefined;

/** Get a compiled RegExp, returning null for invalid patterns. */
function getCompiledPattern(pattern: string): RegExp | null {
  if (patternCache.has(pattern)) {
    return patternCache.get(pattern)!;
  }
  try {
    const re = new RegExp(pattern);
    patternCache.set(pattern, re);
    return re;
  } catch {
    patternCache.set(pattern, null);
    return null;
  }
}

/** Resolve the set of namespaces that satisfy a given resolved type (capability). */
function resolveCapabilityNamespaces(
  resolvedType: BlockCapability,
  ctx: SchemaContext
): ReadonlySet<string> | undefined {
  if (resolvedType === 'invocationTarget') {
    return ctx.invocationTargetNamespaces;
  }
  if (resolvedType === 'transitionTarget') {
    return ctx.transitionTargetNamespaces;
  }
  return undefined;
}

/** Format a human-readable label for a resolved type constraint. */
function resolvedTypeLabel(resolvedType: BlockCapability): string {
  if (resolvedType === 'invocationTarget') return 'invocation target';
  if (resolvedType === 'transitionTarget') return 'transition target';
  return resolvedType;
}

/** Validate a field value against its constraint metadata, attaching diagnostics to the AST node. */
function validateConstraints(
  value: unknown,
  constraints: ConstraintMetadata,
  fieldName: string,
  validatedRefs?: Set<AstNodeLike>,
  ctx?: SchemaContext
): void {
  if (!isAstNodeLike(value)) return;
  const node = value;
  const range = node.__cst?.range ?? {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 0 },
  };

  // Validate resolvedType — the expression must resolve to a namespace with the given capability.
  // Unlike allowedNamespaces, we only mark the node as validated when the check fails,
  // so downstream passes (e.g. undefined-reference) can still verify member existence.
  // Global scopes (e.g. @utils) are skipped — see TODO on SchemaContext.globalScopes.
  if (constraints.resolvedType && node instanceof MemberExpression && ctx) {
    const ref = decomposeAtMemberExpression(value);
    if (ref && !ctx.globalScopes.has(ref.namespace)) {
      const validNamespaces = resolveCapabilityNamespaces(
        constraints.resolvedType,
        ctx
      );
      if (validNamespaces && !validNamespaces.has(ref.namespace)) {
        validatedRefs?.add(node);
        const objectNode = isAstNodeLike(node.object) ? node.object : undefined;
        const nsRange = objectNode?.__cst?.range ?? range;
        const label = resolvedTypeLabel(constraints.resolvedType);
        const verb =
          constraints.resolvedType === 'invocationTarget'
            ? 'invoke'
            : 'reference';
        attachDiagnostic(
          node,
          lintDiagnostic(
            nsRange,
            `Cannot ${verb} '@${ref.namespace}.${ref.property}' \u2014 '${ref.namespace}' is not a valid ${label}.`,
            DiagnosticSeverity.Error,
            'constraint-resolved-type'
          )
        );
        return;
      }
    }
  }

  // Validate allowedNamespaces for ReferenceValue (MemberExpression) fields.
  // Early return is safe: MemberExpression nodes won't match extractStaticValue()
  // (which only handles NumberValue/BooleanValue/StringLiteral), so no downstream
  // constraint checks (pattern, min, max, enum, etc.) would apply anyway.
  if (constraints.allowedNamespaces && node instanceof MemberExpression) {
    validatedRefs?.add(node);
    const ref = decomposeAtMemberExpression(value);
    if (ref && !constraints.allowedNamespaces.includes(ref.namespace)) {
      // Narrow range to the @namespace part (AtIdentifier), not the full expression
      const objectNode = isAstNodeLike(node.object) ? node.object : undefined;
      const nsRange = objectNode?.__cst?.range ?? range;
      const suggestion = findSuggestion(ref.namespace, [
        ...constraints.allowedNamespaces,
      ]);
      const allowed = constraints.allowedNamespaces
        .map(ns => `@${ns}`)
        .join(', ');
      const base = `'${fieldName}' must reference one of: ${allowed}. Got @${ref.namespace}`;
      const message = formatSuggestionHint(base, suggestion, '@');
      attachDiagnostic(
        node,
        lintDiagnostic(
          nsRange,
          message,
          DiagnosticSeverity.Error,
          'constraint-allowed-namespaces'
        )
      );
    }
    return;
  }

  if (node instanceof SequenceNode) {
    const items = node.items;
    const count = items.length;

    if (constraints.minItems !== undefined && count < constraints.minItems) {
      attachDiagnostic(
        node,
        lintDiagnostic(
          range,
          `'${fieldName}' must have at least ${constraints.minItems} item(s), got ${count}`,
          DiagnosticSeverity.Error,
          'constraint-min-items'
        )
      );
    }
    if (constraints.maxItems !== undefined && count > constraints.maxItems) {
      attachDiagnostic(
        node,
        lintDiagnostic(
          range,
          `'${fieldName}' must have at most ${constraints.maxItems} item(s), got ${count}`,
          DiagnosticSeverity.Error,
          'constraint-max-items'
        )
      );
    }
    return;
  }

  const extracted = extractStaticValue(value);
  if (!extracted) return;

  const { kind, raw } = extracted;

  if (constraints.enum !== undefined && !constraints.enum.includes(raw)) {
    const allowed = constraints.enum.map(v => JSON.stringify(v)).join(', ');
    attachDiagnostic(
      node,
      lintDiagnostic(
        range,
        `'${fieldName}' must be one of: ${allowed}. Got ${JSON.stringify(raw)}`,
        DiagnosticSeverity.Error,
        'constraint-enum'
      )
    );
  }

  if (constraints.const !== undefined && raw !== constraints.const) {
    attachDiagnostic(
      node,
      lintDiagnostic(
        range,
        `'${fieldName}' must be ${JSON.stringify(constraints.const)}. Got ${JSON.stringify(raw)}`,
        DiagnosticSeverity.Error,
        'constraint-const'
      )
    );
  }

  if (kind === 'number' && typeof raw === 'number') {
    if (constraints.minimum !== undefined && raw < constraints.minimum) {
      attachDiagnostic(
        node,
        lintDiagnostic(
          range,
          `'${fieldName}' must be >= ${constraints.minimum}, got ${raw}`,
          DiagnosticSeverity.Error,
          'constraint-minimum'
        )
      );
    }
    if (constraints.maximum !== undefined && raw > constraints.maximum) {
      attachDiagnostic(
        node,
        lintDiagnostic(
          range,
          `'${fieldName}' must be <= ${constraints.maximum}, got ${raw}`,
          DiagnosticSeverity.Error,
          'constraint-maximum'
        )
      );
    }
    if (
      constraints.exclusiveMinimum !== undefined &&
      raw <= constraints.exclusiveMinimum
    ) {
      attachDiagnostic(
        node,
        lintDiagnostic(
          range,
          `'${fieldName}' must be > ${constraints.exclusiveMinimum}, got ${raw}`,
          DiagnosticSeverity.Error,
          'constraint-exclusive-minimum'
        )
      );
    }
    if (
      constraints.exclusiveMaximum !== undefined &&
      raw >= constraints.exclusiveMaximum
    ) {
      attachDiagnostic(
        node,
        lintDiagnostic(
          range,
          `'${fieldName}' must be < ${constraints.exclusiveMaximum}, got ${raw}`,
          DiagnosticSeverity.Error,
          'constraint-exclusive-maximum'
        )
      );
    }
    if (constraints.multipleOf !== undefined) {
      const remainder = Math.abs(raw % constraints.multipleOf);
      const epsilon =
        Number.EPSILON *
        Math.max(1, Math.abs(raw), Math.abs(constraints.multipleOf));
      if (
        remainder > epsilon &&
        Math.abs(remainder - constraints.multipleOf) > epsilon
      ) {
        attachDiagnostic(
          node,
          lintDiagnostic(
            range,
            `'${fieldName}' must be a multiple of ${constraints.multipleOf}, got ${raw}`,
            DiagnosticSeverity.Error,
            'constraint-multiple-of'
          )
        );
      }
    }
  }

  if (kind === 'string' && typeof raw === 'string') {
    if (
      constraints.minLength !== undefined &&
      raw.length < constraints.minLength
    ) {
      attachDiagnostic(
        node,
        lintDiagnostic(
          range,
          `'${fieldName}' must be at least ${constraints.minLength} character(s) long, got ${raw.length}`,
          DiagnosticSeverity.Error,
          'constraint-min-length'
        )
      );
    }
    if (
      constraints.maxLength !== undefined &&
      raw.length > constraints.maxLength
    ) {
      attachDiagnostic(
        node,
        lintDiagnostic(
          range,
          `'${fieldName}' must be at most ${constraints.maxLength} character(s) long, got ${raw.length}`,
          DiagnosticSeverity.Error,
          'constraint-max-length'
        )
      );
    }
    if (constraints.pattern !== undefined) {
      const re = getCompiledPattern(constraints.pattern);
      if (re === null) {
        attachDiagnostic(
          node,
          lintDiagnostic(
            range,
            `'${fieldName}' has invalid constraint pattern: /${constraints.pattern}/`,
            DiagnosticSeverity.Warning,
            'constraint-invalid-pattern'
          )
        );
      } else if (!re.test(raw)) {
        attachDiagnostic(
          node,
          lintDiagnostic(
            range,
            `'${fieldName}' must match pattern /${constraints.pattern}/`,
            DiagnosticSeverity.Error,
            'constraint-pattern'
          )
        );
      }
    }
  }
}

export const constraintValidationKey = storeKey<ReadonlySet<AstNodeLike>>(
  'constraint-validation'
);

class ConstraintValidationPass implements LintPass {
  readonly id = constraintValidationKey;
  readonly description =
    'Validates field values against JSON Schema-style constraints (min, max, pattern, enum, etc.)';
  readonly requires = [schemaContextKey];

  run(store: PassStore, root: AstRoot): void {
    const ctx = store.get(schemaContextKey);
    if (!ctx) return;

    if (lastSchemaContext !== ctx) {
      patternCache.clear();
      lastSchemaContext = ctx;
    }

    const validatedRefs = new Set<AstNodeLike>();

    walkSchema(root, ctx.info.schema, {
      visitField(value: unknown, fieldType: FieldType, fieldName: string) {
        if (value === undefined) return;

        const constraints = getConstraints(fieldType);
        if (constraints) {
          validateConstraints(
            value,
            constraints,
            fieldName,
            validatedRefs,
            ctx
          );
        }
      },
    });

    // Publish the set of expression nodes already validated by constraint
    // checks (e.g., allowedNamespaces). Downstream passes like
    // undefined-reference use this to avoid duplicate diagnostics.
    store.set(constraintValidationKey, validatedRefs);
  }
}

export function constraintValidationPass(): LintPass {
  return new ConstraintValidationPass();
}
