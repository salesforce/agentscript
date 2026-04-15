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
 * Walk the ancestor chain bottom-up looking for a definition container
 * (a block holding a NamedMap keyed by `namespace`) that defines `name`.
 *
 * For scoped namespaces (e.g., `@actions` requires a `subagent` scope),
 * only ancestors that introduce the required scope are accepted. A nested
 * binding map like `reasoning.actions` — whose parent `reasoning` block
 * has no scope — is skipped entirely and the walk continues outward to
 * `topic.actions`. This mirrors `collectNamespaceMaps` in scope.ts and
 * ensures `RefreshToken: @actions.GetToken` inside `reasoning.actions`
 * resolves against the topic-level action definition.
 *
 * For unscoped namespaces (e.g., `@subagent`, `@variables`), any ancestor
 * with a matching map is accepted.
 */
function resolveInAncestors(
  ancestors: readonly unknown[],
  namespace: string,
  name: string,
  schemaCtx: SchemaContext
): boolean {
  const scopesRequired = schemaCtx.scopedNamespaces.get(namespace);

  for (let i = ancestors.length - 1; i >= 0; i--) {
    const obj = ancestors[i];
    if (!isAstNodeLike(obj) || isNamedMap(obj)) continue;

    // Scoped namespaces must be anchored on a block that introduces one
    // of the required scopes. Intermediate non-scope blocks (like
    // reasoning) cannot host a valid @N.X definition, even if they
    // happen to hold a map with that name. Peer root scopes (e.g.,
    // `topic` and `subagent` in AgentForce) are both acceptable hosts,
    // so membership is checked against the full set.
    if (scopesRequired) {
      if (!obj.__scope || !scopesRequired.has(obj.__scope)) continue;
    }

    const map = obj[namespace];
    if (isNamedMap(map) && map.has(name)) {
      return true;
    }
  }
  return false;
}

/**
 * Walk the ancestor chain above `startIndex` looking for a NamedMap keyed by
 * `ref.namespace` that contains an entry named `ref.property`.
 *
 * Scoped namespaces (e.g. `@actions` → `subagent` scope) only match on
 * ancestors that introduce the required scope. This skips nested binding
 * containers like `reasoning.actions` and walks outward to the
 * scope-introducing block's real definition map — so a reasoning binding
 * `Refresh: @actions.GetToken` resolves against `topic.actions.GetToken`
 * (with its real outputs) instead of the sibling reasoning binding
 * (with none).
 *
 * Returns the resolved block, or `undefined` if no match was found.
 */
function findReferencedBlock(
  ancestors: readonly unknown[],
  startIndex: number,
  ref: { namespace: string; property: string },
  schemaCtx: SchemaContext
): AstNodeLike | undefined {
  const scopesRequired = schemaCtx.scopedNamespaces.get(ref.namespace);

  for (let j = startIndex - 1; j >= 0; j--) {
    const parent = ancestors[j];
    if (!isAstNodeLike(parent) || isNamedMap(parent)) continue;

    if (scopesRequired) {
      if (!parent.__scope || !scopesRequired.has(parent.__scope)) continue;
    }

    const refMap = parent[ref.namespace];
    if (!isNamedMap(refMap)) continue;

    const refBlock = refMap.get(ref.property);
    if (isAstNodeLike(refBlock)) return refBlock;
  }
  return undefined;
}

/**
 * True when the RunStatement at `ancestors[runIdx]` is "transparent" for
 * @outputs resolution — i.e. the expression lives inside a `with` clause
 * of that run.
 *
 * Semantics: `with X = Y` on a nested `run @actions.Inner` passes Y as an
 * INPUT to `Inner`. That value comes from whatever was produced BEFORE
 * the run — so `@outputs` on the RHS of `with` refers to the enclosing
 * binding's action (outer), NOT the run target (inner). Only `set`
 * clauses (which capture Inner's return values) resolve against the run
 * target.
 *
 * The body of a RunStatement is a `Statement[]` — not an AstNodeLike —
 * so `walkNode` recurses through items without pushing the array. That
 * means the direct child frame (ancestors[runIdx + 1]) is the WithClause
 * / SetClause statement itself, which is exactly the disambiguator we
 * need here.
 */
function isRunTransparentForOutputs(
  ancestors: readonly unknown[],
  runIdx: number
): boolean {
  const next = ancestors[runIdx + 1];
  return isAstNodeLike(next) && next.__kind === 'WithClause';
}

/**
 * If the expression sits inside a nested `run @actions.X` that is closer
 * (deeper in the ancestor chain) than any enclosing scoped colinear block,
 * return the run target's members for `namespace`. Otherwise return
 * `undefined` — meaning "no override, use normal resolution".
 *
 * This handles the case where a reasoning action binding and the action
 * it calls share a name:
 *
 *     actions:
 *       Knowledge_Retrieval: @actions.Knowledge_Retrieval
 *         set @variables.x = @outputs.promptResponse       # resolves to outer
 *         run @actions.Confidence_Check
 *           with emailCaseId = @outputs.promptResponse     # resolves to OUTER (with RHS)
 *           set @variables.y = @outputs.evaluationResult   # resolves to INNER (set RHS)
 *
 * In that layout, `getSymbolMembers` finds the outer's outputs via the
 * scope chain (because the binding name matches), so the colinear fallback
 * inside {@link resolveColinearCandidates} is never reached. This override
 * intercepts earlier and uses the inner run target when the RunStatement
 * is the innermost frame between the expression and the scoped ancestor —
 * UNLESS the expression is inside a `with` clause of that run, in which
 * case the RunStatement is transparent and we fall through to the outer
 * scope (normal resolution).
 */
function resolveNestedRunOverride(
  ancestors: readonly unknown[],
  namespace: string,
  schemaCtx: SchemaContext
): string[] | undefined {
  const scopesRequired = schemaCtx.scopedNamespaces.get(namespace);
  // Nested-run override only applies to namespaces scoped to individual
  // action-call frames (e.g. @outputs). Peer root scopes like
  // topic/subagent are not action-call frames, so we gate strictly on
  // the `action` scope.
  if (!scopesRequired?.has('action')) return undefined;

  for (let i = ancestors.length - 1; i >= 0; i--) {
    const obj = ancestors[i];
    if (!isAstNodeLike(obj) || isNamedMap(obj)) continue;

    // Found a scoped colinear ancestor before any RunStatement — no override.
    // Normal resolution (symbol-based or colinear fallback) owns this case.
    if (obj.__scope && scopesRequired.has(obj.__scope)) return undefined;

    if (obj.__kind !== 'RunStatement') continue;

    // `with X = @outputs.Y` inside a nested run: the run is transparent,
    // keep walking outward to the enclosing scope.
    if (isRunTransparentForOutputs(ancestors, i)) continue;

    const target = (obj as { target?: unknown }).target;
    if (!target || typeof target !== 'object') continue;

    const ref = decomposeAtMemberExpression(target);
    if (!ref) continue;

    const refBlock = findReferencedBlock(ancestors, i, ref, schemaCtx);
    if (!refBlock) return undefined;

    const nsMap = refBlock[namespace];
    if (isNamedMap(nsMap)) {
      return [...nsMap.keys()];
    }
    return [];
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
 * Only the innermost colinear frame at the correct scope level is considered.
 * Two kinds of frames contribute:
 *
 * 1. Scoped colinear blocks — an ancestor with `__scope === requiredScope`
 *    whose `.value` is an @-reference (e.g. `foo: @actions.fetch_data` in
 *    `reasoning.actions`). This is the standard case.
 *
 * 2. `RunStatement` nodes — a nested `run @actions.inner` inside an action
 *    binding body establishes a NEW action-scope frame. Inside its body,
 *    `@outputs.X` must resolve against `inner`'s outputs, not the enclosing
 *    binding's target. The RunStatement has no `__scope` tag, but its
 *    `.target` plays the same role as a scoped block's `.value`. This is
 *    gated to `requiredScope === 'action'` — RunStatement introduces an
 *    action-call frame and doesn't provide scope for anything else.
 *
 * The walk stops at the innermost matching frame, so a deeply nested
 * `run @actions.inner` inside `run @actions.middle` inside
 * `outerBinding: @actions.outer` will resolve `@outputs` against `inner`.
 *
 * Returns the candidate member names from the referenced block's namespace,
 * or `undefined` if no colinear frame was found in the ancestor chain.
 */
function resolveColinearCandidates(
  ancestors: readonly unknown[],
  namespace: string,
  schemaCtx: SchemaContext
): string[] | undefined {
  const scopesRequired = schemaCtx.scopedNamespaces.get(namespace);
  if (!scopesRequired || scopesRequired.size === 0) return undefined;

  for (let i = ancestors.length - 1; i >= 0; i--) {
    const obj = ancestors[i];
    if (!isAstNodeLike(obj) || isNamedMap(obj)) continue;

    const node = obj;

    // RunStatement frame: a nested `run @actions.X` establishes a new
    // action-scope for its body. Its `.target` is the colinear reference.
    // Gated to 'action' — RunStatement only provides action-call scope.
    //
    // Transparency rule: if the expression is inside a `with` clause of
    // this run, the run is transparent — keep walking outward. `with` RHS
    // passes inputs TO the run and references the OUTER scope's outputs.
    // See `isRunTransparentForOutputs` for the full semantic note.
    if (
      node.__kind === 'RunStatement' &&
      scopesRequired.has('action') &&
      !isRunTransparentForOutputs(ancestors, i)
    ) {
      const target = (node as { target?: unknown }).target;
      if (!target || typeof target !== 'object') continue;

      const ref = decomposeAtMemberExpression(target);
      if (!ref) continue;

      const refBlock = findReferencedBlock(ancestors, i, ref, schemaCtx);
      if (!refBlock) return undefined;

      const nsMap = refBlock[namespace];
      if (isNamedMap(nsMap)) {
        return [...nsMap.keys()];
      }
      return [];
    }

    // Only consider ancestors at a scope level that hosts this namespace.
    if (!node.__scope || !scopesRequired.has(node.__scope)) continue;

    // Check if this block has a colinear reference (e.g., @actions.fetch_data)
    const value = node.value;
    if (!value || typeof value !== 'object') continue;

    const ref = decomposeAtMemberExpression(value);
    if (!ref) continue;

    // Found a colinear reference at the right scope level. Resolve the referenced block.
    const refBlock = findReferencedBlock(ancestors, i, ref, schemaCtx);
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

  // Nested `run @actions.X` override: when a scoped namespace reference
  // (e.g. @outputs) sits inside a RunStatement body AND that RunStatement
  // is the innermost relevant frame in the ancestor chain, resolve
  // against the run target — not the enclosing scope's action.
  //
  // This MUST run before symbol-based resolution because when the
  // enclosing binding name matches the outer action's name (as in the
  // v17.agent Preboarding script), getSymbolMembers finds the outer
  // action's outputs via scope-chain resolution and the colinear fallback
  // path never fires. The override intercepts that case.
  //
  // Why gate on colinear-resolvable scoped namespaces: only namespaces
  // like @outputs are resolved colinearly off an action reference. Other
  // scoped namespaces (e.g. @variables) aren't action-colinear and
  // shouldn't be overridden by a run target.
  if (
    schemaCtx.scopedNamespaces.has(namespace) &&
    schemaCtx.colinearResolvedScopes.has(namespace)
  ) {
    const runOverride = resolveNestedRunOverride(
      ancestors,
      namespace,
      schemaCtx
    );
    if (runOverride !== undefined) {
      if (runOverride.includes(property)) return { kind: 'resolved' };
      return { kind: 'colinear-miss', members: runOverride };
    }
  }

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
    if (resolveInAncestors(ancestors, namespace, property, schemaCtx)) {
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
