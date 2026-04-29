/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type {
  Range,
  CstMeta,
  SyntaxNode,
  AstRoot,
  AstNodeLike,
} from '../types.js';
import type { NamedMap } from '../block.js';
import type { UntypedBlock } from '../children.js';
import { isBlockChild } from '../children.js';
import { toRange, SymbolKind, isNamedMap, isAstNodeLike } from '../types.js';
import {
  resolveNamespaceKeys,
  getScopeNavigation,
  type ScopeContext,
  type ScopeNavInfo,
  type SchemaContext,
} from './scope.js';
import { computeDetail, isPositionInRange } from './ast-utils.js';

export enum SymbolTag {
  Deprecated = 1,
}

export interface DocumentSymbol {
  name: string;
  detail?: string;
  kind: SymbolKind;
  tags?: SymbolTag[];
  deprecated?: boolean;
  range: Range;
  selectionRange: Range;
  children?: DocumentSymbol[];
}

/**
 * Extract a hierarchical DocumentSymbol tree from a parsed AST.
 * Nodes without __cst are skipped.
 */
export function getDocumentSymbols(ast: AstRoot): DocumentSymbol[] {
  const symbols: DocumentSymbol[] = [];

  for (const [key, value] of Object.entries(ast)) {
    if (key.startsWith('__')) continue;
    if (value == null || typeof value !== 'object') continue;

    if (isNamedMap(value)) {
      const mapSymbols = processMap(key, value, true);
      for (const sym of mapSymbols) symbols.push(sym);
      continue;
    }

    const symbol = extractSymbol(key, value);
    if (symbol) symbols.push(symbol);
  }

  // Surface UntypedBlock entries from top-level __children
  const blockChildren = (ast as Record<string, unknown>).__children;
  if (Array.isArray(blockChildren)) {
    for (const child of blockChildren) {
      if (isBlockChild(child) && child.__type === 'untyped') {
        const sym = extractUntypedSymbol(child as UntypedBlock);
        if (sym) symbols.push(sym);
      }
    }
  }

  return symbols;
}

/**
 * Process a Map, distinguishing TypedMap (single block with __kind+__cst)
 * from NamedMap (collection of named entries).
 *
 * At root level, NamedMap entries are promoted directly (e.g., "topic main").
 * When nested, NamedMap entries are wrapped in a container symbol.
 */
function processMap(
  key: string,
  map: NamedMap<unknown>,
  isRoot: boolean
): DocumentSymbol[] {
  const sym = map.__symbol;
  const cst = map.__cst;

  // TypedMap: single block symbol with map entries as children
  if (sym && cst) {
    const symbolKind = sym.kind;
    const { range, selectionRange } = computeRanges(cst);
    const detail = computeDetail(map, map.__kind, cst);

    if (sym.noRecurse) {
      return [
        {
          name: key,
          kind: symbolKind,
          range,
          selectionRange,
          ...(detail ? { detail } : {}),
        },
      ];
    }

    const children: DocumentSymbol[] = [];
    for (const [entryName, entry] of map) {
      const entrySym = extractSymbol(entryName, entry);
      if (entrySym) children.push(entrySym);
    }

    return [
      {
        name: key,
        kind: symbolKind,
        range,
        selectionRange,
        ...(detail ? { detail } : {}),
        ...(children.length > 0 ? { children } : {}),
      },
    ];
  }

  // NamedMap at root: promote entries with "key entryName" naming
  if (isRoot) {
    const symbols: DocumentSymbol[] = [];
    for (const [entryName, entry] of map) {
      const entrySym = extractSymbol(`${key} ${entryName}`, entry);
      if (entrySym) symbols.push(entrySym);
    }
    return symbols;
  }

  // NamedMap nested: container symbol
  const containerSymbol = createMapContainerSymbol(key, map);
  return containerSymbol ? [containerSymbol] : [];
}

function extractSymbol(name: string, value: unknown): DocumentSymbol | null {
  if (!isAstNodeLike(value)) return null;

  const obj = value;
  const sym = obj.__symbol;
  const cst = obj.__cst;

  if (!cst) return null;

  const symbolKind = sym?.kind ?? SymbolKind.Property;
  const { range, selectionRange } = computeRanges(cst);
  const detail = computeDetail(obj, obj.__kind, cst);

  if (!sym || sym.noRecurse) {
    return {
      name,
      kind: symbolKind,
      range,
      selectionRange,
      ...(detail ? { detail } : {}),
    };
  }

  const children = extractChildren(obj);

  return {
    name,
    kind: symbolKind,
    range,
    selectionRange,
    ...(detail ? { detail } : {}),
    ...(children.length > 0 ? { children } : {}),
  };
}

function extractChildren(obj: AstNodeLike): DocumentSymbol[] {
  const children: DocumentSymbol[] = [];

  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith('__')) continue;
    if (value == null || typeof value !== 'object') continue;

    if (isNamedMap(value)) {
      const mapSymbols = processMap(key, value, false);
      for (const sym of mapSymbols) children.push(sym);
      continue;
    }

    const symbol = extractSymbol(key, value);
    if (symbol) children.push(symbol);
  }

  // Surface UntypedBlock entries from __children
  const blockChildren = obj.__children;
  if (Array.isArray(blockChildren)) {
    for (const child of blockChildren) {
      if (isBlockChild(child) && child.__type === 'untyped') {
        const sym = extractUntypedSymbol(child as UntypedBlock);
        if (sym) children.push(sym);
      }
    }
  }

  return children;
}

/**
 * Extract a DocumentSymbol from an UntypedBlock.
 * Shows unknown blocks in the outline so users can see and navigate to them.
 */
function extractUntypedSymbol(block: UntypedBlock): DocumentSymbol | null {
  const cst = block.__cst;
  if (!cst) return null;

  const { range, selectionRange } = computeRanges(cst);
  const name = block.__blockName
    ? `${block.key} ${block.__blockName}`
    : block.key;

  // Recursively extract children from nested UntypedBlocks and FieldChildren
  const childSymbols: DocumentSymbol[] = [];
  for (const child of block.__children) {
    if (isBlockChild(child)) {
      if (child.__type === 'untyped') {
        const sym = extractUntypedSymbol(child as UntypedBlock);
        if (sym) childSymbols.push(sym);
      } else if (child.__type === 'field') {
        const fc = child as { key: string; value: unknown };
        const val = fc.value;
        const valCst =
          val && typeof val === 'object' && '__cst' in val
            ? (val as AstNodeLike).__cst
            : undefined;
        if (valCst) {
          const { range: r, selectionRange: sr } = computeRanges(valCst);
          childSymbols.push({
            name: fc.key,
            kind: SymbolKind.Property,
            range: r,
            selectionRange: sr,
          });
        }
      }
    }
  }

  return {
    name,
    kind: SymbolKind.Property,
    range,
    selectionRange,
    ...(childSymbols.length > 0 ? { children: childSymbols } : {}),
  };
}

/**
 * Create a container symbol for a nested NamedMap.
 * When the Map lacks __cst, the range is computed from child entries.
 */
function createMapContainerSymbol(
  name: string,
  map: NamedMap<unknown>
): DocumentSymbol | null {
  const cst = map.__cst;

  const entryChildren: DocumentSymbol[] = [];
  for (const [entryName, entry] of map) {
    const sym = extractSymbol(entryName, entry);
    if (sym) entryChildren.push(sym);
  }

  if (entryChildren.length === 0) return null;

  let range: Range;
  let selectionRange: Range;

  if (cst) {
    const ranges = computeRanges(cst);
    range = ranges.range;
    selectionRange = ranges.selectionRange;
  } else {
    range = {
      start: entryChildren[0].range.start,
      end: entryChildren[entryChildren.length - 1].range.end,
    };
    selectionRange = range;
  }

  return {
    name,
    kind: SymbolKind.Namespace,
    range,
    selectionRange,
    children: entryChildren,
  };
}

export interface RangeInfo {
  range: Range;
  selectionRange: Range;
}

/**
 * Compute full range and selection range from CST metadata.
 *
 * CST node attachment varies by block type:
 * - TypedMap entries: __cst.node IS the mapping_element
 * - Block/NamedBlock: __cst.node is the value node, parent is mapping_element
 *
 * Full range uses the mapping_element when available so selectionRange
 * (just the key) is always contained within range.
 */
export function computeRanges(cst: CstMeta): RangeInfo {
  const node = cst.node;

  if (node.type === 'mapping_element') {
    const keyRange = getKeyRange(node);
    return {
      range: toRange(node),
      selectionRange: keyRange ?? toRange(node),
    };
  }

  const parent = node.parent;
  if (parent?.type === 'mapping_element') {
    const keyRange = getKeyRange(parent);
    return {
      range: toRange(parent),
      selectionRange: keyRange ?? toRange(parent),
    };
  }

  return {
    range: cst.range,
    selectionRange: cst.range,
  };
}

function getKeyRange(mappingElement: SyntaxNode): Range | null {
  const keyNode = mappingElement.childForFieldName('key');
  if (keyNode) {
    return toRange(keyNode);
  }
  return null;
}

/**
 * Find a namespace symbol within a scope level's children.
 *
 * Outer-first: direct children win over namespaces nested inside
 * intermediate non-scoped blocks (e.g., `reasoning`). This matches
 * `collectNamespaceMaps` in scope.ts — topic.actions definitions take
 * precedence over topic.reasoning.actions bindings.
 *
 * If the outer namespace doesn't contain the target entry, the caller
 * (see references.ts `resolveReference`) falls through to AST-based
 * resolution which walks both outer and inner maps in order, so
 * entries that only exist in nested maps (e.g., reasoning-only action
 * bindings referenced from reasoning.instructions) are still found.
 */
function findNamespaceSymbol(
  children: DocumentSymbol[],
  namespace: string
): DocumentSymbol | undefined {
  // Outer first: direct child
  const direct = children.find(c => c.name === namespace);
  if (direct) return direct;

  // Inner last: search through intermediate Namespace-kind symbols
  for (const child of children) {
    if (!child.children || child.kind !== SymbolKind.Namespace) continue;
    const found = findNamespaceSymbol(child.children, namespace);
    if (found) return found;
  }

  return undefined;
}

/**
 * Resolve a namespace to its symbol entries via 3-step lookup:
 * 1. Scoped: walk scope chain checking each level for the namespace
 * 2. Direct container: root-level symbol matching the namespace
 * 3. Promoted named blocks: "namespace name" patterns at root with alias resolution
 *
 * Returns SymbolEntry[] if found (may be empty), null if unresolved.
 */
function resolveNamespace(
  symbols: DocumentSymbol[],
  namespace: string,
  ctx: SchemaContext,
  scope?: ScopeContext
): SymbolEntry[] | null {
  if (scope) {
    const scopeChain = getScopeChain(scope, ctx);
    if (scopeChain.length > 0) {
      let currentChildren = symbols;

      for (const { level, info } of scopeChain) {
        const levelName = scope[level];

        let levelSym: DocumentSymbol | undefined;
        if (!info.parentScope) {
          const keys = info.rootKeys.flatMap(k => resolveNamespaceKeys(k, ctx));
          levelSym = currentChildren.find(s =>
            keys.some(k => s.name === `${k} ${levelName}`)
          );
        } else {
          for (const sym of currentChildren) {
            if (!sym.children) continue;
            const found = sym.children.find(c => c.name === levelName);
            if (found) {
              levelSym = found;
              break;
            }
          }
        }

        if (!levelSym?.children) break;

        const nsSym = findNamespaceSymbol(levelSym.children, namespace);
        if (nsSym) {
          return (nsSym.children ?? []).map(c => ({ name: c.name, symbol: c }));
        }

        currentChildren = levelSym.children;
      }
    }
  }

  const directSym = symbols.find(s => s.name === namespace);
  if (directSym) {
    return (directSym.children ?? []).map(c => ({ name: c.name, symbol: c }));
  }

  const prefixes = resolveNamespaceKeys(namespace, ctx).map(k => k + ' ');
  const promoted: SymbolEntry[] = [];
  for (const sym of symbols) {
    for (const prefix of prefixes) {
      if (sym.name.startsWith(prefix)) {
        promoted.push({ name: sym.name.slice(prefix.length), symbol: sym });
      }
    }
  }
  if (promoted.length > 0) return promoted;

  return null;
}

/**
 * Get member names for a namespace from the DocumentSymbol tree.
 * Returns string[] if found (may be empty), or null if the namespace
 * has no static definitions.
 */
export function getSymbolMembers(
  symbols: DocumentSymbol[],
  namespace: string,
  ctx: SchemaContext,
  scope?: ScopeContext,
  position?: { line: number; character: number }
): string[] | null {
  const entries = position
    ? resolveNamespaceBottomUp(
        symbols,
        namespace,
        position.line,
        position.character
      )
    : resolveNamespace(symbols, namespace, ctx, scope);
  return entries ? entries.map(e => e.name) : null;
}

/** Build an ordered scope chain (root -> deepest) from the ScopeContext. */
function getScopeChain(
  scope: ScopeContext,
  ctx: SchemaContext
): Array<{ level: string; info: ScopeNavInfo }> {
  const nav = getScopeNavigation(ctx);
  const active: Array<{ level: string; info: ScopeNavInfo; depth: number }> =
    [];

  for (const [level, info] of nav) {
    if (!scope[level]) continue;
    let depth = 0;
    let current: string | undefined = level;
    while (current) {
      const cur = nav.get(current);
      if (!cur?.parentScope) break;
      current = cur.parentScope;
      depth++;
    }
    active.push({ level, info, depth });
  }

  active.sort((a, b) => a.depth - b.depth);
  return active;
}

/** A symbol entry with its resolved name (accounting for promoted blocks). */
export interface SymbolEntry {
  name: string;
  symbol: DocumentSymbol;
}

/**
 * Get DocumentSymbol entries for a namespace from the symbol tree.
 * Returns null if the namespace has no static definitions.
 *
 * When `position` is provided, uses bottom-up resolution (schema-agnostic).
 * Otherwise uses top-down scope-chain resolution.
 */
export function getSymbolNamespaceEntries(
  symbols: DocumentSymbol[],
  namespace: string,
  ctx: SchemaContext,
  scope?: ScopeContext,
  position?: { line: number; character: number }
): SymbolEntry[] | null {
  if (position) {
    return resolveNamespaceBottomUp(
      symbols,
      namespace,
      position.line,
      position.character
    );
  }
  return resolveNamespace(symbols, namespace, ctx, scope);
}

/** Find a specific symbol entry by namespace and name. */
export function findSymbolEntry(
  symbols: DocumentSymbol[],
  namespace: string,
  name: string,
  ctx: SchemaContext,
  scope?: ScopeContext,
  position?: { line: number; character: number }
): DocumentSymbol | null {
  const entries = getSymbolNamespaceEntries(
    symbols,
    namespace,
    ctx,
    scope,
    position
  );
  if (!entries) return null;
  return entries.find(e => e.name === name)?.symbol ?? null;
}

/** Build the path from root to the deepest symbol containing the position. */
function findContainingPath(
  symbols: DocumentSymbol[],
  line: number,
  character: number
): Array<{ symbol: DocumentSymbol; siblings: DocumentSymbol[] }> {
  const path: Array<{ symbol: DocumentSymbol; siblings: DocumentSymbol[] }> =
    [];

  let currentLevel = symbols;
  for (;;) {
    const containing = currentLevel.find(s =>
      isPositionInRange(line, character, s.range)
    );
    if (!containing) break;

    path.push({ symbol: containing, siblings: currentLevel });
    if (!containing.children) break;
    currentLevel = containing.children;
  }

  return path;
}

/**
 * Search sibling symbols for a namespace.
 * Checks direct container names and promoted "namespace name" patterns.
 *
 * `skip`, when provided, excludes a specific sibling symbol from the
 * match. Used by the bottom-up resolver to walk past the namespace map
 * the cursor is currently inside (e.g. a binding RHS skips its enclosing
 * `reasoning.actions` and resolves against `subagent.actions`).
 */
function findNamespaceInLevel(
  siblings: DocumentSymbol[],
  namespace: string,
  skip?: DocumentSymbol
): SymbolEntry[] | null {
  const nsSym = siblings.find(s => s.name === namespace && s !== skip);
  if (nsSym) {
    return (nsSym.children ?? []).map(c => ({ name: c.name, symbol: c }));
  }

  const prefix = namespace + ' ';
  const promoted: SymbolEntry[] = [];
  for (const s of siblings) {
    if (s === skip) continue;
    if (s.name.startsWith(prefix)) {
      promoted.push({ name: s.name.slice(prefix.length), symbol: s });
    }
  }
  return promoted.length > 0 ? promoted : null;
}

/**
 * Resolve a namespace bottom-up from a position in the symbol tree.
 * Walks from deepest containing symbol to root, checking siblings at each
 * level. Schema-agnostic -- uses only range containment and symbol names.
 *
 * Innermost-wins (shadowing): the first namespace symbol found wins. A
 * match whose symbol IS the path entry at that level (i.e. the cursor is
 * inside that very namespace map) is skipped, so binding-RHS contexts
 * walk past their enclosing map and resolve against the outer definition.
 */
function resolveNamespaceBottomUp(
  symbols: DocumentSymbol[],
  namespace: string,
  line: number,
  character: number
): SymbolEntry[] | null {
  const path = findContainingPath(symbols, line, character);

  for (let i = path.length - 1; i >= 0; i--) {
    const result = findNamespaceInLevel(
      path[i].siblings,
      namespace,
      path[i].symbol
    );
    if (result) return result;
  }

  if (path.length === 0) {
    return findNamespaceInLevel(symbols, namespace);
  }

  return null;
}
