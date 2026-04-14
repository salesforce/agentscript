import type {
  AstRoot,
  FieldType,
  Schema,
  AstNodeLike,
  SchemaInfo,
} from '../types.js';
import type { NamedMap } from '../block.js';
import { SymbolKind, isNamedMap, isAstNodeLike } from '../types.js';

/**
 * Enclosing block scope for a position in the AST.
 *
 * Keys are scope names from NamedBlocks (e.g., 'topic', 'action'),
 * values are block instance names. Example: `{ topic: 'main', action: 'fetch_data' }`
 */
export type ScopeContext = Readonly<Record<string, string>>;

/** Metadata for a namespace, used for bare-@ completions. */
export interface NamespaceMeta {
  kind: SymbolKind;
  /**
   * Set of scope levels that host this namespace. A namespace is "in scope"
   * when any of these scope levels is active. Multiple entries appear when
   * peer root-level blocks share a namespace (e.g., `actions` is defined on
   * both `topic` and `subagent` in AgentForce).
   */
  scopesRequired?: ReadonlySet<string>;
}

/** Pre-computed schema-derived data. Create via `createSchemaContext(info)`. */
export interface SchemaContext {
  readonly info: SchemaInfo;
  /**
   * Maps a namespace name to the set of scope levels that host its
   * definitions. A namespace may appear under multiple peer scopes — for
   * example, `actions` is defined on both `topic` and `subagent` in
   * AgentForce — so the value is a set, not a single scope.
   */
  readonly scopedNamespaces: ReadonlyMap<string, ReadonlySet<string>>;
  readonly scopeNavigation: ReadonlyMap<string, ScopeNavInfo>;
  readonly namespaceMetadata: ReadonlyMap<string, NamespaceMeta>;
  readonly schemaNamespaces: ReadonlySet<string>;
  // TODO: globalScopes are a semantic gap. They're defined as syntax — a bag of known
  // member names — but carry no type information. We don't know that @utils.transition
  // is an invocationTarget or that its `to` argument requires a transitionTarget. This
  // forces resolvedType validation to skip them entirely (see constraint-validation.ts),
  // punting semantic checks to the compiler.
  //
  // The schema should encode semantics (what things *mean*), not just syntax (what names
  // exist). globalScopes need to declare types/capabilities per member so they participate
  // in the same type system as schema-defined blocks. Syntax (e.g. "this member takes a
  // `to` clause") is an additional restriction layered on top of the semantics, not the
  // other way around.
  /** Global scopes: namespace -> set of known members. */
  readonly globalScopes: ReadonlyMap<string, ReadonlySet<string>>;
  /** Scoped namespaces that support colinear cross-block @-reference resolution (e.g., 'outputs'). */
  readonly colinearResolvedScopes: ReadonlySet<string>;
  /** Namespaces whose blocks declare the 'invocationTarget' capability (can be called as a tool). */
  readonly invocationTargetNamespaces: ReadonlySet<string>;
  /** Namespaces whose blocks declare the 'transitionTarget' capability (can receive a handoff/transition). */
  readonly transitionTargetNamespaces: ReadonlySet<string>;
}

/** Create a SchemaContext from a SchemaInfo. All derived data is computed eagerly. */
export function createSchemaContext(info: SchemaInfo): SchemaContext {
  const scopedNamespaces = buildScopedNamespaces(info);
  const scopeNavigation = buildScopeNavigation(info);
  const namespaceMetadata = buildNamespaceMetadata(info, scopedNamespaces);
  const schemaNamespaces: ReadonlySet<string> = new Set(
    Object.keys(info.schema)
  );

  // Collect all reserved namespace names: schema keys, scoped namespaces, and alias keys/values
  const reservedNamespaces = new Set<string>([
    ...schemaNamespaces,
    ...scopedNamespaces.keys(),
    ...Object.keys(info.aliases),
    ...Object.values(info.aliases),
  ]);

  // Build global scopes map and register them in namespace metadata
  const globalScopes = new Map<string, ReadonlySet<string>>();
  if (info.globalScopes) {
    for (const [ns, scope] of Object.entries(info.globalScopes)) {
      if (reservedNamespaces.has(ns)) {
        throw new Error(
          `Global scope namespace '${ns}' collides with an existing namespace. ` +
            `Global scopes must use unique namespaces that don't overlap with ` +
            `schema keys, scoped namespaces, or aliases. ` +
            `This is a configuration error in the dialect's SchemaInfo.`
        );
      }
      globalScopes.set(ns, scope);
      if (!namespaceMetadata.has(ns)) {
        namespaceMetadata.set(ns, { kind: SymbolKind.Namespace });
      }
    }
  }

  // Derive colinear-resolved scopes from fields marked as referenceable
  const referenceableFields = collectReferenceableFields(info.schema);
  const colinearResolvedScopes: ReadonlySet<string> = new Set(
    [...scopedNamespaces.keys()].filter(ns => referenceableFields.has(ns))
  );

  const capabilityNamespaces = buildCapabilityNamespaces(info);

  return {
    info,
    scopedNamespaces,
    scopeNavigation,
    namespaceMetadata,
    schemaNamespaces,
    globalScopes,
    colinearResolvedScopes,
    invocationTargetNamespaces: capabilityNamespaces.invocationTarget,
    transitionTargetNamespaces: capabilityNamespaces.transitionTarget,
  };
}

/**
 * Resolve a namespace to all equivalent schema keys (including aliases).
 * Resolves transitively: if topic→subagent and start_agent→subagent,
 * resolveNamespaceKeys('topic') -> ['topic', 'subagent', 'start_agent']
 */
export function resolveNamespaceKeys(
  namespace: string,
  ctx: SchemaContext
): string[] {
  const { aliases, extraNamespaceKeys } = ctx.info;

  // Find the canonical (root) key by following the alias chain
  let root = namespace;
  while (aliases[root]) {
    root = aliases[root];
  }

  // Collect all keys that share the same canonical root
  const keys = new Set<string>([namespace, root]);
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (canonical === root) {
      keys.add(alias);
    }
  }

  // Include extra keys configured for this namespace
  if (extraNamespaceKeys?.[namespace]) {
    for (const extra of extraNamespaceKeys[namespace]) {
      keys.add(extra);
    }
  }

  return [...keys];
}

/** Navigation info for a scope level in the AST. */
export interface ScopeNavInfo {
  /** Root-level schema keys for this scope (e.g., ['topic'] for 'topic' scope). */
  rootKeys: string[];
  /** For nested scopes, the parent scope name. */
  parentScope?: string;
}

/** Maps namespace field names to the set of scope levels that host them. */
export function getScopedNamespaces(
  ctx: SchemaContext
): ReadonlyMap<string, ReadonlySet<string>> {
  return ctx.scopedNamespaces;
}

/**
 * Given the set of scope levels that host a namespace (e.g.,
 * `{topic, subagent}` for `@actions` in AgentForce), return whichever
 * one is currently active in `scope`. Returns undefined when none of
 * the hosting scopes are active. When multiple are active, the first
 * one encountered in iteration order wins.
 */
export function activeScopeForNamespace(
  scopesRequired: ReadonlySet<string> | undefined,
  scope: ScopeContext | undefined
): string | undefined {
  if (!scopesRequired || !scope) return undefined;
  for (const s of scopesRequired) {
    if (scope[s]) return s;
  }
  return undefined;
}

/** Maps scope level names to their navigation info. */
export function getScopeNavigation(
  ctx: SchemaContext
): ReadonlyMap<string, ScopeNavInfo> {
  return ctx.scopeNavigation;
}

/** Namespace metadata for bare-@ completions. */
export function getNamespaceMetadata(
  ctx: SchemaContext
): ReadonlyMap<string, NamespaceMeta> {
  return ctx.namespaceMetadata;
}

/**
 * Set of root-level schema keys (namespace names).
 * Used by undefined-reference validation to check if a namespace
 * is statically resolvable even when no entries exist in the document.
 */
export function getSchemaNamespaces(ctx: SchemaContext): ReadonlySet<string> {
  return ctx.schemaNamespaces;
}

/** Global scopes: namespace -> set of known member names. */
export function getGlobalScopes(
  ctx: SchemaContext
): ReadonlyMap<string, ReadonlySet<string>> {
  return ctx.globalScopes;
}

function isTypedMapField(ft: FieldType): boolean {
  return ft.__fieldKind === 'TypedMap';
}

function isCollectionField(
  ft: FieldType
): ft is FieldType & { __isCollection: true } {
  return ft.__isCollection === true;
}

/** Resolve a potentially array-wrapped FieldType to a single FieldType. */
function resolveFieldType(ft: FieldType | FieldType[]): FieldType {
  return Array.isArray(ft) ? ft[0] : ft;
}

function buildScopedNamespaces(
  schemaInfo: SchemaInfo
): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();

  for (const [, rawFt] of Object.entries(schemaInfo.schema)) {
    const fieldType = resolveFieldType(rawFt);
    const scopeAlias = fieldType.scopeAlias;
    const schema = fieldType.schema;
    if (
      (fieldType.isNamed || isCollectionField(fieldType)) &&
      scopeAlias &&
      schema
    ) {
      collectScopedFields(schema, scopeAlias, result);
    }
  }

  return result;
}

/** Add `scope` to the set of hosting scopes for `fieldName`. */
function addScopedField(
  result: Map<string, Set<string>>,
  fieldName: string,
  scope: string
): void {
  let scopes = result.get(fieldName);
  if (!scopes) {
    scopes = new Set<string>();
    result.set(fieldName, scopes);
  }
  scopes.add(scope);
}

/**
 * Walk a block's schema registering child fields that require scope.
 * A field is scoped when it's a NamedBlock or TypedMap inside a scoped parent.
 */
function collectScopedFields(
  schema: Schema,
  parentScope: string,
  result: Map<string, Set<string>>
): void {
  for (const [fieldName, rawFt] of Object.entries(schema)) {
    const fieldType = resolveFieldType(rawFt);
    if (fieldType.isNamed) {
      addScopedField(result, fieldName, parentScope);
      if (fieldType.scopeAlias && fieldType.schema) {
        collectScopedFields(fieldType.schema, fieldType.scopeAlias, result);
      }
    } else if (isCollectionField(fieldType)) {
      // CollectionBlock — treat like a NamedBlock for scope purposes
      addScopedField(result, fieldName, parentScope);
      if (fieldType.scopeAlias && fieldType.schema) {
        collectScopedFields(fieldType.schema, fieldType.scopeAlias, result);
      }
    } else if (isTypedMapField(fieldType)) {
      addScopedField(result, fieldName, parentScope);
    } else if (fieldType.schema && !fieldType.isNamed) {
      // Non-scoped Block (e.g., ReasoningBlock) -- recurse through it
      collectScopedFields(fieldType.schema, parentScope, result);
    }
  }
}

/** Collect field names marked `referenceable` anywhere in the schema tree. */
function collectReferenceableFields(
  schema: Record<string, FieldType>
): ReadonlySet<string> {
  const result = new Set<string>();
  walkForReferenceable(schema, result);
  return result;
}

function walkForReferenceable(
  schema: Record<string, FieldType>,
  result: Set<string>
): void {
  for (const [fieldName, fieldType] of Object.entries(schema)) {
    if (fieldType.__metadata?.crossBlockReferenceable) {
      result.add(fieldName);
    }
    if (fieldType.schema) {
      walkForReferenceable(
        fieldType.schema as Record<string, FieldType>,
        result
      );
    }
  }
}

interface CapabilityNamespaces {
  invocationTarget: Set<string>;
  transitionTarget: Set<string>;
}

function buildCapabilityNamespaces(
  schemaInfo: SchemaInfo
): CapabilityNamespaces {
  const result: CapabilityNamespaces = {
    invocationTarget: new Set(),
    transitionTarget: new Set(),
  };

  for (const [key, rawFt] of Object.entries(schemaInfo.schema)) {
    const fieldType = resolveFieldType(rawFt);
    collectCapabilities(key, fieldType, result);
    if (fieldType.schema) {
      walkForCapabilities(fieldType.schema, result);
    }
  }

  return result;
}

function collectCapabilities(
  name: string,
  fieldType: FieldType,
  result: CapabilityNamespaces
): void {
  if (!fieldType.capabilities) return;
  for (const cap of fieldType.capabilities) {
    if (cap === 'invocationTarget') result.invocationTarget.add(name);
    else if (cap === 'transitionTarget') result.transitionTarget.add(name);
  }
}

function walkForCapabilities(
  schema: Schema,
  result: CapabilityNamespaces
): void {
  for (const [fieldName, rawFt] of Object.entries(schema)) {
    const fieldType = resolveFieldType(rawFt);
    collectCapabilities(fieldName, fieldType, result);
    if (fieldType.schema) {
      walkForCapabilities(fieldType.schema, result);
    }
  }
}

function buildScopeNavigation(
  schemaInfo: SchemaInfo
): Map<string, ScopeNavInfo> {
  const registry = new Map<string, ScopeNavInfo>();

  for (const [key, rawFt] of Object.entries(schemaInfo.schema)) {
    const fieldType = resolveFieldType(rawFt);
    if (
      !(fieldType.isNamed || isCollectionField(fieldType)) ||
      !fieldType.scopeAlias
    )
      continue;

    const existing = registry.get(fieldType.scopeAlias);
    if (existing) {
      if (!existing.rootKeys.includes(key)) existing.rootKeys.push(key);
    } else {
      registry.set(fieldType.scopeAlias, { rootKeys: [key] });
    }

    if (fieldType.schema) {
      walkSchemaForNavigation(fieldType.schema, fieldType.scopeAlias, registry);
    }
  }

  return registry;
}

/** Discover nested scope levels, recursing through non-scoped intermediate blocks. */
function walkSchemaForNavigation(
  schema: Schema,
  parentScope: string,
  registry: Map<string, ScopeNavInfo>
): void {
  for (const [, rawFt] of Object.entries(schema)) {
    const fieldType = resolveFieldType(rawFt);
    if (
      (fieldType.isNamed || isCollectionField(fieldType)) &&
      fieldType.scopeAlias
    ) {
      if (!registry.has(fieldType.scopeAlias)) {
        registry.set(fieldType.scopeAlias, {
          rootKeys: [],
          parentScope,
        });
      }
      if (fieldType.schema) {
        walkSchemaForNavigation(
          fieldType.schema,
          fieldType.scopeAlias,
          registry
        );
      }
    } else if (fieldType.schema && !fieldType.isNamed) {
      walkSchemaForNavigation(fieldType.schema, parentScope, registry);
    }
  }
}

function buildNamespaceMetadata(
  schemaInfo: SchemaInfo,
  scopedNamespaces: ReadonlyMap<string, ReadonlySet<string>>
): Map<string, NamespaceMeta> {
  const { schema, aliases } = schemaInfo;
  const result = new Map<string, NamespaceMeta>();

  for (const key of Object.keys(schema)) {
    if (aliases[key]) continue;
    result.set(key, { kind: SymbolKind.Namespace });
  }

  for (const [ns, scopesRequired] of scopedNamespaces) {
    result.set(ns, {
      kind: SymbolKind.Namespace,
      scopesRequired,
    });
  }

  return result;
}

/**
 * Update a ScopeContext based on an AST node's __scope.
 * Returns a new context if the node introduces a scope, otherwise the existing one.
 */
export function updateScopeContext(
  obj: AstNodeLike,
  ctx: ScopeContext
): ScopeContext {
  if (obj.__scope && typeof obj.__name === 'string') {
    return { ...ctx, [obj.__scope]: obj.__name };
  }
  return ctx;
}

/**
 * Find a named block by navigating the scope chain from root.
 *
 * For root scopes (e.g., 'topic'):
 *   findScopeBlock(ast, 'topic', { topic: 'main' }, ctx) -> TopicBlock 'main'
 *
 * For nested scopes (e.g., 'action'):
 *   findScopeBlock(ast, 'action', { topic: 'main', action: 'fetch' }, ctx) -> ActionBlock 'fetch'
 */
export function findScopeBlock(
  ast: AstRoot,
  targetScope: string,
  scope: ScopeContext,
  ctx: SchemaContext
): AstNodeLike | null {
  const info = getScopeNavigation(ctx).get(targetScope);
  if (!info) return null;

  const targetName = scope[targetScope];
  if (!targetName) return null;

  if (!info.parentScope) {
    for (const rootKey of info.rootKeys) {
      for (const key of resolveNamespaceKeys(rootKey, ctx)) {
        const map = ast[key];
        if (isNamedMap(map)) {
          const block = map.get(targetName);
          if (isAstNodeLike(block)) return block;
        }
      }
    }
    return null;
  }

  const parentBlock = findScopeBlock(ast, info.parentScope, scope, ctx);
  if (!parentBlock) return null;

  return findNamedBlockInDescendants(parentBlock, targetName);
}

/**
 * Search a block's children for a named block with the given name.
 *
 * Direct Map children take priority over nested matches in non-scoped
 * intermediate blocks (e.g., ReasoningBlock). This ensures
 * topic.actions (with outputs) is found before topic.reasoning.actions.
 */
function findNamedBlockInDescendants(
  container: AstNodeLike,
  name: string
): AstNodeLike | null {
  let deferred: AstNodeLike[] | undefined;

  for (const [key, val] of Object.entries(container)) {
    if (key.startsWith('__') || !val || typeof val !== 'object') continue;

    if (isNamedMap(val)) {
      const entry = val.get(name);
      if (isAstNodeLike(entry)) return entry;
    } else if (isAstNodeLike(val)) {
      if (val.__kind && !val.__scope) {
        (deferred ??= []).push(val);
      }
    }
  }

  if (deferred) {
    for (const child of deferred) {
      const found = findNamedBlockInDescendants(child, name);
      if (found) return found;
    }
  }

  return null;
}

/**
 * Collect all Maps matching a namespace within a scope block,
 * including through intermediate non-scoped blocks.
 *
 * Outer (direct) maps come first so that definitions at the scope level
 * take precedence over nested bindings (e.g., topic.actions before
 * topic.reasoning.actions).
 */
export function collectNamespaceMaps(
  container: AstNodeLike,
  namespace: string,
  result: NamedMap<unknown>[] = []
): NamedMap<unknown>[] {
  // Outer first: direct child map (definitions)
  const direct = container[namespace];
  if (isNamedMap(direct)) result.push(direct);

  // Inner last: search intermediate non-scoped blocks (bindings)
  for (const [key, val] of Object.entries(container)) {
    if (key.startsWith('__') || !val || typeof val !== 'object') continue;
    if (isNamedMap(val)) continue;

    if (isAstNodeLike(val) && val.__kind && !val.__scope) {
      collectNamespaceMaps(val, namespace, result);
    }
  }

  return result;
}
