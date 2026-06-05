import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  Block,
  ExpressionValue,
  NamedBlock,
  NamedCollectionBlock,
  ProcedureValue,
  ReferenceValue,
  Sequence,
  StringValue,
  SymbolKind,
} from '@agentscript/language';
import type { SchemaInfo } from '@agentscript/language';
import { parseDocument, parseWithSchema } from '../tests/test-utils.js';
import { getGraph } from './get-graph.js';
import type { Graph, ProtocolNode, ProtocolEdge } from './get-graph.js';

const FIXTURE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../tests/resources/it-help-investigation.agent'
);
const GOLDEN_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../tests/resources/it-help-investigation.graph.json'
);

function findNode(graph: Graph, id: string): ProtocolNode | undefined {
  return graph.nodes.find(n => n.id === id);
}

function findEdge(
  graph: Graph,
  from: string,
  to: string
): ProtocolEdge | undefined {
  return graph.edges.find(e => e.from === from && e.to === to);
}

describe('getGraph (agentfabric protocol adapter)', () => {
  const source = readFileSync(FIXTURE_PATH, 'utf8');
  const parsed = parseDocument(source);
  const graph = getGraph(parsed);

  it('emits the trigger as a protocol node with kind: trigger', () => {
    const trigger = findNode(graph, 'trigger.ticketTrigger');
    expect(trigger).toBeDefined();
    expect(trigger?.kind).toBe('trigger');
  });

  it('emits a router with kind: router and a populated outputs string', () => {
    const router = findNode(graph, 'router.severityRouter');
    expect(router?.kind).toBe('router');
    // severityRouter has one route ("High") + otherwise.
    const outputs = router?.additionalProperties?.outputs;
    expect(outputs).toBeDefined();
    const tokens = outputs!.split(', ');
    expect(tokens).toContain('High');
    expect(tokens).toContain('otherwise');
  });

  it('multi-route router preserves encounter order in outputs', () => {
    const router = findNode(graph, 'router.resolutionRouter');
    expect(router?.kind).toBe('router');
    // Two routes ("License Given", "Unresolved") followed by otherwise.
    expect(router?.additionalProperties?.outputs).toBe(
      'License Given, Unresolved, otherwise'
    );
  });

  it('uses the schema namespace as kind for each non-trigger node', () => {
    const cases: Array<[string, string]> = [
      ['echo.escalationResponse', 'echo'],
      ['executor.escalateTicket', 'executor'],
      ['generator.classifySeverity', 'generator'],
      ['orchestrator.crossPlatformTriage', 'orchestrator'],
      ['router.severityRouter', 'router'],
    ];
    for (const [id, expectedKind] of cases) {
      expect(findNode(graph, id)?.kind, `kind for ${id}`).toBe(expectedKind);
    }
  });

  it('does not duplicate kind under additionalProperties', () => {
    for (const node of graph.nodes) {
      expect(node.additionalProperties?.kind).toBeUndefined();
    }
  });

  it('surfaces the AST label as additionalProperties.label', () => {
    const generator = findNode(graph, 'generator.classifySeverity');
    expect(generator?.additionalProperties?.label).toBe('Classify Severity');
  });

  it('routes from a router carry additionalProperties.output (route label) and predicate (when expression)', () => {
    const edge = findEdge(
      graph,
      'router.severityRouter',
      'executor.escalateTicket'
    );
    expect(edge).toBeDefined();
    expect(edge?.additionalProperties?.output).toBe('High');
    expect(edge?.additionalProperties?.predicate).toBe(
      '@generator.classifySeverity.output.severity == "high"'
    );
  });

  it('otherwise edges from a router carry output: "otherwise" and no predicate', () => {
    const edge = findEdge(
      graph,
      'router.severityRouter',
      'orchestrator.crossPlatformTriage'
    );
    expect(edge).toBeDefined();
    expect(edge?.additionalProperties?.output).toBe('otherwise');
    expect(edge?.additionalProperties?.predicate).toBeUndefined();
  });

  it('non-router edges only expose lexical positions, no output', () => {
    const edge = findEdge(
      graph,
      'generator.classifySeverity',
      'router.severityRouter'
    );
    expect(edge).toBeDefined();
    expect(edge?.additionalProperties?.output).toBeUndefined();
    expect(
      edge?.additionalProperties?.['lexical-start-position']
    ).toBeDefined();
    expect(edge?.additionalProperties?.['lexical-end-position']).toBeDefined();
  });

  it('never emits additionalProperties.label on any edge', () => {
    for (const edge of graph.edges) {
      expect(edge.additionalProperties?.label).toBeUndefined();
    }
  });

  it('only emits a predicate on edges whose source declared a predicateField sibling', () => {
    // Router routes (RouterRouteBlock has `when` marked predicateField) →
    // predicate present. Otherwise (RouterOtherwiseBlock has no `when`) +
    // every transitionContainer-sourced edge → predicate absent.
    for (const edge of graph.edges) {
      const isRouterRoute = edge.additionalProperties?.predicate !== undefined;
      if (isRouterRoute) {
        const isOtherwise = edge.additionalProperties?.output === 'otherwise';
        expect(isOtherwise).toBe(false);
      }
    }
  });

  it('emits "line,character" lexical-{start,end}-position pairs for every node and edge', () => {
    // Both halves of the range encoded as 0-indexed `"line,character"` per
    // the protocol (e.g. "10,2"). Both must appear together on any item
    // that exposes either.
    const positionPattern = /^\d+,\d+$/;
    for (const item of [...graph.nodes, ...graph.edges]) {
      const start = item.additionalProperties?.['lexical-start-position'];
      const end = item.additionalProperties?.['lexical-end-position'];
      expect(start).toBeDefined();
      expect(end).toBeDefined();
      expect(start).toMatch(positionPattern);
      expect(end).toMatch(positionPattern);
    }
  });

  // ── Golden snapshot ──────────────────────────────────────────────────
  // End-to-end check that the it-help-investigation fixture produces the
  // exact protocol Graph we expect. Update the snapshot with
  // `vitest run -u` after intentional schema/extractor changes.
  it('matches the golden protocol Graph for the it-help-investigation fixture', async () => {
    await expect(JSON.stringify(graph, null, 2) + '\n').toMatchFileSnapshot(
      GOLDEN_PATH
    );
  });
});

// ---------------------------------------------------------------------------
// Schema-extensibility — proves getGraph is dialect-agnostic
// ---------------------------------------------------------------------------

describe('getGraph (schema extensibility)', () => {
  /**
   * Synthetic dialect with one trigger kind and one branching node kind.
   * The branching block embeds a Sequence of routes (`when` predicate +
   * target reference) plus an `otherwise` fallback — the same shape a
   * router takes in any dialect, but using the names `start`, `branch`,
   * `route`, and `cond` to confirm `getGraph` doesn't latch onto
   * agentfabric-specific identifiers.
   */
  const SyntheticTriggerBlock = NamedBlock('SyntheticTriggerBlock', {
    on_message: ProcedureValue.describe('On message procedure.')
      .required()
      .transitionContainer(),
  }).describe('Synthetic trigger.');

  const RouteBlock = Block('RouteBlock', {
    target: ReferenceValue.describe('Route target.')
      .allowedNamespaces(['branch'])
      .resolvedType('transitionTarget')
      .required(),
    cond: ExpressionValue.describe('Route condition.')
      .required()
      .predicateField(),
    label: StringValue.describe('Route label.').outputNameField(),
  });

  const OtherwiseBlock = Block('OtherwiseBlock', {
    target: ReferenceValue.describe('Default route target.')
      .allowedNamespaces(['branch'])
      .resolvedType('transitionTarget')
      .required(),
  });

  const BranchBlock = NamedBlock(
    'BranchBlock',
    {
      label: StringValue.describe('Branch label.').displayLabelField(),
      routes: Sequence(RouteBlock).describe('Conditional routes.'),
      otherwise: OtherwiseBlock.describe('Fallback route.'),
    },
    {
      capabilities: ['transitionTarget'],
      symbol: { kind: SymbolKind.Namespace },
    }
  );

  const LeafBlock = NamedBlock(
    'LeafBlock',
    {
      label: StringValue.describe('Leaf label.').displayLabelField(),
    },
    {
      capabilities: ['transitionTarget'],
      symbol: { kind: SymbolKind.Namespace },
    }
  );

  const SyntheticSchema = {
    start: NamedCollectionBlock(SyntheticTriggerBlock),
    branch: NamedCollectionBlock(BranchBlock),
    leaf: NamedCollectionBlock(LeafBlock),
  };

  const SyntheticSchemaInfo: SchemaInfo = {
    schema: SyntheticSchema,
    aliases: {},
  };

  const source = `
start kickoff:
  on_message: ->
    transition to @branch.choose

branch choose:
  label: "choose"
  routes:
    - target: @leaf.first
      cond: @x == 1
      label: "is one"
    - target: @leaf.second
      cond: @x == 2
      label: "is two"
  otherwise:
    target: @leaf.fallback

leaf first:
  label: "first"

leaf second:
  label: "second"

leaf fallback:
  label: "fallback"
`;

  const parsed = parseWithSchema(source, SyntheticSchema);
  const graph = getGraph(parsed, SyntheticSchemaInfo);

  it('uses the schema namespace as kind for every node, including the trigger', () => {
    // The trigger lives under `start` — its kind comes from that namespace,
    // not from a hardcoded `'trigger'` literal in the adapter.
    expect(graph.nodes.find(n => n.id === 'start.kickoff')?.kind).toBe('start');
    expect(graph.nodes.find(n => n.id === 'branch.choose')?.kind).toBe(
      'branch'
    );
    expect(graph.nodes.find(n => n.id === 'leaf.first')?.kind).toBe('leaf');
  });

  it('emits per-route edges with predicate sourced from any predicateField', () => {
    const firstRoute = graph.edges.find(
      e => e.from === 'branch.choose' && e.to === 'leaf.first'
    );
    expect(firstRoute?.additionalProperties?.output).toBe('is one');
    expect(firstRoute?.additionalProperties?.predicate).toBe('@x == 1');

    const secondRoute = graph.edges.find(
      e => e.from === 'branch.choose' && e.to === 'leaf.second'
    );
    expect(secondRoute?.additionalProperties?.predicate).toBe('@x == 2');

    const otherwise = graph.edges.find(
      e => e.from === 'branch.choose' && e.to === 'leaf.fallback'
    );
    expect(otherwise?.additionalProperties?.output).toBe('otherwise');
    expect(otherwise?.additionalProperties?.predicate).toBeUndefined();
  });

  it('summarises every router-style node via `outputs` regardless of dialect', () => {
    const branch = graph.nodes.find(n => n.id === 'branch.choose');
    expect(branch?.additionalProperties?.outputs).toBe(
      'is one, is two, otherwise'
    );
  });

  it('surfaces displayLabelField as additionalProperties.label', () => {
    expect(
      graph.nodes.find(n => n.id === 'branch.choose')?.additionalProperties
        ?.label
    ).toBe('choose');
    expect(
      graph.nodes.find(n => n.id === 'leaf.first')?.additionalProperties?.label
    ).toBe('first');
  });

  it('does not duplicate kind under additionalProperties', () => {
    for (const node of graph.nodes) {
      expect(node.additionalProperties?.kind).toBeUndefined();
    }
  });

  it('escapes commas in route labels when joining the outputs string', () => {
    // A route label containing a literal comma would otherwise split into
    // two phantom router rows on the consumer side, since `outputs` is
    // joined with `', '`. The dialect emits `\,` for embedded commas.
    const sourceWithComma = `
start kickoff:
  on_message: ->
    transition to @branch.choose

branch choose:
  label: "choose"
  routes:
    - target: @leaf.first
      cond: @x == 1
      label: "yes, sir"
  otherwise:
    target: @leaf.fallback

leaf first:
  label: "first"

leaf fallback:
  label: "fallback"
`;
    const parsedComma = parseWithSchema(sourceWithComma, SyntheticSchema);
    const graphComma = getGraph(parsedComma, SyntheticSchemaInfo);
    const branch = graphComma.nodes.find(n => n.id === 'branch.choose');
    // The comma in the label is escaped so the consumer can recover the
    // single label `yes, sir` instead of seeing `yes` and `sir`.
    expect(branch?.additionalProperties?.outputs).toBe('yes\\, sir, otherwise');

    // Per-edge `output` is left unescaped so the UI's
    // `routerOutputHandleId(edge.output)` produces a handle id that
    // matches the per-row handle the router renders after parsing the
    // (escaped) `outputs` summary. If a future change starts escaping
    // both, this asserts the round-trip still lands on `'yes, sir'`.
    const route = graphComma.edges.find(
      e => e.from === 'branch.choose' && e.to === 'leaf.first'
    );
    expect(route?.additionalProperties?.output).toBe('yes, sir');
  });
});
