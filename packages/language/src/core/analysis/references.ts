/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { Range, AstRoot, AstNodeLike } from '../types.js';
import { SymbolKind, astField, isNamedMap, isAstNodeLike } from '../types.js';
import {
  computeRanges,
  findSymbolEntry,
  type DocumentSymbol,
} from './symbols.js';
import {
  getScopedNamespaces,
  findScopeBlock,
  collectNamespaceMaps,
  resolveNamespaceKeys,
  updateScopeContext,
  activeScopeForNamespace,
} from './scope.js';
import type { ScopeContext, SchemaContext } from './scope.js';
import {
  isPositionInRange,
  rangeSize,
  findMappingElement,
} from './ast-utils.js';
import { walkAstExpressions } from './ast-walkers.js';
import { decomposeAtMemberExpression } from '../expressions.js';
import { toRange } from '../types.js';
import type { PositionIndex } from './position-index.js';
import { queryDefinitionAtPosition } from './position-index.js';

/** A resolved reference pointing to a definition in the AST. */
export interface ResolvedReference {
  namespace: string;
  name: string;
  symbolKind: SymbolKind;
  /** Key range for cursor placement on go-to-definition. */
  definitionRange: Range;
  fullRange: Range;
}

/** A reference occurrence found by findAllReferences. */
export interface ReferenceOccurrence {
  range: Range;
  /** Range covering only the property/name portion (for rename). */
  nameRange: Range;
  isDefinition: boolean;
}

/** Result of a definition lookup, with optional failure reason. */
export interface DefinitionResult {
  definition: ResolvedReference | null;
  reason?: string;
}

interface DecomposedReference {
  namespace: string;
  name: string;
  range: Range;
  /** Range covering only the property/name portion. */
  nameRange: Range;
  scope: ScopeContext;
}

/**
 * Find the definition of the reference at the given position.
 *
 * When `symbols` is provided, uses the pre-computed symbol tree
 * to resolve definitions without re-walking the AST.
 */
export function findDefinitionAtPosition(
  ast: AstRoot,
  line: number,
  character: number,
  ctx: SchemaContext,
  symbols?: DocumentSymbol[],
  index?: PositionIndex
): DefinitionResult {
  const ref = findRefExpressionAtPosition(ast, line, character, index);
  if (ref) {
    return resolveWithReason(ast, ref, ctx, symbols);
  }

  const def = findDefinitionKeyAtPosition(ast, line, character, index);
  if (def) {
    return resolveWithReason(ast, def, ctx, symbols);
  }

  return {
    definition: null,
    reason: 'Cursor is not on a reference or definition key',
  };
}

function resolveWithReason(
  ast: AstRoot,
  ref: DecomposedReference,
  ctx: SchemaContext,
  symbols?: DocumentSymbol[]
): DefinitionResult {
  const scopesRequired = getScopedNamespaces(ctx).get(ref.namespace);
  if (scopesRequired && !activeScopeForNamespace(scopesRequired, ref.scope)) {
    const list = [...scopesRequired].join(' or ');
    return {
      definition: null,
      reason: `'@${ref.namespace}.${ref.name}' requires ${list} scope (cursor is outside a ${list} block)`,
    };
  }

  const definition = resolveReference(
    ast,
    ref.namespace,
    ref.name,
    ctx,
    ref.scope,
    symbols
  );

  if (!definition) {
    return {
      definition: null,
      reason: `'${ref.name}' is not defined in namespace '${ref.namespace}'`,
    };
  }

  return { definition };
}

/**
 * Find all references to the symbol at the given position.
 * Works when the cursor is on either a reference expression or a definition key.
 */
export function findReferencesAtPosition(
  ast: AstRoot,
  line: number,
  character: number,
  includeDeclaration: boolean,
  ctx: SchemaContext,
  symbols?: DocumentSymbol[],
  index?: PositionIndex
): ReferenceOccurrence[] {
  const ref = findRefExpressionAtPosition(ast, line, character, index);
  const def = ref
    ? null
    : findDefinitionKeyAtPosition(ast, line, character, index);

  const target = ref ?? def;
  if (!target) return [];

  return findAllReferences(
    ast,
    target.namespace,
    target.name,
    ctx,
    target.scope,
    includeDeclaration,
    symbols
  );
}

/**
 * Resolve a namespace + name reference to its definition in the AST.
 * Uses the pre-computed symbol tree when available for fast lookup.
 */
export function resolveReference(
  ast: AstRoot,
  namespace: string,
  name: string,
  ctx: SchemaContext,
  scope?: ScopeContext,
  symbols?: DocumentSymbol[]
): ResolvedReference | null {
  if (symbols) {
    const entry = findSymbolEntry(symbols, namespace, name, ctx, scope);
    if (entry) {
      return {
        namespace,
        name,
        symbolKind: entry.kind,
        definitionRange: entry.selectionRange,
        fullRange: entry.range,
      };
    }
  }

  const scopesRequired = getScopedNamespaces(ctx).get(namespace);
  const activeScope = activeScopeForNamespace(scopesRequired, scope);

  if (activeScope && scope) {
    return resolveFromScopedChild(
      ast,
      namespace,
      name,
      activeScope,
      scope,
      ctx
    );
  }

  return resolveFromRoot(ast, namespace, name, ctx);
}

/**
 * Find all occurrences of a reference to the given namespace + name.
 *
 * Expression references always require an AST walk. The declaration
 * lookup uses the symbol tree when available.
 */
export function findAllReferences(
  ast: AstRoot,
  namespace: string,
  name: string,
  ctx: SchemaContext,
  scope?: ScopeContext,
  includeDeclaration = true,
  symbols?: DocumentSymbol[]
): ReferenceOccurrence[] {
  const occurrences: ReferenceOccurrence[] = [];
  const scopesRequired = getScopedNamespaces(ctx).get(namespace);
  const activeScope = activeScopeForNamespace(scopesRequired, scope);

  walkAstExpressions(ast, (expr, walkCtx) => {
    const decomposed = decomposeExpression(expr, walkCtx);
    if (!decomposed) return;
    if (decomposed.namespace !== namespace || decomposed.name !== name) return;

    if (activeScope && scope) {
      if (walkCtx[activeScope] !== scope[activeScope]) return;
    }

    occurrences.push({
      range: decomposed.range,
      nameRange: decomposed.nameRange,
      isDefinition: false,
    });
  });

  if (includeDeclaration) {
    const def = resolveReference(ast, namespace, name, ctx, scope, symbols);
    if (def) {
      occurrences.push({
        range: def.definitionRange,
        nameRange: def.definitionRange,
        isDefinition: true,
      });
    }
  }

  return occurrences;
}

/**
 * Find the @ reference expression at the given position.
 * Uses smallest-range heuristic when doing a full AST walk.
 */
function findRefExpressionAtPosition(
  ast: AstRoot,
  line: number,
  character: number,
  index?: PositionIndex
): DecomposedReference | null {
  if (index) {
    // Must filter to decomposable expressions before applying smallest-range
    // heuristic. Without this, a non-decomposable child (e.g. AtIdentifier)
    // can shadow a valid parent (e.g. MemberExpression) at the same position.
    let best: DecomposedReference | null = null;
    let bestSize = Infinity;
    for (const entry of index.expressions) {
      if (!isPositionInRange(line, character, entry.range)) continue;
      const decomposed = decomposeExpression(entry.expr, entry.scope);
      if (!decomposed) continue;
      const size = rangeSize(entry.range);
      if (size < bestSize) {
        best = decomposed;
        bestSize = size;
      }
    }
    return best;
  }

  let best: DecomposedReference | null = null;
  let bestSize = Infinity;

  walkAstExpressions(ast, (expr, ctx) => {
    const cst = expr.__cst;
    if (!cst) return;

    if (!isPositionInRange(line, character, cst.range)) return;

    const decomposed = decomposeExpression(expr, ctx);
    if (!decomposed) return;

    const size = rangeSize(cst.range);
    if (size < bestSize) {
      best = decomposed;
      bestSize = size;
    }
  });

  return best;
}

/** Find a definition key at the given position. */
function findDefinitionKeyAtPosition(
  ast: AstRoot,
  line: number,
  character: number,
  index?: PositionIndex
): DecomposedReference | null {
  if (index) {
    const entry = queryDefinitionAtPosition(index, line, character);
    if (!entry) return null;
    return {
      namespace: entry.namespace,
      name: entry.name,
      range: entry.fullRange,
      nameRange: entry.keyRange,
      scope: entry.scope,
    };
  }

  let best: DecomposedReference | null = null;
  let bestSize = Infinity;

  walkDefinitionKeys(ast, (namespace, name, keyRange, fullRange, ctx) => {
    if (!isPositionInRange(line, character, keyRange)) return;

    const size = rangeSize(keyRange);
    if (size < bestSize) {
      best = {
        namespace,
        name,
        range: fullRange,
        nameRange: keyRange,
        scope: ctx,
      };
      bestSize = size;
    }
  });

  return best;
}

/** Walk the AST visiting all definition keys (NamedMap entries, named blocks). */
export function walkDefinitionKeys(
  ast: AstRoot,
  callback: (
    namespace: string,
    name: string,
    keyRange: Range,
    fullRange: Range,
    ctx: ScopeContext
  ) => void
): void {
  walkDefinitionKeysInner(ast, callback, {}, undefined, new Set());
}

function walkDefinitionKeysInner(
  value: unknown,
  callback: (
    namespace: string,
    name: string,
    keyRange: Range,
    fullRange: Range,
    ctx: ScopeContext
  ) => void,
  ctx: ScopeContext,
  parentNamespace: string | undefined,
  visited: Set<unknown>
): void {
  if (!value || typeof value !== 'object') return;
  if (visited.has(value)) return;
  visited.add(value);

  if (isNamedMap(value)) {
    // For NamedMap, updateScopeContext needs AstNodeLike. NamedMap entries
    // introduce scope, not the map itself, so we pass ctx through directly.
    for (const [entryName, entry] of value) {
      if (!isAstNodeLike(entry)) continue;
      const entryCst = entry.__cst;
      if (!entryCst) continue;

      const entryCtx = updateScopeContext(entry, ctx);

      const ns = parentNamespace ?? '';
      if (ns) {
        const { range, selectionRange } = computeRanges(entryCst);
        callback(ns, entryName, selectionRange, range, entryCtx);
      }

      walkDefinitionKeysInner(entry, callback, entryCtx, undefined, visited);
    }
    return;
  }

  if (!isAstNodeLike(value)) return;

  const newCtx = updateScopeContext(value, ctx);

  for (const [key, val] of Object.entries(value)) {
    if (key.startsWith('__')) continue;
    if (!val || typeof val !== 'object') continue;

    if (isNamedMap(val)) {
      // Key name becomes the namespace for entries within this map
      walkDefinitionKeysInner(val, callback, newCtx, key, visited);
    } else if (isAstNodeLike(val)) {
      // Singular Block containers (e.g., knowledge, system): treat as namespace
      if (!parentNamespace && val.__kind && val.__symbol) {
        walkDefinitionKeysInner(val, callback, newCtx, key, visited);
      } else if (parentNamespace) {
        const valCst = val.__cst;
        if (valCst) {
          // Walk up to mapping_element for proper key/full ranges
          const mappingNode = findMappingElement(valCst.node);
          const { range, selectionRange } = mappingNode
            ? computeRanges({ ...valCst, node: mappingNode })
            : computeRanges(valCst);
          callback(parentNamespace, key, selectionRange, range, newCtx);
        }
        walkDefinitionKeysInner(val, callback, newCtx, undefined, visited);
      } else {
        walkDefinitionKeysInner(val, callback, newCtx, undefined, visited);
      }
    }
  }
}

/**
 * Resolve a reference from the AST root.
 * Uses resolveNamespaceKeys() for alias resolution.
 */
function resolveFromRoot(
  ast: AstRoot,
  namespace: string,
  name: string,
  ctx: SchemaContext
): ResolvedReference | null {
  for (const key of resolveNamespaceKeys(namespace, ctx)) {
    const container = astField(ast, key);
    if (!container) continue;

    if (isNamedMap(container)) {
      const entry = findMapEntry(container, name, namespace);
      if (entry) return entry;
    } else if (typeof container === 'object') {
      const entry = findBlockProperty(container, name, namespace);
      if (entry) return entry;
    }
  }

  return null;
}

/** Resolve a scoped reference by navigating the scope chain. */
function resolveFromScopedChild(
  ast: AstRoot,
  namespace: string,
  name: string,
  targetScope: string,
  scope: ScopeContext,
  ctx: SchemaContext
): ResolvedReference | null {
  const scopeBlock = findScopeBlock(ast, targetScope, scope, ctx);
  if (!scopeBlock) return null;

  for (const map of collectNamespaceMaps(scopeBlock, namespace)) {
    const entry = findMapEntry(map, name, namespace);
    if (entry) return entry;
  }

  return null;
}

function findMapEntry(
  container: unknown,
  name: string,
  namespace: string
): ResolvedReference | null {
  if (!isNamedMap(container)) return null;

  const entry = container.get(name);
  if (!isAstNodeLike(entry)) return null;

  const cst = entry.__cst;
  if (!cst) return null;

  const sym = entry.__symbol;
  const symbolKind = sym?.kind ?? SymbolKind.Property;
  const { range, selectionRange } = computeRanges(cst);

  return {
    namespace,
    name,
    symbolKind,
    definitionRange: selectionRange,
    fullRange: range,
  };
}

/** Find a property in a singular Block and return a ResolvedReference. */
function findBlockProperty(
  container: unknown,
  name: string,
  namespace: string
): ResolvedReference | null {
  if (!isAstNodeLike(container) || isNamedMap(container)) return null;
  if (name.startsWith('__')) return null;

  const field = container[name];
  if (!isAstNodeLike(field)) return null;

  const cst = field.__cst;
  if (!cst) return null;

  const sym = field.__symbol;
  const symbolKind = sym?.kind ?? SymbolKind.Property;

  // Walk up to mapping_element for proper key/full ranges
  const mappingNode = findMappingElement(cst.node);
  const { range, selectionRange } = mappingNode
    ? computeRanges({ ...cst, node: mappingNode })
    : computeRanges(cst);

  return {
    namespace,
    name,
    symbolKind,
    definitionRange: selectionRange,
    fullRange: range,
  };
}

/**
 * Decompose an expression into a namespace + name reference.
 * Returns null if the expression is not a resolvable @ reference.
 */
function decomposeExpression(
  expr: AstNodeLike,
  ctx: ScopeContext
): DecomposedReference | null {
  const decomposed = decomposeAtMemberExpression(expr);
  if (!decomposed) return null;

  const cst = expr.__cst;
  if (!cst) return null;

  const { range } = cst;
  // Use the CST 'id' child node for exact property range when available
  const propertyNode = cst.node.namedChildren.find(
    (n: { type: string }) => n.type === 'id'
  );
  const nameRange: Range = propertyNode
    ? toRange(propertyNode)
    : {
        start: {
          line: range.end.line,
          character: range.end.character - decomposed.property.length,
        },
        end: range.end,
      };

  return {
    namespace: decomposed.namespace,
    name: decomposed.property,
    range: range,
    nameRange,
    scope: ctx,
  };
}
