import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  NamedBlock,
  NamedCollectionBlock,
  ProcedureValue,
  ReferenceValue,
  StringValue,
  SymbolKind,
} from '@agentscript/language';
import type { SchemaInfo } from '@agentscript/language';
import { parseDocument, parseWithSchema } from '../tests/test-utils.js';
import { AgentFabricSchemaInfo } from '../schema.js';
import { extractGraph } from './extractor.js';
import type { ExtractedGraph, GraphEdge } from './extractor.js';
import type { Range } from '@agentscript/language';

const FIXTURE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../tests/resources/it-help-investigation.agent'
);

function hasEdge(
  graph: ExtractedGraph,
  predicate: Partial<GraphEdge>
): boolean {
  return graph.edges.some(e =>
    Object.entries(predicate).every(
      ([k, v]) => (e as unknown as Record<string, unknown>)[k] === v
    )
  );
}

function outgoingEdgesOf(graph: ExtractedGraph, fromId: string): GraphEdge[] {
  return graph.edges.filter(e => e.from === fromId);
}

/**
 * Slice the source text by a `Range`. Single-line ranges only — multi-line
 * ranges in the test fixture are not asserted.
 */
function sliceSource(source: string, range: Range): string {
  const lines = source.split(/\r?\n/);
  const { start, end } = range;
  if (start.line !== end.line) {
    throw new Error(
      `multi-line ranges not supported in test slice (start ${start.line} end ${end.line})`
    );
  }
  return lines[start.line].slice(start.character, end.character);
}

describe('extractGraph (agentfabric fixture)', () => {
  const source = readFileSync(FIXTURE_PATH, 'utf8');
  const parsed = parseDocument(source);
  const graph = extractGraph(parsed, AgentFabricSchemaInfo);

  it('discovers the trigger as a node with blockKind: TriggerBlock', () => {
    const triggers = graph.nodes.filter(n => n.blockKind === 'TriggerBlock');
    expect(triggers).toHaveLength(1);
    expect(triggers[0]).toMatchObject({
      id: 'trigger.ticketTrigger',
      namespace: 'trigger',
      name: 'ticketTrigger',
      blockKind: 'TriggerBlock',
    });
  });

  it('collects every entry (triggers + transition-target blocks) in the fixture', () => {
    const ids = graph.nodes.map(n => n.id).sort();
    expect(ids).toEqual(
      [
        'echo.escalationResponse',
        'echo.helpResponse',
        'echo.licenseResponse',
        'echo.unresolvedResponse',
        'executor.escalateTicket',
        'executor.escalateUnresolved',
        'generator.classifySeverity',
        'generator.helpSummary',
        'generator.licenseSummary',
        'orchestrator.crossPlatformTriage',
        'router.resolutionRouter',
        'router.severityRouter',
        'trigger.ticketTrigger',
      ].sort()
    );
  });

  it('emits the trigger entry edge via transitionContainer (tagged trigger)', () => {
    expect(
      hasEdge(graph, {
        from: 'trigger.ticketTrigger',
        to: 'generator.classifySeverity',
        via: 'trigger',
      })
    ).toBe(true);
  });

  it('emits transitionContainer edges from generators', () => {
    expect(
      hasEdge(graph, {
        from: 'generator.classifySeverity',
        to: 'router.severityRouter',
        via: 'transitionContainer',
      })
    ).toBe(true);
    expect(
      hasEdge(graph, {
        from: 'generator.helpSummary',
        to: 'echo.helpResponse',
        via: 'transitionContainer',
      })
    ).toBe(true);
  });

  it('emits transitionTarget edges from a router (route + otherwise)', () => {
    expect(
      hasEdge(graph, {
        from: 'router.severityRouter',
        to: 'executor.escalateTicket',
        via: 'transitionTarget',
      })
    ).toBe(true);
    expect(
      hasEdge(graph, {
        from: 'router.severityRouter',
        to: 'orchestrator.crossPlatformTriage',
        via: 'transitionTarget',
      })
    ).toBe(true);
    // resolutionRouter has two routes + one otherwise — three outgoing edges.
    expect(outgoingEdgesOf(graph, 'router.resolutionRouter')).toHaveLength(3);
  });

  it('captures sibling primitive properties on router-route edges (label + when expression)', () => {
    // Route edge → both `label` (StringLiteral) and `when` (expression
    // source text) collected as sibling primitives.
    const routeEdge = graph.edges.find(
      e =>
        e.from === 'router.severityRouter' && e.to === 'executor.escalateTicket'
    );
    expect(routeEdge).toBeDefined();
    expect(routeEdge?.properties).toEqual({
      label: 'High',
      when: '@generator.classifySeverity.output.severity == "high"',
    });
    // The schema-marked siblings are also surfaced as dedicated fields so
    // adapters don't reach into `properties` by hardcoded names.
    expect(routeEdge?.outputName).toBe('High');
    expect(routeEdge?.predicate).toBe(
      '@generator.classifySeverity.output.severity == "high"'
    );

    // Otherwise has no `label` and no `when` — properties bag absent and
    // the structured surfaces are undefined.
    const otherwiseEdge = graph.edges.find(
      e =>
        e.from === 'router.severityRouter' &&
        e.to === 'orchestrator.crossPlatformTriage'
    );
    expect(otherwiseEdge).toBeDefined();
    expect(otherwiseEdge?.properties).toBeUndefined();
    expect(otherwiseEdge?.outputName).toBeUndefined();
    expect(otherwiseEdge?.predicate).toBeUndefined();

    // Non-router edges (transitionContainer) get no properties bag either.
    const triggerEdge = graph.edges.find(
      e => e.from === 'trigger.ticketTrigger'
    );
    expect(triggerEdge?.properties).toBeUndefined();
    expect(triggerEdge?.outputName).toBeUndefined();
    expect(triggerEdge?.predicate).toBeUndefined();
  });

  it('captures top-level string-literal fields on graph nodes', () => {
    const classifySeverity = graph.nodes.find(
      n => n.id === 'generator.classifySeverity'
    );
    // GeneratorBlock carries `description` and `label` as StringValue.
    expect(classifySeverity?.properties).toMatchObject({
      label: 'Classify Severity',
    });
    expect(classifySeverity?.properties?.description).toContain('Classifies');
  });

  it('emits an edge from executor.escalateTicket to its echo on_exit', () => {
    expect(
      hasEdge(graph, {
        from: 'executor.escalateTicket',
        to: 'echo.escalationResponse',
        via: 'transitionContainer',
      })
    ).toBe(true);
  });

  it('produces no outgoing edges for terminal echo nodes (no on_exit)', () => {
    expect(outgoingEdgesOf(graph, 'echo.escalationResponse')).toHaveLength(0);
    expect(outgoingEdgesOf(graph, 'echo.helpResponse')).toHaveLength(0);
    expect(outgoingEdgesOf(graph, 'echo.licenseResponse')).toHaveLength(0);
    expect(outgoingEdgesOf(graph, 'echo.unresolvedResponse')).toHaveLength(0);
  });

  it('attaches a lexicalRange to every node and edge', () => {
    for (const node of graph.nodes) {
      expect(node.lexicalRange, `node ${node.id}`).toBeDefined();
    }
    for (const edge of graph.edges) {
      expect(edge.lexicalRange, `edge ${edge.from}->${edge.to}`).toBeDefined();
    }
  });

  it('uses the MemberExpression range for transitionTarget edges and the ToClause range for transitionContainer edges', () => {
    // Router route → MemberExpression (`@executor.escalateTicket`).
    const refEdge = graph.edges.find(
      e =>
        e.from === 'router.severityRouter' &&
        e.to === 'executor.escalateTicket' &&
        e.via === 'transitionTarget'
    )!;
    expect(sliceSource(source, refEdge.lexicalRange!)).toBe(
      '@executor.escalateTicket'
    );

    // Generator → router via `to @router.severityRouter` — the ToClause
    // covers the `to ` keyword plus the MemberExpression.
    const containerEdge = graph.edges.find(
      e =>
        e.from === 'generator.classifySeverity' &&
        e.to === 'router.severityRouter' &&
        e.via === 'transitionContainer'
    )!;
    expect(sliceSource(source, containerEdge.lexicalRange!)).toBe(
      'to @router.severityRouter'
    );
  });
});

// ---------------------------------------------------------------------------
// Schema-extensibility test: prove the extractor is generic
// ---------------------------------------------------------------------------

describe('extractGraph (schema extensibility)', () => {
  /**
   * A synthetic dialect with one trigger kind and one custom node kind
   * (`widget`). Neither name nor any other identifier in the extractor
   * code knows anything about these blocks — they're discovered purely
   * from `capabilities` + `transitionContainer` markers.
   */
  const SyntheticTriggerBlock = NamedBlock('SyntheticTriggerBlock', {
    target: StringValue.describe('Trigger target.'),
    on_message: ProcedureValue.describe('On message procedure.')
      .required()
      .transitionContainer(),
  }).describe('Synthetic trigger block.');

  const WidgetBlock = NamedBlock(
    'WidgetBlock',
    {
      label: StringValue.describe('Widget label.'),
      next: ReferenceValue.describe('Next widget reference.')
        .allowedNamespaces(['widget'])
        .resolvedType('transitionTarget'),
      after: ProcedureValue.describe(
        'Procedure to run after.'
      ).transitionContainer(),
    },
    {
      capabilities: ['transitionTarget'],
      symbol: { kind: SymbolKind.Namespace },
    }
  ).describe('Custom widget node.');

  const SyntheticSchema = {
    sigtrigger: NamedCollectionBlock(SyntheticTriggerBlock),
    widget: NamedCollectionBlock(WidgetBlock),
  };

  const SyntheticSchemaInfo: SchemaInfo = {
    schema: SyntheticSchema,
    aliases: {},
  };

  it('discovers a custom trigger + node kind without any extractor change', () => {
    const source = `
sigtrigger entry:
  target: "stub://entry"
  on_message: ->
    transition to @widget.first

widget first:
  label: "first"
  after: ->
    transition to @widget.second

widget second:
  label: "second"
  next: @widget.third

widget third:
  label: "third"
`;
    const parsed = parseWithSchema(source, SyntheticSchema);
    const graph = extractGraph(parsed, SyntheticSchemaInfo);

    const triggers = graph.nodes.filter(
      n => n.blockKind === 'SyntheticTriggerBlock'
    );
    expect(triggers).toHaveLength(1);
    expect(triggers[0].id).toBe('sigtrigger.entry');

    const widgetIds = graph.nodes
      .filter(n => n.blockKind === 'WidgetBlock')
      .map(n => n.id)
      .sort();
    expect(widgetIds).toEqual([
      'widget.first',
      'widget.second',
      'widget.third',
    ]);

    // Trigger entry edge tagged 'trigger'.
    expect(
      hasEdge(graph, {
        from: 'sigtrigger.entry',
        to: 'widget.first',
        via: 'trigger',
      })
    ).toBe(true);

    // transitionContainer edge inside a widget.
    expect(
      hasEdge(graph, {
        from: 'widget.first',
        to: 'widget.second',
        via: 'transitionContainer',
      })
    ).toBe(true);

    // resolvedType: transitionTarget edge from a reference field.
    expect(
      hasEdge(graph, {
        from: 'widget.second',
        to: 'widget.third',
        via: 'transitionTarget',
      })
    ).toBe(true);

    // Terminal widget — no outgoing edges.
    expect(outgoingEdgesOf(graph, 'widget.third')).toHaveLength(0);

    // Generic property collection works for an unknown schema. The
    // `label` sibling on widget.second is picked up purely from
    // schema-driven primitive introspection.
    const refEdge = graph.edges.find(
      e => e.from === 'widget.second' && e.to === 'widget.third'
    );
    expect(refEdge?.properties).toEqual({ label: 'second' });

    // Top-level node properties surface widget labels too.
    const widgetFirst = graph.nodes.find(n => n.id === 'widget.first');
    expect(widgetFirst?.properties).toEqual({ label: 'first' });
  });
});
