/**
 * Public adapter that translates an agentfabric `ParsedDocument` into the
 * agent-graph protocol shape consumed by the VS Code agent-graph canvas.
 *
 * The protocol is documented at
 * `~/mulesoft/poc-graph/agent-graph-protocol.md`. Each node has a
 * first-class `kind` plus an open `additionalProperties: Record<string,
 * string>` bag; each edge has only the bag. This file is the boundary
 * between the schema-driven internal extractor (which exposes provenance,
 * sibling primitive props, and predicates) and that protocol shape.
 *
 * All needed information comes from `extractGraph` — this adapter never
 * re-walks the AST and never names dialect-specific blocks or fields.
 */
import { extractGraph } from './extractor.js';
import type { GraphEdge, GraphNode } from './extractor.js';
import { AgentFabricSchemaInfo } from '../schema.js';
import type { ParsedDocument } from '../index.js';
import type { AstNodeLike, SchemaInfo } from '@agentscript/language';

// ---------------------------------------------------------------------------
// Protocol types — match ~/mulesoft/poc-graph/agent-graph-protocol.md
// ---------------------------------------------------------------------------

export interface ProtocolNode {
  id: string;
  /**
   * Specific node type — set to the schema namespace of the entry block
   * (e.g. `'trigger'`, `'router'`, `'echo'`, `'orchestrator'`,
   * `'executor'`, `'generator'`, `'subagent'`). Open set — consumers
   * must treat unknown values as a generic node and may infer structural
   * roles (entry, leaf, router) from edge topology.
   */
  kind: string;
  additionalProperties?: Record<string, string>;
}

export interface ProtocolEdge {
  from: string;
  to: string;
  additionalProperties?: Record<string, string>;
}

export interface Graph {
  nodes: ProtocolNode[];
  edges: ProtocolEdge[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compute the protocol `output` value for a single transition-target
 * edge. Uses the extractor's schema-driven `outputName` (sourced from
 * any `outputNameField`-marked sibling) when present; falls back to the
 * synthesized `"otherwise"` per the protocol's known-keys table for
 * routed edges that lack a named output (e.g. a router's default
 * branch). Returns undefined for edges whose provenance isn't
 * `transitionTarget` (those have no named output).
 */
function outputForRouterEdge(edge: GraphEdge): string | undefined {
  if (edge.via !== 'transitionTarget') return undefined;
  return edge.outputName ?? 'otherwise';
}

/**
 * Escape commas (and the escape character itself) in a single output name
 * so it survives round-tripping through the comma-separated `outputs`
 * list.
 *
 * Wire grammar (must stay in sync with the UI's `parseProtocolOutputs`
 * in `apps/ui/src/lib/agentfabric-graph.ts`):
 *   - `\` → `\\`
 *   - `,` → `\,`
 *   - all other characters pass through verbatim
 * Order matters — backslashes are escaped first so a literal `\` in the
 * source doesn't become an escape prefix. Per-edge `output` is left
 * unescaped; only the joined `outputs` summary string uses this grammar.
 */
function escapeOutputForJoin(output: string): string {
  return output.replace(/\\/g, '\\\\').replace(/,/g, '\\,');
}

/**
 * Aggregate the named outputs across a router's outgoing edges,
 * preserving encounter order and de-duplicating. Used to populate the
 * `outputs` known-key per the protocol example (`"opt1, opt2, otherwise"`).
 *
 * Each output is escaped before joining so a literal comma in a route
 * label (e.g. `label: "yes, sir"`) does not split into two phantom
 * router rows on the consumer side.
 */
function collectRouterOutputs(edges: GraphEdge[]): string {
  const seen = new Set<string>();
  for (const edge of edges) {
    const output = outputForRouterEdge(edge);
    if (output !== undefined) seen.add(output);
  }
  return [...seen].map(escapeOutputForJoin).join(', ');
}

/**
 * Strip undefined entries; return undefined when the resulting bag would
 * be empty so we don't emit `additionalProperties: {}`.
 */
function buildAdditionalProperties(
  entries: Record<string, string | undefined>
): Record<string, string> | undefined {
  let bag: Record<string, string> | undefined;
  for (const [key, value] of Object.entries(entries)) {
    if (typeof value !== 'string') continue;
    if (!bag) bag = {};
    bag[key] = value;
  }
  return bag;
}

/**
 * Build the protocol's `lexical-start-position` / `lexical-end-position`
 * additionalProperties from an internal `Range`. Both positions are
 * encoded as `"line,character"` strings (0-indexed) per the protocol.
 * Returns an empty object when the range is undefined so callers can
 * spread it unconditionally.
 */
function rangePositionProps(
  range: GraphNode['lexicalRange']
): Record<string, string | undefined> {
  if (!range) return {};
  return {
    'lexical-start-position': `${range.start.line},${range.start.character}`,
    'lexical-end-position': `${range.end.line},${range.end.character}`,
  };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Translate a parsed document into the protocol `Graph` shape, using
 * any `SchemaInfo` (defaults to AgentFabric's). Each `extracted.nodes`
 * entry becomes a `ProtocolNode` whose `kind` mirrors the schema
 * namespace; each `extracted.edges` entry becomes a `ProtocolEdge`
 * with output/predicate/range surfaced as `additionalProperties`.
 * Consumers infer structural roles (entry/leaf/router) from edge
 * topology.
 */
export function getGraph(
  parsed: ParsedDocument | AstNodeLike,
  schemaInfo: SchemaInfo = AgentFabricSchemaInfo
): Graph {
  const extracted = extractGraph(parsed, schemaInfo);

  // Pre-bucket edges by source so per-router output collection is O(E)
  // and we can ask "does this node have any outgoing routes?" cheaply.
  const edgesByFrom = new Map<string, GraphEdge[]>();
  for (const edge of extracted.edges) {
    const list = edgesByFrom.get(edge.from);
    if (list) list.push(edge);
    else edgesByFrom.set(edge.from, [edge]);
  }

  // A node is "route-emitting" if any of its outgoing edges has a named
  // output (i.e. came from a router-style transitionTarget). The protocol
  // exposes the `outputs` summary only on those.
  function hasRouterOutputs(nodeId: string): boolean {
    const edges = edgesByFrom.get(nodeId);
    if (!edges) return false;
    return edges.some(e => outputForRouterEdge(e) !== undefined);
  }

  const nodes: ProtocolNode[] = extracted.nodes.map(node => {
    const outputs = hasRouterOutputs(node.id)
      ? collectRouterOutputs(edgesByFrom.get(node.id) ?? [])
      : undefined;

    const additionalProperties = buildAdditionalProperties({
      label: node.label,
      outputs,
      ...rangePositionProps(node.lexicalRange),
    });

    return {
      id: node.id,
      kind: node.namespace,
      ...(additionalProperties ? { additionalProperties } : {}),
    };
  });

  const edges: ProtocolEdge[] = extracted.edges.map(edge => {
    const additionalProperties = buildAdditionalProperties({
      output: outputForRouterEdge(edge),
      predicate: edge.predicate,
      ...rangePositionProps(edge.lexicalRange),
    });
    return {
      from: edge.from,
      to: edge.to,
      ...(additionalProperties ? { additionalProperties } : {}),
    };
  });

  return { nodes, edges };
}
