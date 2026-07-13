/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Schema-driven graph extractor.
 *
 * Walks a parsed AgentFabric (or any compatible) document and builds a
 * directed graph of nodes + edges purely from schema metadata. No field
 * or block names are hardcoded — adding a new node kind to a dialect is
 * a schema change and nothing else.
 *
 * Nodes:
 * - Every entry of any top-level NamedCollection whose entry block either
 *   declares the `'transitionTarget'` block-level capability OR owns a
 *   field marked `transitionContainer`. Both kinds share the same
 *   `GraphNode` shape; consumers can derive trigger-vs-step from edge
 *   topology (a trigger has no incoming edges).
 *
 * Edges come from two field-level markers:
 *   - `__metadata.transitionContainer === true` on a ProcedureValue
 *     field — the procedure body's TransitionStatements / ToClauses are
 *     walked; each clause target produces an edge.
 *   - `__metadata.constraints.resolvedType === 'transitionTarget'` on a
 *     ReferenceValue field — the MemberExpression value `@ns.name`
 *     resolves directly to the destination id.
 *
 * Per-node and per-edge metadata:
 * - `lexicalRange` is the source range of the AST element that defines
 *   the entity (entry instance / MemberExpression / ToClause).
 * - `properties` on nodes captures top-level string-literal sibling fields
 *   (e.g. `label`, `description`) for display.
 * - `properties` on edges captures every primitive sibling on the parent
 *   block instance — string literals contribute their unwrapped value,
 *   expressions contribute their source text. This is how router routes
 *   surface both `label` and `when` (the predicate) without naming them.
 */
import {
  decomposeAtMemberExpression,
  isCollectionFieldType,
  isNamedCollectionFieldType,
  isNamedMap,
  SequenceNode,
} from '@agentscript/language';
import type {
  AstNodeLike,
  FieldType,
  Range,
  Schema,
  SchemaInfo,
} from '@agentscript/language';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GraphNode {
  /** Qualified id, e.g. "generator.classifySeverity". */
  id: string;
  /** Schema key (namespace), e.g. "generator". */
  namespace: string;
  /** Instance name, e.g. "classifySeverity". */
  name: string;
  /** Block-factory kind, e.g. "GeneratorBlock", "TriggerBlock". */
  blockKind: string;
  /**
   * String-literal primitive fields collected from the entry's top-level
   * schema (e.g. `label`, `description`). Generic — no field name is
   * hardcoded. Undefined when no such fields are present.
   */
  properties?: Record<string, string>;
  /**
   * Human-readable display label — copied from the StringLiteral value
   * of any top-level field marked `displayLabelField` in the schema.
   * Convenience surface so adapters don't reach into `properties` by a
   * hardcoded field name. Undefined when no such field is present or
   * the field has no value.
   */
  label?: string;
  /**
   * Source range of the AST element that defines this node — i.e. the
   * NamedCollection entry instance. Undefined for synthetic nodes that
   * have no `__cst` attached.
   */
  lexicalRange?: Range;
}

export type EdgeProvenance =
  | 'trigger'
  | 'transitionContainer'
  | 'transitionTarget';

export interface GraphEdge {
  /** Source node id, e.g. "generator.classifySeverity". */
  from: string;
  /** Target node id, e.g. "generator.classifySeverity". */
  to: string;
  /** Where this edge was discovered (best-effort label for debugging). */
  via: EdgeProvenance;
  /**
   * Sibling primitive fields collected from the parent block instance
   * that owned the `transitionTarget` field. String literals contribute
   * their unwrapped value; expressions contribute their source text.
   * Driven by the schema, no field name is hardcoded.
   *
   * Example: a router route captures `{ label: "High", when: "@x == 1" }`.
   * Undefined when the parent has no qualifying siblings (e.g. router
   * `otherwise`, or edges from a transitionContainer).
   */
  properties?: Record<string, string>;
  /**
   * Source text of the predicate that gates this edge — copied from any
   * sibling primitive field marked `predicateField` in the schema. This
   * is a convenience surface so consumers don't need schema access to
   * locate the gating expression among `properties`. Undefined when no
   * such field is present (e.g. `otherwise` routes, transitionContainer
   * edges).
   */
  predicate?: string;
  /**
   * Human-readable name of the output this edge represents — copied from
   * the StringLiteral value of any sibling primitive field marked
   * `outputNameField` in the schema (e.g. a router route's `label`).
   * Convenience surface so adapters don't reach into `properties` by a
   * hardcoded field name. Undefined when no such field is present.
   */
  outputName?: string;
  /**
   * Source range of the AST element that defines this edge:
   *  - For `transitionTarget` ref edges, the MemberExpression value
   *    (`@namespace.name`).
   *  - For `transitionContainer` and trigger edges, the ToClause that
   *    introduces the target (`to @namespace.name`).
   * Undefined when the originating CST node has no range attached.
   */
  lexicalRange?: Range;
}

export interface ExtractedGraph {
  /**
   * Every entry produced by the extractor — both transition-target
   * blocks (regular graph nodes) and entry-point blocks (triggers).
   * Both share the same `GraphNode` shape; consumers identify
   * triggers structurally (no incoming edges) rather than by inspecting
   * `blockKind`. Edges from a trigger entry are still tagged
   * `via: 'trigger'` for debugging convenience.
   */
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// ---------------------------------------------------------------------------
// Local guards
// ---------------------------------------------------------------------------

function isAstNodeLike(value: unknown): value is AstNodeLike {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Extract the parser-attached source range from any AST node, when present.
 * Synthetic / error-recovery nodes may lack `__cst`, so callers must treat
 * the result as optional.
 */
function rangeOf(node: unknown): Range | undefined {
  if (!isAstNodeLike(node)) return undefined;
  return node.__cst?.range;
}

// ---------------------------------------------------------------------------
// Schema introspection helpers
// ---------------------------------------------------------------------------

/** Resolve a possibly-array-wrapped schema entry to a single FieldType. */
function resolveFieldType(ft: FieldType | FieldType[]): FieldType {
  return Array.isArray(ft) ? ft[0] : ft;
}

interface ResolvedEntryBlock {
  kind: string;
  schema: Schema;
  capabilities: readonly string[];
}

/**
 * For a top-level schema field (e.g. `generator: NamedCollectionBlock(...)`),
 * resolve the entry block factory whose `capabilities` and `schema` describe
 * each instance. Returns undefined when the field is not a collection.
 */
function resolveEntryBlock(
  fieldType: FieldType
): ResolvedEntryBlock | undefined {
  if (!isCollectionFieldType(fieldType)) return undefined;
  const entry = fieldType.entryBlock;
  return {
    kind: entry.kind,
    schema: entry.schema,
    capabilities:
      (entry as { capabilities?: readonly string[] }).capabilities ?? [],
  };
}

function declaresTransitionTarget(capabilities: readonly string[]): boolean {
  return capabilities.includes('transitionTarget');
}

/**
 * Walk a block schema and report whether it (or any nested block) owns a
 * `transitionContainer` field. Used to discover trigger-like blocks.
 */
function schemaContainsTransitionContainer(schema: Schema): boolean {
  for (const rawFt of Object.values(schema)) {
    const ft = resolveFieldType(rawFt);
    if (ft.__metadata?.transitionContainer === true) return true;
    // Recurse into nested block schemas — keeps discovery schema-driven.
    if (ft.schema && schemaContainsTransitionContainer(ft.schema)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Sibling primitive collection
// ---------------------------------------------------------------------------

/**
 * Extract the string value of a `StringLiteral` AST node, or undefined
 * when the value isn't a string literal. Used for human-facing display
 * text (e.g. node `label`, `description`) where we want the literal
 * payload, not the surrounding quotes.
 */
function stringLiteralText(value: AstNodeLike): string | undefined {
  if ((value as { __kind?: string }).__kind !== 'StringLiteral')
    return undefined;
  const literal = (value as { value?: unknown }).value;
  return typeof literal === 'string' ? literal : undefined;
}

/**
 * Extract the source text of any primitive AST node — string literals
 * use their unwrapped value, everything else (expressions, identifiers,
 * references) falls back to `__cst.node.text` so the surfaced text
 * matches what the user wrote. Schema-driven: callers walk Primitive
 * fields by `__fieldKind`; this helper has no opinion on which `__kind`
 * values are acceptable.
 */
function primitiveSourceText(value: AstNodeLike): string | undefined {
  const literal = stringLiteralText(value);
  if (literal !== undefined) return literal;
  return (value as { __cst?: { node?: { text?: string } } }).__cst?.node?.text;
}

/**
 * Walk every Primitive field declared in `schema`, applying `extract`
 * to the matching value on `instance`. Skips `exceptField` and any
 * value that isn't an AstNodeLike (e.g. unparsed/synthetic fields).
 * Returns undefined when nothing qualifies so callers don't emit empty
 * `{}` bags.
 */
function collectSiblingProps(
  instance: AstNodeLike,
  schema: Schema,
  extract: (value: AstNodeLike) => string | undefined,
  exceptField?: string
): Record<string, string> | undefined {
  let props: Record<string, string> | undefined;
  for (const [fieldName, rawFt] of Object.entries(schema)) {
    if (fieldName === exceptField) continue;
    const ft = resolveFieldType(rawFt);
    if (ft.__fieldKind !== 'Primitive') continue;
    const value = instance[fieldName];
    if (!isAstNodeLike(value)) continue;
    const text = extract(value);
    if (text === undefined) continue;
    if (!props) props = {};
    props[fieldName] = text;
  }
  return props;
}

/** Boolean `FieldMetadata` markers that the graph extractor consults. */
type GraphFieldMarker =
  | 'predicateField'
  | 'outputNameField'
  | 'displayLabelField';

/**
 * Find the first primitive sibling on `instance` whose schema field
 * carries the requested boolean metadata marker (e.g. `predicateField`,
 * `outputNameField`), and return its extracted text. Returns undefined
 * when no field is marked, or the marked field's value is missing /
 * unparsed. Schema-driven: callers never reference field names directly.
 */
function markedFieldText(
  instance: AstNodeLike,
  schema: Schema,
  marker: GraphFieldMarker,
  extract: (value: AstNodeLike) => string | undefined
): string | undefined {
  for (const [fieldName, rawFt] of Object.entries(schema)) {
    const ft = resolveFieldType(rawFt);
    if (ft.__metadata?.[marker] !== true) continue;
    const value = instance[fieldName];
    if (!isAstNodeLike(value)) continue;
    return extract(value);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Member-expression → qualified id
// ---------------------------------------------------------------------------

/**
 * Resolve an Expression that should reference a graph node into its
 * qualified id (`namespace.name`). Returns undefined when the expression
 * isn't a `@namespace.name` MemberExpression.
 */
function qualifiedIdOf(expr: unknown): string | undefined {
  const decomposed = decomposeAtMemberExpression(expr);
  if (!decomposed) return undefined;
  return `${decomposed.namespace}.${decomposed.property}`;
}

// ---------------------------------------------------------------------------
// Edge discovery within a parsed entry instance
// ---------------------------------------------------------------------------

/**
 * Discover all transition edges originating at `instance` by walking its
 * schema. Recurses into nested blocks (e.g. router routes/otherwise) so
 * that field markers anywhere in the subtree are honoured.
 *
 * @param fromId Qualified id of the source node (the entry whose outgoing
 *        edges are being discovered).
 * @param instance The parsed entry instance whose fields are walked.
 * @param schema The block schema describing `instance` (the field-type
 *        metadata is the source of truth for marker discovery).
 * @param triggerOverride When provided, every discovered edge is tagged
 *        with this provenance instead of the field-derived label. This is
 *        how trigger-rooted edges keep their `'trigger'` label even when
 *        the underlying field is a `transitionContainer`.
 */
function collectOutgoingEdges(
  fromId: string,
  instance: AstNodeLike,
  schema: Schema,
  triggerOverride?: EdgeProvenance
): GraphEdge[] {
  const edges: GraphEdge[] = [];

  for (const [fieldName, rawFt] of Object.entries(schema)) {
    const ft = resolveFieldType(rawFt);
    const value = instance[fieldName];

    // Field-level marker #1: transitionContainer ProcedureValue.
    if (ft.__metadata?.transitionContainer === true) {
      const via: EdgeProvenance = triggerOverride ?? 'transitionContainer';
      edges.push(...edgesFromTransitionContainer(fromId, value, via));
      continue;
    }

    // Field-level marker #2: resolvedType === 'transitionTarget'.
    if (ft.__metadata?.constraints?.resolvedType === 'transitionTarget') {
      const targetId = qualifiedIdOf(value);
      if (targetId) {
        const via: EdgeProvenance = triggerOverride ?? 'transitionTarget';
        // Capture sibling primitives on the same parent instance — string
        // literals contribute their unwrapped value, expressions contribute
        // their source text. Schema-driven: every Primitive sibling field is
        // a candidate, no field name is hardcoded.
        const properties = collectSiblingProps(
          instance,
          schema,
          primitiveSourceText,
          fieldName
        );
        const predicate = markedFieldText(
          instance,
          schema,
          'predicateField',
          primitiveSourceText
        );
        const outputName = markedFieldText(
          instance,
          schema,
          'outputNameField',
          stringLiteralText
        );
        const lexicalRange = rangeOf(value);
        edges.push({
          from: fromId,
          to: targetId,
          via,
          ...(properties ? { properties } : {}),
          ...(predicate !== undefined ? { predicate } : {}),
          ...(outputName !== undefined ? { outputName } : {}),
          ...(lexicalRange ? { lexicalRange } : {}),
        });
      }
      continue;
    }

    // Recurse into nested structure when the field is itself a Block /
    // Sequence / Collection of blocks. This is what lets router routes (a
    // Sequence of RouterRouteBlock) and otherwise (a single block) be
    // discovered without ever naming "routes" or "otherwise".
    if (value === undefined || value === null) continue;
    if (ft.schema) {
      edges.push(
        ...recurseIntoNested(fromId, value, ft, ft.schema, triggerOverride)
      );
    }
  }

  return edges;
}

/**
 * Walk a single ProcedureValue's statements, finding TransitionStatement
 * → ToClause targets and producing one edge per resolved target.
 */
function edgesFromTransitionContainer(
  fromId: string,
  procedureValue: unknown,
  via: EdgeProvenance
): GraphEdge[] {
  const edges: GraphEdge[] = [];
  if (!isAstNodeLike(procedureValue)) return edges;
  const statements = procedureValue.statements;
  if (!Array.isArray(statements)) return edges;

  for (const stmt of statements) {
    if (!isAstNodeLike(stmt)) continue;
    if (stmt.__kind !== 'TransitionStatement') continue;
    const clauses = stmt.clauses;
    if (!Array.isArray(clauses)) continue;
    for (const clause of clauses) {
      if (!isAstNodeLike(clause)) continue;
      if (clause.__kind !== 'ToClause') continue;
      const targetId = qualifiedIdOf(clause.target);
      if (!targetId) continue;
      const lexicalRange = rangeOf(clause);
      edges.push({
        from: fromId,
        to: targetId,
        via,
        ...(lexicalRange ? { lexicalRange } : {}),
      });
    }
  }
  return edges;
}

/**
 * Recurse from a non-leaf field value (Block / Sequence / Collection) into
 * its inner schema to keep collecting edges. Handles three cases:
 *  1. Sequence of blocks — iterate `items`, treating each as an instance.
 *  2. Collection (NamedMap of blocks) — iterate values.
 *  3. Plain nested Block — recurse into it directly.
 */
function recurseIntoNested(
  fromId: string,
  value: unknown,
  fieldType: FieldType,
  innerSchema: Schema,
  triggerOverride?: EdgeProvenance
): GraphEdge[] {
  const edges: GraphEdge[] = [];

  if (value instanceof SequenceNode) {
    for (const item of value.items) {
      if (isAstNodeLike(item)) {
        edges.push(
          ...collectOutgoingEdges(fromId, item, innerSchema, triggerOverride)
        );
      }
    }
    return edges;
  }

  if (isCollectionFieldType(fieldType) && isNamedMap(value)) {
    for (const [, entry] of value as Iterable<[string, unknown]>) {
      if (isAstNodeLike(entry)) {
        edges.push(
          ...collectOutgoingEdges(fromId, entry, innerSchema, triggerOverride)
        );
      }
    }
    return edges;
  }

  // Plain nested Block — single instance.
  if (isAstNodeLike(value) && !(value instanceof SequenceNode)) {
    edges.push(
      ...collectOutgoingEdges(fromId, value, innerSchema, triggerOverride)
    );
  }

  return edges;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Build a `{ nodes, edges }` graph from a parsed document, driven entirely
 * by schema metadata. Adding a new node kind (or a new transition field)
 * requires zero changes here as long as the schema is correctly tagged
 * with `'transitionTarget'` capability and `transitionContainer` /
 * `resolvedType: 'transitionTarget'` field markers.
 *
 * Triggers and graph nodes share the same `GraphNode` shape — the only
 * difference inside the extractor is that a trigger entry's block
 * doesn't declare `'transitionTarget'`. Consumers identify triggers
 * structurally (no incoming edges); the `via: 'trigger'` provenance on
 * outgoing edges is retained as a debugging aid only.
 */
export function extractGraph(
  parsed: AstNodeLike,
  schemaInfo: SchemaInfo
): ExtractedGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  for (const [namespace, rawFt] of Object.entries(schemaInfo.schema)) {
    const fieldType = resolveFieldType(rawFt);

    // Limit to NamedCollections so each instance has a stable __name we can
    // use as the qualified-id suffix.
    if (!isNamedCollectionFieldType(fieldType)) continue;

    const entry = resolveEntryBlock(fieldType);
    if (!entry) continue;

    const isGraphNode = declaresTransitionTarget(entry.capabilities);
    const isTrigger =
      !isGraphNode && schemaContainsTransitionContainer(entry.schema);
    if (!isGraphNode && !isTrigger) continue;

    const collection = parsed[namespace];
    if (!isNamedMap(collection)) continue;

    for (const [name, instance] of collection as Iterable<[string, unknown]>) {
      if (!isAstNodeLike(instance)) continue;
      const id = `${namespace}.${name}`;

      // Top-level string-literal fields on the entry block (e.g. label,
      // description). Intentionally only inspects the entry's own schema —
      // we do NOT recurse into nested blocks here, so a router's per-route
      // labels never bubble up to the router node itself.
      const properties = collectSiblingProps(
        instance,
        entry.schema,
        stringLiteralText
      );
      const label = markedFieldText(
        instance,
        entry.schema,
        'displayLabelField',
        stringLiteralText
      );
      const lexicalRange = rangeOf(instance);

      nodes.push({
        id,
        namespace,
        name,
        blockKind: entry.kind,
        ...(properties ? { properties } : {}),
        ...(label !== undefined ? { label } : {}),
        ...(lexicalRange ? { lexicalRange } : {}),
      });
      edges.push(
        ...collectOutgoingEdges(
          id,
          instance,
          entry.schema,
          isTrigger ? 'trigger' : undefined
        )
      );
    }
  }

  return { nodes, edges };
}
