/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { CstMeta, AstNodeLike, Range } from '../core/types.js';
import { isNamedMap, isAstNodeLike } from '../core/types.js';
import type { AstRoot } from '../core/types.js';
import {
  storeKey,
  schemaContextKey,
  type LintPass,
  type PassStore,
  type ScopeContext,
  type SchemaContext,
  type DocumentSymbol,
  resolveReference,
  getSymbolMembers,
  getSchemaNamespaces,
} from '../core/analysis/index.js';
import {
  undefinedReferenceDiagnostic,
  attachDiagnostic,
  type Diagnostic,
} from '../core/diagnostics.js';
import { decomposeAtMemberExpression } from '../core/expressions.js';
import { symbolTableKey } from './symbol-table.js';
import { constraintValidationKey } from './constraint-validation.js';
import { findSuggestion } from './lint-utils.js';

interface PendingCheck {
  expr: AstNodeLike;
  namespace: string;
  property: string;
  ctx: ScopeContext;
  ancestors: unknown[];
}

type ResolutionResult =
  | { kind: 'resolved' }
  | { kind: 'skip-validated' }
  | { kind: 'skip-schema-key' }
  | { kind: 'skip-colinear-unresolvable' }
  | { kind: 'global-miss'; members: string[] }
  | { kind: 'unknown-namespace'; knownNamespaces: string[] }
  | { kind: 'non-referenceable-scope' }
  | { kind: 'colinear-miss'; members: string[] }
  | { kind: 'standard-miss'; candidates: string[] };

interface ResolutionContext {
  readonly symbols: DocumentSymbol[];
  readonly schemaCtx: SchemaContext;
  readonly validatedRefs: ReadonlySet<AstNodeLike>;
  readonly root: AstRoot;
}

/**
 * Walk the ancestor chain bottom-up looking for a Map property named
 * `namespace` that contains `name`. Schema-agnostic.
 *
 * Skips self-resolution: when the found NamedMap is the container of the
 * current node AND the current node is the same entry being referenced, the
 * match is skipped. This prevents `CloseCase: @actions.CloseCase` in
 * `reasoning.actions` from resolving against itself instead of `topic.actions`.
 */
function resolveInAncestors(
  ancestors: readonly unknown[],
  namespace: string,
  name: string
): boolean {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const obj = ancestors[i];
    if (!isAstNodeLike(obj) || isNamedMap(obj)) continue;

    const map = obj[namespace];
    if (isNamedMap(map) && map.has(name)) {
      // Skip self-references: the map is our container (next ancestor) AND
      // the block we're inside (ancestor after the map) IS the entry being
      // referenced. This catches `CloseCase: @actions.CloseCase` but not
      // `go: @subagent.greeting` (where we're inside `main`, not `greeting`).
      if (
        i + 2 < ancestors.length &&
        ancestors[i + 1] === map &&
        isAstNodeLike(ancestors[i + 2]) &&
        map.get(name) === ancestors[i + 2]
      ) {
        continue;
      }
      return true;
    }
  }
  return false;
}

/**
 * Walk the ancestor chain above `startIndex` looking for a NamedMap keyed by
 * `ref.namespace` that contains an entry named `ref.property`.
 *
 * Returns the resolved block, or `undefined` if no match was found.
 */
function findReferencedBlock(
  ancestors: readonly unknown[],
  startIndex: number,
  ref: { namespace: string; property: string }
): AstNodeLike | undefined {
  for (let j = startIndex - 1; j >= 0; j--) {
    const parent = ancestors[j];
    if (!isAstNodeLike(parent) || isNamedMap(parent)) continue;

    const refMap = parent[ref.namespace];
    if (!isNamedMap(refMap)) continue;

    const refBlock = refMap.get(ref.property);
    if (isAstNodeLike(refBlock)) return refBlock;
  }
  return undefined;
}

/**
 * Resolve a scoped namespace (e.g., `@outputs`) through a colinear
 * reference in the ancestor chain.
 *
 * When a ReasoningActionBlock references `@actions.fetch_data`, expressions
 * inside it like `@outputs.result` should resolve against `fetch_data`'s
 * outputs — not the reasoning action's own (nonexistent) outputs.
 *
 * Only the innermost colinear block at the correct scope level is considered.
 * The `requiredScope` (from `scopedNamespaces`) ensures we only resolve through
 * ancestors that introduce the right scope — e.g., `@outputs` requires scope
 * `'action'`, so only ancestors with `__scope === 'action'` are eligible.
 *
 * Returns the candidate member names from the referenced block's namespace,
 * or `undefined` if no colinear block was found in the ancestor chain.
 */
function resolveColinearCandidates(
  ancestors: readonly unknown[],
  namespace: string,
  schemaCtx: SchemaContext
): string[] | undefined {
  const requiredScope = schemaCtx.scopedNamespaces.get(namespace);
  if (!requiredScope) return undefined;

  for (let i = ancestors.length - 1; i >= 0; i--) {
    const obj = ancestors[i];
    if (!isAstNodeLike(obj) || isNamedMap(obj)) continue;

    const node = obj;
    // Only consider ancestors at the correct scope level for this namespace.
    if (node.__scope !== requiredScope) continue;

    // Check if this block has a colinear reference (e.g., @actions.fetch_data)
    const value = node.value;
    if (!value || typeof value !== 'object') continue;

    const ref = decomposeAtMemberExpression(value);
    if (!ref) continue;

    // Found a colinear reference at the right scope level. Resolve the referenced block.
    const refBlock = findReferencedBlock(ancestors, i, ref);
    if (!refBlock) return undefined;

    // Return member names from the referenced block's namespace (e.g., outputs).
    const nsMap = refBlock[namespace];
    if (isNamedMap(nsMap)) {
      return [...nsMap.keys()];
    }

    // Referenced block exists but has no entries for this namespace
    return [];
  }

  return undefined;
}

/**
 * Check if the expression is inside a NamedMap container for the same namespace
 * that contains an entry with the same name AND the entry being referenced is
 * the same block the expression lives in — i.e., a self-referencing colinear
 * value like `CloseCase: @actions.CloseCase` inside `reasoning.actions`.
 *
 * This prevents reasoning action entries from resolving against their own container
 * instead of the parent block's action definitions (e.g., `topic.actions`).
 */
function isSelfReference(
  ancestors: readonly unknown[],
  namespace: string,
  property: string
): boolean {
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const obj = ancestors[i];
    if (!isAstNodeLike(obj) || isNamedMap(obj)) continue;

    const map = obj[namespace];
    if (isNamedMap(map) && map.has(property)) {
      // Check: the map is our container AND the block we're inside IS the
      // referenced entry. This catches `CloseCase: @actions.CloseCase` but
      // not `go: @subagent.greeting` (where we're inside `main`, not `greeting`).
      if (
        i + 2 < ancestors.length &&
        ancestors[i + 1] === map &&
        isAstNodeLike(ancestors[i + 2]) &&
        map.get(property) === ancestors[i + 2]
      ) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Determine the resolution outcome for a single @namespace.property reference.
 * Pure function — no side effects, no diagnostics attached.
 */
function resolveCheck(
  check: PendingCheck,
  rctx: ResolutionContext
): ResolutionResult {
  const { expr, namespace, property, ctx, ancestors } = check;
  const { symbols, schemaCtx, validatedRefs, root } = rctx;

  // Skip nodes already validated by constraint checks (e.g., allowedNamespaces).
  // This must be first to avoid duplicate diagnostics regardless of whether
  // the namespace has document-defined members.
  if (validatedRefs.has(expr)) return { kind: 'skip-validated' };

  const candidates = getSymbolMembers(symbols, namespace, schemaCtx, ctx);
  const globalMembers = schemaCtx.globalScopes.get(namespace);

  // Detect self-referencing colinear values. When `CloseCase: @actions.CloseCase`
  // appears inside `reasoning.actions`, the symbol tree and ancestor chain can
  // both find `CloseCase` in `reasoning.actions` — but it's resolving against
  // itself, not against `topic.actions`. In that case, symbol-based resolution
  // must be skipped so the reference is validated against actual definitions.
  const selfRef = isSelfReference(ancestors, namespace, property);

  // Document-defined members take priority, but global scope members are still
  // valid in mixed namespaces (e.g. local tool aliases + global @tools.<def>).
  if (candidates !== null) {
    if (resolveInAncestors(ancestors, namespace, property)) {
      return { kind: 'resolved' };
    }

    // Skip symbol-based resolution for self-references — resolveReference uses
    // findNamespaceSymbol which recurses into intermediate Namespace children
    // and would find the entry in its own container (e.g., reasoning.actions).
    if (!selfRef) {
      const resolved = resolveReference(
        root,
        namespace,
        property,
        schemaCtx,
        ctx,
        symbols
      );
      if (resolved) return { kind: 'resolved' };
    }

    // Allow global scope members even when local/document members exist.
    // A '*' member means any identifier is allowed in this namespace.
    if (globalMembers) {
      if (globalMembers.has(property) || globalMembers.has('*')) {
        return { kind: 'resolved' };
      }
    }

    // For self-references, filter out the self-referencing entry from candidates
    // so the diagnostic doesn't suggest the entry itself.
    if (selfRef) {
      const filtered = candidates.filter(c => c !== property);
      return { kind: 'standard-miss', candidates: filtered };
    }

    return { kind: 'standard-miss', candidates };
  }

  // Namespace has no document-defined members (candidates === null).

  // Fallback: global scope — validate against statically known members
  if (globalMembers) {
    if (globalMembers.has(property) || globalMembers.has('*')) {
      return { kind: 'resolved' };
    }
    return { kind: 'global-miss', members: [...globalMembers] };
  }

  const isSchemaKey = getSchemaNamespaces(schemaCtx).has(namespace);
  const isScopedNs = schemaCtx.scopedNamespaces.has(namespace);

  if (isScopedNs) {
    if (!schemaCtx.colinearResolvedScopes.has(namespace)) {
      return { kind: 'non-referenceable-scope' };
    }

    const colinearMembers = resolveColinearCandidates(
      ancestors,
      namespace,
      schemaCtx
    );
    if (colinearMembers === undefined) {
      return { kind: 'skip-colinear-unresolvable' };
    }
    if (colinearMembers.includes(property)) return { kind: 'resolved' };
    return { kind: 'colinear-miss', members: colinearMembers };
  }

  if (!isSchemaKey) {
    const knownNamespaces = [
      ...getSchemaNamespaces(schemaCtx),
      ...schemaCtx.globalScopes.keys(),
    ];
    return { kind: 'unknown-namespace', knownNamespaces };
  }

  return { kind: 'skip-schema-key' };
}

/**
 * Map a non-resolved ResolutionResult to a Diagnostic.
 * Returns undefined for resolved/skip outcomes.
 */
function formatResolutionDiagnostic(
  result: ResolutionResult,
  namespace: string,
  property: string,
  range: Range
): Diagnostic | undefined {
  const referenceName = `@${namespace}.${property}`;

  switch (result.kind) {
    case 'resolved':
    case 'skip-validated':
    case 'skip-schema-key':
    case 'skip-colinear-unresolvable':
      return undefined;

    case 'global-miss': {
      const suggestion = findSuggestion(property, result.members);
      return undefinedReferenceDiagnostic(
        range,
        `'${property}' is not defined in ${namespace}`,
        referenceName,
        suggestion,
        result.members
      );
    }

    case 'unknown-namespace': {
      const suggestion = findSuggestion(namespace, result.knownNamespaces);
      return undefinedReferenceDiagnostic(
        range,
        `'@${namespace}' is not a recognized namespace`,
        referenceName,
        suggestion,
        result.knownNamespaces
      );
    }

    case 'non-referenceable-scope':
      return undefinedReferenceDiagnostic(
        range,
        `'@${namespace}' cannot be used as a reference. ` +
          `This namespace is scoped to its parent block and is not directly referenceable`,
        referenceName
      );

    case 'colinear-miss': {
      const suggestion = findSuggestion(property, result.members);
      return undefinedReferenceDiagnostic(
        range,
        `'${property}' is not defined in ${namespace}`,
        referenceName,
        suggestion,
        result.members
      );
    }

    case 'standard-miss': {
      const suggestion = findSuggestion(property, result.candidates);
      return undefinedReferenceDiagnostic(
        range,
        `'${property}' is not defined in ${namespace}`,
        referenceName,
        suggestion,
        result.candidates
      );
    }
  }
}

class UndefinedReferencePass implements LintPass {
  readonly id = storeKey('undefined-reference');
  readonly description =
    'Validates that @namespace.member references point to defined symbols';
  readonly requires = [symbolTableKey, constraintValidationKey];

  private pendingChecks: PendingCheck[] = [];
  private ancestorStack: unknown[] = [];

  init(): void {
    this.pendingChecks = [];
    this.ancestorStack = [];
  }

  enterNode(_key: string, value: unknown): void {
    this.ancestorStack.push(value);
  }

  exitNode(): void {
    this.ancestorStack.pop();
  }

  visitExpression(expr: AstNodeLike, ctx: ScopeContext): void {
    const decomposed = decomposeAtMemberExpression(expr);
    if (!decomposed) return;

    this.pendingChecks.push({
      expr,
      namespace: decomposed.namespace,
      property: decomposed.property,
      ctx,
      ancestors: [...this.ancestorStack],
    });
  }

  run(store: PassStore, root: AstRoot): void {
    const symbols = store.get(symbolTableKey) ?? [];
    const schemaCtx = store.get(schemaContextKey);
    if (!schemaCtx) return;

    const validatedRefs = store.get(constraintValidationKey);
    if (!validatedRefs) {
      throw new Error(
        'undefined-reference pass requires constraint-validation to run first. ' +
          'Ensure constraintValidationPass is included and listed before undefinedReferencePass.'
      );
    }
    const rctx: ResolutionContext = { symbols, schemaCtx, validatedRefs, root };

    for (const check of this.pendingChecks) {
      const result = resolveCheck(check, rctx);

      const cst: CstMeta | undefined = check.expr.__cst;
      if (!cst) continue;

      const diagnostic = formatResolutionDiagnostic(
        result,
        check.namespace,
        check.property,
        cst.range
      );
      if (diagnostic) {
        attachDiagnostic(check.expr, diagnostic);
      }
    }
  }
}

export function undefinedReferencePass(): LintPass {
  return new UndefinedReferencePass();
}
