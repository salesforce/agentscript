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
  resolveEntryAtRoot,
  resolveEntryInScope,
  getNamespaceMetadata,
  activeScopeForNamespace,
  type ScopeContext,
  type SchemaContext,
} from './scope.js';
import { isPositionInRange, computeDetail } from './ast-utils.js';
import { recurseAstChildren } from './ast-walkers.js';
import { getSymbolNamespaceEntries, type DocumentSymbol } from './symbols.js';
import type { PositionIndex } from './position-index.js';
import { queryScopeAtPosition } from './position-index.js';
import { decomposeAtMemberExpression } from '../expressions.js';

/** A completion candidate returned by the dialect layer. */
export interface CompletionCandidate {
  name: string;
  kind: SymbolKind;
  detail?: string;
  documentation?: string;
  /** Auto-generated LSP snippet text with tab stops, for compound fields. */
  snippet?: string;
  /**
   * Text actually inserted at the cursor. Defaults to `name` when absent.
   * Used by enum-value candidates that need quoting (e.g. label `OpenAI`,
   * insertText `"OpenAI"`).
   */
  insertText?: string;
}

/**
 * Find the enclosing scope for a cursor position.
 *
 * Resolution order:
 *   1. Position index (O(1)) if provided, else CST walk of the AST.
 *   2. If that yields an empty scope and `source` is provided, fall back
 *      to an indentation-based scan of the source text.
 *
 * The indentation fallback exists because CST ranges on error-recovered
 * blocks (e.g. a partially-typed `with` line) may not contain the cursor,
 * so the CST walk returns `{}`. Scanning indentation gives a best-effort
 * reconstruction of the parent chain from what the user has typed.
 */
export function findEnclosingScope(
  ast: AstRoot,
  line: number,
  character: number,
  index?: PositionIndex,
  source?: string,
  ctx?: SchemaContext
): ScopeContext {
  const scope = index
    ? queryScopeAtPosition(index, line, character)
    : (() => {
        const s: Record<string, string> = {};
        walkScopeBlocks(ast, line, character, s, new Set());
        return s;
      })();

  if (Object.keys(scope).length > 0) return scope;

  if (source && ctx) {
    return scopeFromIndentation(source.split('\n'), line, ctx);
  }

  return scope;
}

/**
 * Reconstruct a ScopeContext from indentation by walking the parent chain
 * and recording `scopeAlias` → entry name for each `key name:` line.
 */
function scopeFromIndentation(
  lines: string[],
  cursorLine: number,
  ctx: SchemaContext
): ScopeContext {
  const scope: Record<string, string> = {};
  const rootSchema = ctx.info.schema;

  for (const { trimmed } of walkParentsByIndent(lines, cursorLine)) {
    const m = trimmed.match(/^([\w-]+)(?:\s+([\w-]+))?\s*:/);
    if (!m) continue;

    const key = m[1];
    const entryName = m[2];
    if (!entryName) continue;

    for (const schemaKey of resolveNamespaceKeys(key, ctx)) {
      const rawFt = rootSchema[schemaKey];
      if (!rawFt) continue;
      const ft = Array.isArray(rawFt) ? rawFt[0] : rawFt;
      if (ft.scopeAlias) {
        scope[ft.scopeAlias] = entryName;
      }
    }
  }

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
    if (
      meta.scopesRequired &&
      !activeScopeForNamespace(meta.scopesRequired, scope)
    ) {
      continue;
    }

    candidates.push({
      name: ns,
      kind: meta.kind,
      detail: meta.scopesRequired
        ? `(scoped to ${[...meta.scopesRequired].join(' or ')})`
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
 *
 * When `line`/`character` are provided, applies a nested-run override for
 * colinear-resolved scoped namespaces (e.g. `outputs`): if the cursor is
 * inside a `set` clause of a nested `run @actions.X`, `@outputs.` resolves
 * against `X` instead of the enclosing binding's action. `with` clauses
 * are intentionally NOT overridden — their RHS passes inputs TO the run
 * and references the outer scope's outputs. Mirrors the lint-side
 * transparency rule in `undefined-reference.ts`.
 */
export function getCompletionCandidates(
  ast: AstRoot,
  namespace: string,
  ctx: SchemaContext,
  scope?: ScopeContext,
  symbols?: DocumentSymbol[],
  line?: number,
  character?: number
): CompletionCandidate[] {
  // Nested-run override for `outputs` (and any other colinear-resolved
  // scoped namespace). Computed before symbol lookup because the symbol
  // path resolves via scope-chain and would otherwise find the enclosing
  // binding's action outputs (stale) when binding name == action name.
  let effectiveScope = scope;
  if (
    line !== undefined &&
    character !== undefined &&
    ctx.scopedNamespaces.has(namespace) &&
    ctx.colinearResolvedScopes.has(namespace)
  ) {
    const scopesRequired = ctx.scopedNamespaces.get(namespace);
    // Pick the currently-active host scope so the override key matches
    // the cursor context. For colinear-resolved namespaces like @outputs,
    // this is typically `action` — and colinear namespaces only ever
    // appear under a single nested scope level, so the choice is stable.
    const activeScope = activeScopeForNamespace(scopesRequired, scope);
    const override = findNestedRunSetTarget(ast, line, character);
    if (activeScope && override !== undefined) {
      effectiveScope = { ...(scope ?? {}), [activeScope]: override };
    }
  }

  if (symbols) {
    // When a cursor position is available, use position-based bottom-up
    // resolution so the innermost-enclosing namespace map wins (shadowing).
    // Without a position, fall back to scope-chain top-down resolution.
    const position =
      line !== undefined && character !== undefined
        ? { line, character }
        : undefined;
    const entries = getSymbolNamespaceEntries(
      symbols,
      namespace,
      ctx,
      effectiveScope,
      position
    );
    if (entries) {
      return entries.map(({ name, symbol }) => ({
        name,
        kind: symbol.kind,
        detail: symbol.detail,
      }));
    }
  }

  const scopesRequired = getScopedNamespaces(ctx).get(namespace);
  const activeScope = activeScopeForNamespace(scopesRequired, effectiveScope);

  if (activeScope && effectiveScope) {
    return getScopedChildCandidates(
      ast,
      namespace,
      activeScope,
      effectiveScope,
      ctx
    );
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

/**
 * Walk the AST at `line`/`character` looking for the deepest `SetClause`
 * containing the cursor whose enclosing frame is a `RunStatement`. If
 * found, returns the run target's action name (e.g. `inner` for
 * `run @actions.inner`). Otherwise returns `undefined`.
 *
 * Traversal tracks the current enclosing run target as it descends —
 * entering a `RunStatement` updates it to the run's target ref, and the
 * value is inherited by children until we hit another RunStatement or
 * leave the chain. When we encounter a `SetClause` CST range containing
 * the position AND we have an enclosing run target, return it.
 *
 * `WithClause` is NOT a trigger: its RHS passes inputs TO the run and
 * should reference the OUTER scope's outputs, not the run target's. The
 * walk recurses into WithClause children normally but never returns
 * early there.
 *
 * Nested runs: `run @actions.A` inside `run @actions.B` inside a binding
 * body will yield `A` when the cursor is in A's set clauses, `B` when in
 * B's set clauses (but not inside A), and `undefined` outside any set
 * clause of a nested run. The innermost matching frame wins because
 * `childRunTarget` is overwritten on each RunStatement descent.
 */
function findNestedRunSetTarget(
  ast: AstRoot,
  line: number,
  character: number
): string | undefined {
  return walkForNestedRunSet(ast, line, character, undefined, new Set());
}

function walkForNestedRunSet(
  value: unknown,
  line: number,
  character: number,
  enclosingRunTarget: string | undefined,
  visited: Set<unknown>
): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  if (visited.has(value)) return undefined;
  visited.add(value);

  if (isNamedMap(value)) {
    for (const [, entry] of value) {
      if (!isAstNodeLike(entry)) continue;
      const cst = entry.__cst;
      if (!cst || !isPositionInRange(line, character, cst.range)) continue;
      const result = walkForNestedRunSet(
        entry,
        line,
        character,
        enclosingRunTarget,
        visited
      );
      if (result !== undefined) return result;
    }
    return undefined;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const result = walkForNestedRunSet(
        item,
        line,
        character,
        enclosingRunTarget,
        visited
      );
      if (result !== undefined) return result;
    }
    return undefined;
  }

  if (!isAstNodeLike(value)) return undefined;

  const cst = value.__cst;
  if (cst && !isPositionInRange(line, character, cst.range)) return undefined;

  // Inside a SetClause with an enclosing run: this is our override target.
  // Checked before recursion because a SetClause's descendants are
  // expressions, which cannot contain further SetClause/RunStatement frames.
  if (value.__kind === 'SetClause' && enclosingRunTarget !== undefined) {
    return enclosingRunTarget;
  }

  // Entering a RunStatement updates the enclosing-run-target for children.
  // Decomposing `decomposeAtMemberExpression` handles both `@actions.X` and
  // bare `actions.X` forms; it returns `{ namespace, property }` where
  // `property` is the action name we need.
  let childRunTarget = enclosingRunTarget;
  if (value.__kind === 'RunStatement') {
    const target = (value as { target?: unknown }).target;
    if (target && typeof target === 'object') {
      const ref = decomposeAtMemberExpression(target);
      if (ref) {
        childRunTarget = ref.property;
      }
    }
  }

  let result: string | undefined;
  recurseAstChildren(value, (_k, child) => {
    if (result !== undefined) return;
    const sub = walkForNestedRunSet(
      child,
      line,
      character,
      childRunTarget,
      visited
    );
    if (sub !== undefined) result = sub;
  });

  return result;
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
  const tabSize = source ? inferIndentStep(ast, source) : DEFAULT_INDENT_STEP;

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
          snippet: generateFieldSnippet(key, ft, { tabSize }),
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
        snippet: generateFieldSnippet(name, fieldType, { tabSize }),
      };
    });
}

/**
 * Resolved schema context derived from the cursor's indentation and the AST.
 *
 * Shared between `getFieldCompletions` (via `inferBlockFromIndentation`) and
 * `getValueCompletions`. Walking parents twice with two slightly divergent
 * implementations was the bug source for W-22415806; both callers now use
 * this single resolver.
 */
interface IndentSchemaContext {
  /** Parent keys at strictly decreasing indents (root → cursor's parent). */
  parents: Array<{
    key: string;
    indent: number;
    line: number;
    entryName?: string;
  }>;
  /** Schema at the cursor's nesting level after variant/TypedMap resolution. */
  schema: Schema | Record<string, FieldType>;
  /**
   * Whether the cursor sits at a level where users type entry names (rather
   * than field keys / values).
   *   'none'  → inside a regular block; field/enum completions apply.
   *   'named' → entry-name level of a NamedMap or CollectionBlock.
   *   'typed' → entry-name level of a TypedMap; propertiesSchema fields apply.
   */
  mapLevel: 'none' | 'named' | 'typed';
  /**
   * The TypedMap field whose primitive-type keywords (`string`, `number`, …)
   * should be offered at value position. Set only when the cursor's parent is
   * a TypedMap entry. Independent of `mapLevel`; primitive keywords appear
   * after the colon on a TypedMap entry's value side.
   */
  typedMapField: FieldType | null;
  /** Cached source split into lines (avoid re-splitting in the caller). */
  lines: string[];
  /** Indent of the cursor line, in columns. */
  cursorIndent: number;
  /** Cursor line content (trimmed and raw both useful). */
  cursorLineRaw: string;
}

/**
 * Walk parents from the cursor up to the root and resolve the matching
 * schema, mirroring discriminant-based variant resolution from the AST.
 *
 * AgentScript uses indentation to define structure, so the indent hierarchy
 * maps directly to the schema hierarchy. This function:
 *
 * 1. Collects parent keys at strictly decreasing indent levels going upward
 * 2. Walks the schema top-down following those keys
 * 3. Tracks the matching AST node in lockstep so it can resolve
 *    discriminant-based variant schemas (e.g. `kind: "OpenAI"` exposes
 *    OpenAI-specific fields on top of the LLM base schema). Mirrors the
 *    CST-path resolution in `findEnclosingBlockWithSchema`.
 *
 * Returns `null` only when there is nothing useful for any caller (no
 * parents at all, or top-level cursor).
 */
function walkParentsToSchemaContext(
  ast: AstRoot,
  line: number,
  rootSchema: Schema | Record<string, FieldType>,
  source: string
): IndentSchemaContext | null {
  const lines = source.split('\n');
  const cursorLineRaw = lines[line] ?? '';
  const cursorIndent = getIndent(cursorLineRaw);

  if (cursorIndent === 0) return null;

  const parents: IndentSchemaContext['parents'] = [];
  for (const { line: l, indent, trimmed } of walkParentsByIndent(lines, line)) {
    const m = trimmed.match(/^([\w-]+)(?:\s+([\w-]+))?\s*:/);
    if (!m) continue;
    parents.unshift({ key: m[1], indent, line: l, entryName: m[2] });
  }

  if (parents.length === 0) return null;

  // Key distinction:
  //   NamedMap / CollectionBlock at entry level → no completions (user types names)
  //   TypedMap at entry level → show propertiesSchema (entries are typed
  //     declarations like "name: string", properties are useful here)
  let schema: Schema | Record<string, FieldType> = rootSchema;
  let mapLevel: IndentSchemaContext['mapLevel'] = 'none';
  let typedMapField: FieldType | null = null;
  let astCursor: unknown = ast;
  // Set only when the parent step entered a CollectionBlock; consumed on
  // the next step to resolve the variant/named schema for the entry once
  // its name is known.
  let pendingEntryBlock: NamedBlockEntryType | undefined;

  for (const { key, entryName } of parents) {
    const fieldDef = schema[key];
    if (fieldDef) {
      const ft = Array.isArray(fieldDef) ? fieldDef[0] : fieldDef;
      const isTypedMap = ft.__isTypedMap === true;
      const mapLike = ft.isNamed || ft.__isCollection || isTypedMap;

      if (mapLike) {
        const entrySchema = ft.schema ?? ft.propertiesSchema;
        typedMapField = isTypedMap ? ft : null;
        if (entrySchema) {
          schema = entrySchema;
          astCursor = isAstNodeLike(astCursor)
            ? astField(astCursor, key)
            : undefined;
          pendingEntryBlock = isCollectionFieldType(ft)
            ? ft.entryBlock
            : undefined;
          if (entryName) {
            mapLevel = 'none';
            astCursor = isNamedMap(astCursor)
              ? astCursor.get(entryName)
              : undefined;
            schema = resolveEntrySchema(astCursor, pendingEntryBlock, schema);
            pendingEntryBlock = undefined;
            typedMapField = null;
          } else {
            mapLevel = isTypedMap ? 'typed' : 'named';
          }
        }
      } else if (ft.schema) {
        schema = ft.schema;
        mapLevel = 'none';
        typedMapField = null;
        astCursor = isAstNodeLike(astCursor)
          ? astField(astCursor, key)
          : undefined;
        pendingEntryBlock = undefined;
      } else {
        // Leaf field (no sub-schema, e.g. ProcedureValue) — cursor is
        // inside a value body where schema-based completions don't apply.
        return {
          parents,
          schema: {} as Schema,
          mapLevel: 'none',
          typedMapField: null,
          lines,
          cursorIndent,
          cursorLineRaw,
        };
      }
    } else {
      // Key not in schema = named entry key (e.g. "myLLM" inside `llm:`).
      // The parent map-like step already advanced the schema to the entry
      // schema; descend into the entry and resolve any variant schema.
      mapLevel = 'none';
      typedMapField = null;
      astCursor = isNamedMap(astCursor) ? astCursor.get(key) : undefined;
      schema = resolveEntrySchema(astCursor, pendingEntryBlock, schema);
      pendingEntryBlock = undefined;
    }
  }

  return {
    parents,
    schema,
    mapLevel,
    typedMapField,
    lines,
    cursorIndent,
    cursorLineRaw,
  };
}

/**
 * Indentation-based inference for schema context.
 *
 * Used by `getFieldCompletions` to surface field-key completions when the
 * CST walk returns nothing (blank line, error-recovered partial AST). Wraps
 * `walkParentsToSchemaContext` with the field-completion-specific
 * post-processing: synthetic block with sibling keys for already-present
 * field exclusion, leaf/named-gap returns.
 */
function inferBlockFromIndentation(
  ast: AstRoot,
  line: number,
  _character: number,
  rootSchema: Schema | Record<string, FieldType>,
  source: string
): { block: AstNodeLike; schema: Schema } | null {
  const ctx = walkParentsToSchemaContext(ast, line, rootSchema, source);
  if (!ctx) return null;

  const { parents, schema, mapLevel, lines, cursorIndent } = ctx;

  // Leaf field — suppress completions and override any CST-based result.
  if (!parents.length) return null;
  if (mapLevel === 'none' && schema === rootSchema) return null;

  // NamedMap/CollectionBlock at entry level → user types entry names, no completions
  if (mapLevel === 'named') {
    return {
      block: { __kind: 'NamedMapGap' } as unknown as AstNodeLike,
      schema: {} as Schema,
    };
  }
  // TypedMap at entry level → show propertiesSchema fields (mapLevel === 'typed')
  // Block level → show block schema fields (mapLevel === 'none')

  // Build a synthetic block with already-present sibling keys so the caller
  // can filter them out of completion suggestions.  Scan lines at cursor
  // indent within the parent block boundaries.
  const lastParent = parents[parents.length - 1];
  const presentKeys: Record<string, unknown> = { __kind: 'Synthetic' };
  for (let l = lastParent.line + 1; l < lines.length; l++) {
    const ln = lines[l];
    if (!ln || !ln.trim()) continue;
    const indent = getIndent(ln);
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

/**
 * Resolve the schema variant for a parsed NamedMap entry, mirroring what
 * the dialect would compute at parse time. Tries discriminant-based
 * resolution first, then name-based, and falls back to `entrySchema` when
 * neither applies (or the entry is half-parsed / missing). The fallback
 * yields safe completions when the AST is partial: callers still get the
 * base schema rather than no completions at all.
 */
function resolveEntrySchema(
  entry: unknown,
  entryBlock: NamedBlockEntryType | undefined,
  entrySchema: Schema | Record<string, FieldType>
): Schema | Record<string, FieldType> {
  if (!entryBlock || !isAstNodeLike(entry)) return entrySchema;
  if (hasDiscriminant(entryBlock)) {
    const discValue = extractDiscriminantValue(
      entry,
      entryBlock.discriminantField
    );
    if (discValue) return entryBlock.resolveSchemaForDiscriminant(discValue);
    return entrySchema;
  }
  const name = typeof entry.__name === 'string' ? entry.__name : undefined;
  if (name) return entryBlock.resolveSchemaForName(name);
  return entrySchema;
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

      const entrySchema = resolveEntrySchema(entry, namedEntryType, schema);
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
 * Get value-position completions for the cursor on `<key>: <CURSOR>`.
 *
 * Two sources contribute:
 *
 *  1. **Enum members** — when the cursor's key resolves to a `StringValue`
 *     (or other primitive) field whose schema declares
 *     `__metadata.constraints.enum`, each enum value is offered. Discriminant
 *     variants are honoured: if the enclosing entry has a discriminant set
 *     (e.g. `kind: "OpenAI"`), enum candidates come from the resolved variant
 *     schema, not the base.
 *
 *  2. **TypedMap primitive keywords** — when the cursor sits at the value
 *     side of a TypedMap entry (e.g. `name: <CURSOR>` under `variables:`),
 *     the TypedMap's primitive type keywords (`string`, `number`, …) are
 *     offered.
 *
 *  Both sources can fire independently; for fields like `visibility:` under
 *  a TypedMap variable entry only the enum branch fires (the cursor is at
 *  the property value, not the entry value).
 */
export function getValueCompletions(
  ast: AstRoot,
  line: number,
  _character: number,
  ctx: SchemaContext,
  source: string
): CompletionCandidate[] {
  const rootSchema = ctx.info.schema;
  const resolved = walkParentsToSchemaContext(ast, line, rootSchema, source);
  if (!resolved) return [];

  const { schema, typedMapField, cursorLineRaw } = resolved;
  const candidates: CompletionCandidate[] = [];

  // 1. Enum members for the cursor-line key, if any.
  const keyMatch = cursorLineRaw.trimStart().match(/^([\w-]+)\s*:/);
  if (keyMatch) {
    const cursorKey = keyMatch[1];
    const fieldDef = (schema as Record<string, FieldType | FieldType[]>)[
      cursorKey
    ];
    if (fieldDef) {
      const ft = Array.isArray(fieldDef) ? fieldDef[0] : fieldDef;
      const enumValues = ft.__metadata?.constraints?.enum;
      if (Array.isArray(enumValues)) {
        const needsQuotes = ft.__accepts?.includes('StringLiteral');
        for (const value of enumValues) {
          const literal = String(value);
          candidates.push({
            name: literal,
            kind: SymbolKind.EnumMember,
            insertText: needsQuotes ? `"${literal}"` : literal,
          });
        }
      }
    }
  }

  // 2. TypedMap primitive type keywords (e.g. string, number, boolean).
  if (typedMapField) {
    const primitiveTypes = typedMapField.__primitiveTypes ?? [];
    for (const pt of primitiveTypes) {
      candidates.push({
        name: pt.keyword,
        kind: SymbolKind.TypeParameter,
        documentation: pt.description,
      });
    }
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

/**
 * Get completion candidates for `with` clause parameter names.
 *
 * When the user types `with ` (or `with par`) inside a reasoning action
 * binding or a `run` statement, returns the input parameter names declared
 * on the referenced action definition, excluding parameters already bound
 * by sibling `with` lines.
 *
 * Supported contexts:
 * - Reasoning action binding: `binding_name: @ns.action` with `with` indented underneath.
 * - Run statement: `run @ns.action` with `with` indented underneath.
 *
 * Returns an empty array if the cursor is not on a `with` line or no action
 * definition with inputs can be resolved.
 */
export function getWithCompletions(
  ast: AstRoot,
  line: number,
  _character: number,
  ctx: SchemaContext,
  source: string
): CompletionCandidate[] {
  const lines = source.split('\n');
  const currentLine = lines[line] ?? '';

  // Guard: only activate when the cursor is on a line that starts with
  // `with` followed by an optional partial parameter name.
  // Examples that match: "        with ", "        with ord"
  // Examples that don't: "        with order_number = value", "set x = 1"
  const withMatch = currentLine.match(/^\s+with\s+(\w*)$/);
  if (!withMatch) return [];

  // Step 1: Walk up source lines by indentation to find the enclosing
  // action reference — either `run @actions.X` or `binding: @actions.X`.
  // Returns { namespace: "actions", property: "X" } or null.
  const ref = findEnclosingActionRef(lines, line);
  if (!ref) return [];

  // Step 2: Resolve the enclosing ScopeContext. CST ranges on
  // error-recovered `with` lines often don't contain the cursor, so
  // `findEnclosingScope` falls back to an indentation-based reconstruction
  // when the CST-based result is empty.
  const scope = findEnclosingScope(
    ast,
    line,
    _character,
    undefined,
    source,
    ctx
  );

  // Step 3: Resolve the action definition AST node carrying `inputs`.
  //
  // Try root-level first, then scoped. A binding entry can share its name
  // with the root-level definition it references (e.g.,
  // `foo: @actions.foo`); scoped-first would return the binding (no
  // `inputs`) instead of the definition (with `inputs`).
  const actionBlock =
    resolveEntryAtRoot(ast, ref.namespace, ref.property, ctx) ??
    resolveEntryInScope(ast, ref.namespace, ref.property, ctx, scope);
  if (!actionBlock) return [];

  // Step 4: Read the `inputs` field from the resolved action definition.
  // In the AST, `inputs` is a NamedMap where each key is a parameter name
  // and each value is a declaration node (e.g., `order_number: string`).
  const candidates: CompletionCandidate[] = [];
  const inputs = actionBlock.inputs;
  if (isNamedMap(inputs)) {
    // Collect parameter names already bound by sibling `with` lines so
    // we can exclude them from the suggestions. For example, if the user
    // already wrote `with order_number = ...` on a preceding line, we
    // should not suggest `order_number` again.
    const boundParams = collectBoundWithParams(lines, line);

    for (const [name, entry] of inputs) {
      // Skip parameters that are already bound
      if (boundParams.has(name)) continue;
      if (!isAstNodeLike(entry)) continue;
      // Extract the `description` field from the parameter declaration
      // node, if present, to show as documentation in the completion popup.
      const documentation = extractCandidateDocumentation(entry);
      candidates.push({
        name,
        kind: SymbolKind.Property,
        documentation,
      });
    }
  }

  return candidates;
}

/**
 * Walk up from `cursorLine` to find the enclosing `@namespace.name` action
 * reference. Returns the namespace and property from the first matching
 * parent line (`run @ns.name` or `binding: @ns.name`), or `null` if none
 * is found before the search bails at a non-matching lower-indent line.
 *
 * Source-text walking is used because `with` lines in error-recovered
 * ASTs often fall outside the CST range of the enclosing block.
 */
function findEnclosingActionRef(
  lines: string[],
  cursorLine: number
): { namespace: string; property: string } | null {
  // Only the first strictly-less-indented parent matters. If it isn't an
  // action reference, the `with` clause isn't under one — stop searching.
  for (const { trimmed } of walkParentsByIndent(lines, cursorLine)) {
    const runMatch = trimmed.match(/^run\s+@(\w+)\.([\w-]+)/);
    if (runMatch) return { namespace: runMatch[1], property: runMatch[2] };

    const entryMatch = trimmed.match(/^[\w-]+:\s+@(\w+)\.([\w-]+)/);
    if (entryMatch) {
      return { namespace: entryMatch[1], property: entryMatch[2] };
    }

    return null;
  }

  return null;
}

/**
 * Collect the set of `with` parameter names already bound at the same
 * indentation level as `cursorLine`, scanning both directions until the
 * parent (lower-indent) line is reached.
 */
function collectBoundWithParams(
  lines: string[],
  cursorLine: number
): Set<string> {
  const bound = new Set<string>();
  const cursorIndent = getIndent(lines[cursorLine]);

  // ── Scan upward from the cursor ────────────────────────────────────
  // Walk backward through preceding lines. Stop when we hit a line with
  // lower indentation (that's the parent action reference line).
  // Only collect lines at exactly the cursor's indentation level.
  for (let l = cursorLine - 1; l >= 0; l--) {
    const ln = lines[l];
    if (!ln || !ln.trim()) continue;
    const lineIndent = getIndent(ln);
    // Lower indentation = parent scope boundary, stop scanning
    if (lineIndent < cursorIndent) break;
    // Skip lines at deeper indentation (children of other clauses)
    if (lineIndent !== cursorIndent) continue;
    // Extract the parameter name from `with param_name = ...`
    const withParamMatch = ln.trim().match(/^with\s+([\w-]+)/);
    if (withParamMatch) {
      bound.add(withParamMatch[1]);
    }
  }

  // ── Scan downward from the cursor ──────────────────────────────────
  // Same logic in the forward direction — collect sibling `with` lines
  // that appear after the cursor line.
  for (let l = cursorLine + 1; l < lines.length; l++) {
    const ln = lines[l];
    if (!ln || !ln.trim()) continue;
    const lineIndent = getIndent(ln);
    if (lineIndent < cursorIndent) break;
    if (lineIndent !== cursorIndent) continue;
    const withParamMatch = ln.trim().match(/^with\s+([\w-]+)/);
    if (withParamMatch) {
      bound.add(withParamMatch[1]);
    }
  }

  return bound;
}

/**
 * Get the indentation level (number of leading spaces) of a source line.
 */
function getIndent(line: string): number {
  return line.length - line.trimStart().length;
}

/** Min/max indent step we'll honour. Outside this range we fall back. */
const MIN_INDENT_STEP = 2;
const MAX_INDENT_STEP = 8;
const DEFAULT_INDENT_STEP = 4;

/**
 * Infer the document's indent step for snippet generation by walking the
 * AST. Used so completion-snippet bodies match the user's actual
 * indentation convention rather than a hardcoded 4 spaces.
 *
 * The dialect's grammar is whitespace-significant with a consistent step
 * across the whole document. We just need ONE structural parent→child
 * pair on different lines to recover the step.
 *
 * For each `AstNodeLike` we have a CST range, and the "structural indent"
 * of that node is the leading-whitespace count of the line where its CST
 * starts. Walking the AST depth-first and comparing line-indents between a
 * node and the nearest descendant that starts on a different line gives
 * the document's step.
 *
 * This is naturally immune to indented prose inside multi-line scalars
 * (`description: |` content is a StringLiteral leaf, not nested
 * `AstNodeLike` children with their own line starts).
 *
 * Result is clamped to [MIN_INDENT_STEP, MAX_INDENT_STEP]. When nothing
 * usable is found (empty file, single-line doc, totally broken parse), we
 * fall back to DEFAULT_INDENT_STEP.
 */
function inferIndentStep(ast: AstRoot, source: string): number {
  const lines = source.split('\n');
  const lineIndent = (line: number): number => {
    const ln = lines[line];
    if (ln === undefined) return -1;
    return ln.length - ln.trimStart().length;
  };

  let result: number | undefined;

  function visit(node: unknown, parentIndent: number): void {
    if (result !== undefined) return;
    if (!node || typeof node !== 'object') return;

    if (Array.isArray(node)) {
      for (const item of node) {
        visit(item, parentIndent);
        if (result !== undefined) return;
      }
      return;
    }

    if (!isAstNodeLike(node) && !isNamedMap(node)) return;

    let nextParentIndent = parentIndent;
    const cst = (node as AstNodeLike).__cst;
    if (cst) {
      const indent = lineIndent(cst.range.start.line);
      if (indent >= 0 && parentIndent >= 0 && indent > parentIndent) {
        const delta = indent - parentIndent;
        if (delta >= MIN_INDENT_STEP && delta <= MAX_INDENT_STEP) {
          result = delta;
          return;
        }
      }
      if (indent >= 0) nextParentIndent = indent;
    }

    if (isNamedMap(node)) {
      for (const [, entry] of node) {
        visit(entry, nextParentIndent);
        if (result !== undefined) return;
      }
      return;
    }

    for (const [k, v] of Object.entries(node as AstNodeLike)) {
      if (k.startsWith('__')) continue;
      visit(v, nextParentIndent);
      if (result !== undefined) return;
    }
  }

  visit(ast, -1);
  return result ?? DEFAULT_INDENT_STEP;
}

/**
 * Yield non-blank lines above `cursorLine` at strictly decreasing
 * indentation — the structural parent chain in an indentation-based
 * grammar. Stops once a line at indent 0 is yielded.
 *
 * Each caller applies its own regex to `trimmed` to extract the fields
 * it needs (`key:`, `run @ns.name`, etc.).
 */
function* walkParentsByIndent(
  lines: string[],
  cursorLine: number
): Generator<{ line: number; indent: number; trimmed: string }> {
  let targetIndent = getIndent(lines[cursorLine] ?? '');
  for (let l = cursorLine - 1; l >= 0; l--) {
    const ln = lines[l];
    if (!ln || !ln.trim()) continue;
    const indent = getIndent(ln);
    if (indent >= targetIndent) continue;
    yield { line: l, indent, trimmed: ln.trimStart() };
    targetIndent = indent;
    if (indent === 0) break;
  }
}
