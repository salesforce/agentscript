/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type {
  AstRoot,
  AstNodeLike,
  FieldType,
  Schema,
  NamedBlockEntryType,
} from '../types.js';
import {
  SymbolKind,
  astField,
  isNamedMap,
  isAstNodeLike,
  isCollectionFieldType,
  extractDiscriminantValue,
  hasDiscriminant,
} from '../types.js';
import { generateFieldSnippet } from './snippet-gen.js';
import {
  getScopedNamespaces,
  findScopeBlock,
  collectNamespaceMaps,
  resolveNamespaceKeys,
  getNamespaceMetadata,
  type ScopeContext,
  type SchemaContext,
} from './scope.js';
import { isPositionInRange, computeDetail } from './ast-utils.js';
import { recurseAstChildren } from './ast-walkers.js';
import { getSymbolNamespaceEntries, type DocumentSymbol } from './symbols.js';
import type { PositionIndex } from './position-index.js';
import { queryScopeAtPosition } from './position-index.js';

/** A completion candidate returned by the dialect layer. */
export interface CompletionCandidate {
  name: string;
  kind: SymbolKind;
  detail?: string;
  documentation?: string;
  /** Auto-generated LSP snippet text with tab stops, for compound fields. */
  snippet?: string;
}

/**
 * Find the enclosing scope for a cursor position.
 * Uses the position index for O(1) lookup when available, otherwise walks the AST.
 */
export function findEnclosingScope(
  ast: AstRoot,
  line: number,
  character: number,
  index?: PositionIndex
): ScopeContext {
  if (index) {
    return queryScopeAtPosition(index, line, character);
  }

  const scope: Record<string, string> = {};
  walkScopeBlocks(ast, line, character, scope, new Set());
  return scope;
}

/**
 * Walk the AST looking for blocks with __scope that contain the cursor.
 * Map branches use position-based containment pruning with early return.
 */
function walkScopeBlocks(
  value: unknown,
  line: number,
  character: number,
  scope: Record<string, string>,
  visited: Set<unknown>
): void {
  if (!value || typeof value !== 'object') return;
  if (visited.has(value)) return;
  visited.add(value);

  if (isNamedMap(value)) {
    for (const [name, entry] of value) {
      if (!isAstNodeLike(entry)) continue;
      const cst = entry.__cst;
      if (!cst || !isPositionInRange(line, character, cst.range)) continue;

      const blockScope = entry.__scope;
      if (blockScope && typeof entry.__name === 'string') {
        scope[blockScope] = name;
      }

      recurseAstChildren(entry, (_k, child) => {
        walkScopeBlocks(child, line, character, scope, visited);
      });
      return;
    }
    return;
  }

  if (!isAstNodeLike(value)) return;

  const cst = value.__cst;
  if (cst && !isPositionInRange(line, character, cst.range)) return;

  recurseAstChildren(value, (_k, child) => {
    walkScopeBlocks(child, line, character, scope, visited);
  });
}

/** Get available namespace suggestions for bare @ or @partial. */
export function getAvailableNamespaces(
  ctx: SchemaContext,
  scope?: ScopeContext
): CompletionCandidate[] {
  const candidates: CompletionCandidate[] = [];

  for (const [ns, meta] of getNamespaceMetadata(ctx)) {
    if (meta.scopeRequired && !scope?.[meta.scopeRequired]) continue;

    candidates.push({
      name: ns,
      kind: meta.kind,
      detail: meta.scopeRequired
        ? `(scoped to ${meta.scopeRequired})`
        : undefined,
    });
  }

  return candidates;
}

/**
 * Get completion candidates for entries within a namespace.
 * For scoped namespaces, uses the cursor scope to find the right block.
 *
 * When `symbols` is provided, uses the pre-computed DocumentSymbol tree
 * to avoid re-walking the AST.
 */
export function getCompletionCandidates(
  ast: AstRoot,
  namespace: string,
  ctx: SchemaContext,
  scope?: ScopeContext,
  symbols?: DocumentSymbol[]
): CompletionCandidate[] {
  if (symbols) {
    const entries = getSymbolNamespaceEntries(symbols, namespace, ctx, scope);
    if (entries) {
      return entries.map(({ name, symbol }) => ({
        name,
        kind: symbol.kind,
        detail: symbol.detail,
      }));
    }
  }

  const requiredScope = getScopedNamespaces(ctx).get(namespace);

  if (requiredScope && scope?.[requiredScope]) {
    return getScopedChildCandidates(ast, namespace, requiredScope, scope, ctx);
  }

  const rootCandidates = getRootCandidates(ast, namespace, ctx);
  if (rootCandidates.length > 0) return rootCandidates;

  // Fallback: check global scopes
  const globalMembers = ctx.globalScopes.get(namespace);
  if (globalMembers) {
    return [...globalMembers].map(member => ({
      name: member,
      kind: SymbolKind.Property,
    }));
  }

  return [];
}

function getRootCandidates(
  ast: AstRoot,
  namespace: string,
  ctx: SchemaContext
): CompletionCandidate[] {
  const candidates: CompletionCandidate[] = [];

  for (const key of resolveNamespaceKeys(namespace, ctx)) {
    const container = astField(ast, key);
    if (isNamedMap(container)) {
      collectMapCandidates(container, candidates);
    } else if (container && typeof container === 'object') {
      collectBlockCandidates(container, candidates);
    }
  }

  return candidates;
}

function getScopedChildCandidates(
  ast: AstRoot,
  namespace: string,
  targetScope: string,
  scope: ScopeContext,
  ctx: SchemaContext
): CompletionCandidate[] {
  const scopeBlock = findScopeBlock(ast, targetScope, scope, ctx);
  if (!scopeBlock) return [];

  const candidates: CompletionCandidate[] = [];
  for (const map of collectNamespaceMaps(scopeBlock, namespace)) {
    collectMapCandidates(map, candidates);
  }
  return candidates;
}

function collectMapCandidates(
  container: unknown,
  candidates: CompletionCandidate[]
): void {
  if (!isNamedMap(container)) return;

  for (const [name, entry] of container) {
    if (!isAstNodeLike(entry)) continue;

    const sym = entry.__symbol;
    const symbolKind = sym?.kind ?? SymbolKind.Property;
    const cst = entry.__cst;

    const detail = cst ? computeDetail(entry, entry.__kind, cst) : undefined;
    const documentation = extractCandidateDocumentation(entry);

    candidates.push({ name, kind: symbolKind, detail, documentation });
  }
}

function collectBlockCandidates(
  container: unknown,
  candidates: CompletionCandidate[]
): void {
  if (!isAstNodeLike(container) || isNamedMap(container)) return;

  for (const [name, field] of Object.entries(container)) {
    if (name.startsWith('__')) continue;
    if (!isAstNodeLike(field)) continue;

    const sym = field.__symbol;
    const symbolKind = sym?.kind ?? SymbolKind.Property;
    const cst = field.__cst;

    const detail = cst ? computeDetail(field, field.__kind, cst) : undefined;
    const documentation = extractCandidateDocumentation(field);

    candidates.push({ name, kind: symbolKind, detail, documentation });
  }
}

/**
 * Get field name completions for a cursor position.
 *
 * Uses the schema to determine valid fields at the current nesting level.
 * Returns field names not already present in the enclosing block.
 */
export function getFieldCompletions(
  ast: AstRoot,
  line: number,
  character: number,
  ctx: SchemaContext,
  /** Source text — enables indentation-based fallback for blank lines. */
  source?: string
): CompletionCandidate[] {
  const rootSchema = ctx.info.schema;
  const aliases = ctx.info.aliases;

  let result = findEnclosingBlockWithSchema(ast, line, character, rootSchema);

  // On blank lines the CST-based lookup may resolve to a parent block
  // because the target entry's CST range only covers its content, not the
  // blank line above it.  Use indentation-based inference in two cases:
  //   1. CST returned nothing — pure fallback.
  //   2. The cursor line is blank — CST likely resolved too shallow.
  // When the CST already found a result on a non-blank line, trust it over
  // the regex-based heuristic which can misparse string keys, comments, etc.
  if (source) {
    const lines = source.split('\n');
    const currentLine = lines[line] ?? '';
    const isBlankLine = currentLine.trim() === '';

    if (!result || isBlankLine) {
      const inferred = inferBlockFromIndentation(
        ast,
        line,
        character,
        rootSchema,
        source
      );
      if (inferred) result = inferred;
    }
  }

  if (!result) {
    return Object.keys(rootSchema)
      .filter(key => !aliases[key])
      .filter(key => {
        const ft = Array.isArray(rootSchema[key])
          ? rootSchema[key][0]
          : rootSchema[key];
        if (ft.__metadata?.hidden) return false;
        return !(key in ast) || isNamedMap(astField(ast, key));
      })
      .map(key => {
        const ft = Array.isArray(rootSchema[key])
          ? rootSchema[key][0]
          : rootSchema[key];
        return {
          name: key,
          kind: fieldCompletionKind(ft),
          documentation: ft.__metadata?.description,
          snippet: generateFieldSnippet(key, ft),
        };
      });
  }

  const { block, schema } = result;

  return Object.entries(schema)
    .filter(([name, ft]) => {
      const fieldType = Array.isArray(ft) ? ft[0] : ft;
      if (fieldType.__metadata?.hidden) return false;
      if (name in block) return false;
      const existing = block[name];
      return !existing || isNamedMap(existing);
    })
    .map(([name, ft]) => {
      const fieldType = Array.isArray(ft) ? ft[0] : ft;
      return {
        name,
        kind: fieldCompletionKind(fieldType),
        documentation: fieldType.__metadata?.description,
        snippet: generateFieldSnippet(name, fieldType),
      };
    });
}

/**
 * Indentation-based inference for schema context.
 *
 * AgentScript uses indentation to define structure, so the indent hierarchy
 * directly maps to the schema hierarchy.  This function:
 *
 * 1. Collects parent keys at strictly decreasing indent levels going upward
 * 2. Walks the schema top-down following those keys
 * 3. Tracks whether the cursor is at a "map level" (where users type entry
 *    names, not field keywords) or inside a block (where we offer completions)
 * 4. Scans siblings at cursor indent for already-present field exclusion
 *
 * Works uniformly for intact and broken ASTs since it only reads source text
 * and schema — no CST/AST traversal needed.
 */
function inferBlockFromIndentation(
  _ast: AstRoot,
  line: number,
  _character: number,
  rootSchema: Schema | Record<string, FieldType>,
  source: string
): { block: AstNodeLike; schema: Schema } | null {
  const lines = source.split('\n');
  const currentLine = lines[line] ?? '';
  const cursorIndent = currentLine.length - currentLine.trimStart().length;

  if (cursorIndent === 0) return null; // top-level, let normal path handle it

  // Step 1: collect parent keys at strictly decreasing indent levels.
  // For "start_agent greeting:" we capture key="start_agent" and note
  // that an entry name is present on the same line (hasEntryName=true).
  const parents: Array<{
    key: string;
    indent: number;
    line: number;
    hasEntryName: boolean;
  }> = [];
  let targetIndent = cursorIndent;
  for (let l = line - 1; l >= 0; l--) {
    const ln = lines[l];
    if (!ln || !ln.trim()) continue;
    const indent = ln.length - ln.trimStart().length;
    if (indent >= targetIndent) continue;
    const m = ln.trimStart().match(/^([\w-]+)(?:\s+([\w-]+))?\s*:/);
    if (!m) continue;
    parents.unshift({ key: m[1], indent, line: l, hasEntryName: !!m[2] });
    targetIndent = indent;
    if (indent === 0) break;
  }

  if (parents.length === 0) return null;

  // Step 2: walk the schema tree following the parent keys.
  // Track whether the cursor is at a map's entry level — where users type
  // entry names rather than field keywords.
  //
  // Key distinction:
  //   NamedMap / CollectionBlock at entry level → no completions (user types names)
  //   TypedMap at entry level → show propertiesSchema (entries are typed
  //     declarations like "name: string", properties are useful here)
  let schema: Schema | Record<string, FieldType> = rootSchema;
  let mapLevel: 'none' | 'named' | 'typed' = 'none';

  for (const { key, hasEntryName } of parents) {
    const fieldDef = schema[key];
    if (fieldDef) {
      const ft = Array.isArray(fieldDef) ? fieldDef[0] : fieldDef;
      const isTypedMap = ft.__isTypedMap === true;
      const mapLike = ft.isNamed || ft.__isCollection || isTypedMap;

      if (mapLike) {
        const entrySchema = ft.schema ?? ft.propertiesSchema;
        if (entrySchema) {
          schema = entrySchema;
          if (hasEntryName) {
            // Entry name on same line (e.g. "start_agent greeting:")
            // → inside the entry, not at map level
            mapLevel = 'none';
          } else {
            mapLevel = isTypedMap ? 'typed' : 'named';
          }
        }
      } else if (ft.schema) {
        schema = ft.schema;
        mapLevel = 'none';
      } else {
        // Leaf field (no sub-schema, e.g. ProcedureValue) — cursor is
        // inside a value body where schema-based field completions
        // don't apply.  Return an empty schema to suppress completions
        // and override any CST-based result.
        return {
          block: { __kind: 'LeafField' } as unknown as AstNodeLike,
          schema: {} as Schema,
        };
      }
    } else {
      // Key not in schema = named entry key (e.g. "collect_info" in actions).
      // The schema was already set to the entry schema by the parent map-like
      // step, so we're now inside this entry.
      mapLevel = 'none';
    }
  }

  if (schema === rootSchema) return null;

  // NamedMap/CollectionBlock at entry level → user types entry names, no completions
  if (mapLevel === 'named') {
    return {
      block: { __kind: 'NamedMapGap' } as unknown as AstNodeLike,
      schema: {} as Schema,
    };
  }
  // TypedMap at entry level → show propertiesSchema fields (mapLevel === 'typed')
  // Block level → show block schema fields (mapLevel === 'none')

  // Step 3: build a synthetic block with already-present sibling keys so
  // the caller can filter them out of completion suggestions.
  // Scan lines at cursor indent within the parent block boundaries.
  const lastParent = parents[parents.length - 1];
  const presentKeys: Record<string, unknown> = { __kind: 'Synthetic' };
  for (let l = lastParent.line + 1; l < lines.length; l++) {
    const ln = lines[l];
    if (!ln || !ln.trim()) continue;
    const indent = ln.length - ln.trimStart().length;
    // Stop at block boundary (line at or before parent indent)
    if (indent <= lastParent.indent) break;
    if (indent !== cursorIndent) continue;
    const km = ln.trimStart().match(/^([\w-]+)\s*:/);
    if (km && km[1] in (schema as Record<string, unknown>)) {
      presentKeys[km[1]] = true;
    }
  }

  return {
    block: presentKeys as unknown as AstNodeLike,
    schema: schema as Schema,
  };
}

function fieldCompletionKind(ft: FieldType | FieldType[]): SymbolKind {
  const resolved = Array.isArray(ft) ? ft[0] : ft;
  if (resolved.isNamed) return SymbolKind.Namespace;
  if (resolved.__isCollection) return SymbolKind.Namespace;
  if (resolved.schema) return SymbolKind.Object;
  return SymbolKind.Property;
}

/**
 * Walk the AST and schema tree in parallel to find the deepest block
 * whose CST range contains the cursor position.
 */
function findEnclosingBlockWithSchema(
  value: unknown,
  line: number,
  character: number,
  schema: Schema | Record<string, FieldType>,
  /** The NamedBlock entry type that owns this Map (used for variant schema resolution). */
  namedEntryType?: NamedBlockEntryType
): { block: AstNodeLike; schema: Schema } | null {
  if (!value || typeof value !== 'object') return null;

  if (isNamedMap(value)) {
    for (const [, entry] of value) {
      if (!isAstNodeLike(entry)) continue;
      const cst = entry.__cst;
      if (!cst || !isPositionInRange(line, character, cst.range)) continue;

      let entrySchema = schema;
      // Check for discriminant-based variant resolution first
      if (namedEntryType && hasDiscriminant(namedEntryType)) {
        const discValue = extractDiscriminantValue(
          entry,
          namedEntryType.discriminantField
        );
        if (discValue) {
          entrySchema = namedEntryType.resolveSchemaForDiscriminant(discValue);
        }
      } else if (namedEntryType) {
        const name =
          typeof entry.__name === 'string' ? entry.__name : undefined;
        if (name) {
          entrySchema = namedEntryType.resolveSchemaForName(name);
        }
      }
      return (
        findDeeperBlock(entry, line, character, entrySchema) ?? {
          block: entry,
          schema: entrySchema,
        }
      );
    }
    return null;
  }

  if (!isAstNodeLike(value)) return null;

  for (const [key, ft] of Object.entries(schema)) {
    const fieldType = Array.isArray(ft) ? ft[0] : ft;
    const child = value[key];
    if (!child || typeof child !== 'object') continue;

    if (isNamedMap(child)) {
      if (fieldType.schema) {
        const entryType = isCollectionFieldType(fieldType)
          ? fieldType.entryBlock
          : undefined;
        const mapResult = findEnclosingBlockWithSchema(
          child,
          line,
          character,
          fieldType.schema,
          entryType
        );
        if (mapResult) return mapResult;
      }
      continue;
    }

    if (!isAstNodeLike(child)) continue;
    const cst = child.__cst;
    if (!cst || !isPositionInRange(line, character, cst.range)) continue;

    if (fieldType.schema) {
      const deeper = findEnclosingBlockWithSchema(
        child,
        line,
        character,
        fieldType.schema
      );
      if (deeper) return deeper;
      return { block: child, schema: fieldType.schema };
    }

    // Cursor is inside a leaf field (e.g. ProcedureValue) that has no
    // sub-schema — return an empty schema so no field completions appear.
    return { block: child, schema: {} as Schema };
  }

  return null;
}

function findDeeperBlock(
  obj: AstNodeLike,
  line: number,
  character: number,
  schema: Schema
): { block: AstNodeLike; schema: Schema } | null {
  for (const [key, ft] of Object.entries(schema)) {
    const fieldType = Array.isArray(ft) ? ft[0] : ft;
    const child = obj[key];
    if (!child || typeof child !== 'object') continue;

    if (isNamedMap(child) && fieldType.schema) {
      const result = findEnclosingBlockWithSchema(
        child,
        line,
        character,
        fieldType.schema
      );
      if (result) return result;
      continue;
    }

    if (!isAstNodeLike(child)) continue;
    const cst = child.__cst;
    if (!cst || !isPositionInRange(line, character, cst.range)) continue;

    if (fieldType.schema) {
      const deeper = findEnclosingBlockWithSchema(
        child,
        line,
        character,
        fieldType.schema
      );
      if (deeper) return deeper;
      return { block: child, schema: fieldType.schema };
    }
  }
  return null;
}

/**
 * Get value completions for a TypedMap entry's value position.
 *
 * When the cursor is after `key: ` inside a TypedMap (e.g., `inputs:`,
 * `outputs:`, `variables:`), returns the primitive types and modifiers
 * defined by the TypedMap's schema.
 */
export function getValueCompletions(
  line: number,
  _character: number,
  ctx: SchemaContext,
  source: string
): CompletionCandidate[] {
  const lines = source.split('\n');
  const currentLine = lines[line] ?? '';
  const cursorIndent = currentLine.length - currentLine.trimStart().length;

  if (cursorIndent === 0) return [];

  const rootSchema = ctx.info.schema;

  // Walk up to find parent keys at strictly decreasing indent levels
  const parents: Array<{
    key: string;
    indent: number;
    hasEntryName: boolean;
  }> = [];
  let targetIndent = cursorIndent;
  for (let l = line - 1; l >= 0; l--) {
    const ln = lines[l];
    if (!ln || !ln.trim()) continue;
    const indent = ln.length - ln.trimStart().length;
    if (indent >= targetIndent) continue;
    const m = ln.trimStart().match(/^([\w-]+)(?:\s+([\w-]+))?\s*:/);
    if (!m) continue;
    parents.unshift({ key: m[1], indent, hasEntryName: !!m[2] });
    targetIndent = indent;
    if (indent === 0) break;
  }

  if (parents.length === 0) return [];

  // Walk schema following parent keys to find the enclosing TypedMap
  let schema: Schema | Record<string, FieldType> = rootSchema;
  let typedMapField: FieldType | null = null;

  for (const { key, hasEntryName } of parents) {
    const fieldDef = schema[key];
    if (fieldDef) {
      const ft = Array.isArray(fieldDef) ? fieldDef[0] : fieldDef;
      const isTypedMap = ft.__isTypedMap === true;
      const mapLike = ft.isNamed || ft.__isCollection || isTypedMap;

      if (mapLike) {
        if (isTypedMap) {
          typedMapField = ft;
        } else {
          typedMapField = null;
        }
        const entrySchema = ft.schema ?? ft.propertiesSchema;
        if (entrySchema) {
          schema = entrySchema;
          if (hasEntryName) {
            // Inside the entry, not at map level
            typedMapField = null;
          }
        }
      } else if (ft.schema) {
        schema = ft.schema;
        typedMapField = null;
      } else {
        typedMapField = null;
      }
    } else {
      // Key not in schema = named entry key
      typedMapField = null;
    }
  }

  if (!typedMapField) return [];

  const candidates: CompletionCandidate[] = [];

  // Add primitive type completions (e.g., string, number, boolean)
  const primitiveTypes = typedMapField.__primitiveTypes ?? [];
  for (const pt of primitiveTypes) {
    candidates.push({
      name: pt.keyword,
      kind: SymbolKind.TypeParameter,
      documentation: pt.description,
    });
  }

  return candidates;
}

function extractCandidateDocumentation(obj: AstNodeLike): string | undefined {
  const description = obj.description;
  if (isAstNodeLike(description)) {
    if (
      description.__kind === 'StringLiteral' &&
      typeof description.value === 'string'
    ) {
      return description.value;
    }
  }
  return undefined;
}
