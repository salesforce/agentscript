/**
 * Main compile() function — transforms parsed AgentFabric AST into AgentGraph.
 * Mirrors the UnifiedAgentSpecificationAdaptor._adapt() flow from the Python adaptor.
 */

import type { AgentGraph, AgentGraphTrigger } from './agent-graph.js';
import type { UnifiedAgentSpecification } from './unified-agent-specification.js';
import type { CompilerDiagnostic } from './compiler-context.js';
import { AgentFabricCompilerContext } from './compiler-context.js';
import { buildDefinitions } from './build-definitions.js';
import { buildLLMProviders, buildInvokableClients } from './build-providers.js';
import {
  buildNodes,
  buildStateVariables,
  resolveInitialNode,
  collectResponseNodeNames,
  injectNodeInputTracking,
} from './build-nodes.js';
import { extractString, extractTransitionReference } from './utils.js';

export interface CompileResult {
  output: AgentGraph;
  diagnostics: CompilerDiagnostic[];
}

/** Optional original source text (used by source-based fallbacks, e.g. llm/tool extraction). */
export interface CompileOptions {
  source?: string;
}

const SCHEMA_VERSION = '2.0.0';

function parseTriggerTarget(target: string | undefined): {
  namespace: string;
  target_id: string;
} {
  if (!target) return { namespace: '', target_id: '' };
  const trimmed = target.trim();
  const match = trimmed.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]+)/);
  if (!match) return { namespace: '', target_id: '' };
  const namespace = match[1];
  const authority = match[2];
  return {
    namespace,
    target_id: authority.split(':')[0] ?? '',
  };
}

function buildCompiledTrigger(
  triggers: Map<string, Record<string, unknown>> | undefined
): AgentGraphTrigger | null {
  if (!triggers || triggers.size === 0) return null;
  const [triggerId, triggerEntry] = triggers.entries().next().value as [
    string,
    Record<string, unknown>,
  ];
  const kind = extractString(triggerEntry.kind) ?? 'a2a';
  if (kind !== 'a2a') return null;
  const parsedTarget = parseTriggerTarget(extractString(triggerEntry.target));

  return {
    id: triggerId,
    kind: 'a2a',
    namespace: parsedTarget.namespace,
    target_id: parsedTarget.target_id,
    on_message: {
      transition_to: extractTransitionReference(triggerEntry.on_message),
    },
  };
}

function extractLlmNamesFromSource(source: string): string[] {
  const lines = source.split(/\r?\n/);
  const names: string[] = [];
  let inLlmBlock = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!inLlmBlock) {
      if (trimmed === 'llm:') inLlmBlock = true;
      continue;
    }
    if (trimmed.length === 0) continue;
    if (!line.startsWith('  ')) break;
    if (line.startsWith('    ')) continue;
    const m = line.match(/^\s{2}([^:]+):\s*$/);
    if (m) names.push(m[1].trim());
  }
  return names;
}

function createLlmNameAliases(
  llmEntries: Map<string, Record<string, unknown>> | undefined,
  source: string | undefined
): Map<string, string> {
  const aliases = new Map<string, string>();
  if (!llmEntries) return aliases;
  if (!source) {
    for (const [name] of llmEntries) aliases.set(name, name);
    return aliases;
  }
  const sourceNames = extractLlmNamesFromSource(source);
  let i = 0;
  for (const [name] of llmEntries) {
    aliases.set(name, sourceNames[i] ?? name);
    i += 1;
  }
  return aliases;
}

export function compile(
  ast: Record<string, unknown>,
  options?: CompileOptions
): CompileResult {
  const ctx = new AgentFabricCompilerContext();

  // Extract top-level blocks from the parsed AST
  const config = ast.config as Record<string, unknown> | undefined;
  const llmEntries = ast.llm as
    | Map<string, Record<string, unknown>>
    | undefined;
  const actionDefs = ast.actions as
    | Map<string, Record<string, unknown>>
    | undefined;
  const triggers = ast.trigger as
    | Map<string, Record<string, unknown>>
    | undefined;
  const echoEntries = ast.echo as
    | Map<string, Record<string, unknown>>
    | undefined;

  const llmNameAliases = createLlmNameAliases(llmEntries, options?.source);

  // 1. Build LLM providers
  const llmProviders = buildLLMProviders(llmEntries, llmNameAliases, ctx);

  // 2. Build invokable clients
  const invokableClients = buildInvokableClients(actionDefs, ctx);

  // 3. Build definitions (ActionDefinitions + IdentityAction)
  const definitions = buildDefinitions(actionDefs, ctx);

  // 4. Resolve initial node from trigger (linter guarantees trigger exists)
  const initialNode = resolveInitialNode(triggers!);

  // 5. Build graph nodes and collect outputStructures discovered during
  //    node-level LLM/output-structure resolution.
  const builtNodes = buildNodes(
    ast,
    llmEntries,
    actionDefs,
    initialNode,
    options?.source,
    llmNameAliases
  );
  const { nodes, outputStructures } = builtNodes;

  // 6. Inject _node_input tracking (handoff breadcrumbs + on-init lookups)
  const trackingInjected = injectNodeInputTracking(nodes);

  // 7. Build state variables (built-in outputs + `variables:` declarations)
  const stateVariables = buildStateVariables(ast);
  if (trackingInjected) {
    const trackingVarNames = new Set(stateVariables.map(v => v.name));
    if (!trackingVarNames.has('_handoff_source')) {
      stateVariables.push({
        name: '_handoff_source',
        'data-type': 'string',
        default: null,
        label: '',
        description: '',
      });
    }
    if (!trackingVarNames.has('_node_input')) {
      stateVariables.push({
        name: '_node_input',
        'data-type': 'string',
        default: null,
        label: '',
        description: '',
      });
    }
  }

  // 8. Collect response node names
  const responseNodeNames = collectResponseNodeNames(echoEntries);

  // 9. Extract config fields
  const agentName = extractString(config?.agent_name) ?? '';
  const label = extractString(config?.label) ?? agentName;

  // 10. Assemble UnifiedAgentSpecification
  const spec: UnifiedAgentSpecification = {
    'schema-version': SCHEMA_VERSION,
    id: agentName,
    label,
    definitions: definitions.length > 0 ? definitions : null,
    graph: {
      'state-variables': stateVariables,
      'initial-node': initialNode,
      nodes,
    },
  };

  // 11. Assemble AgentGraph
  const agentGraph: AgentGraph = {
    unifiedAgentSpec: spec,
    llmProviders,
    invokableClients,
    responseNodeNames,
    trigger: buildCompiledTrigger(triggers),
    outputStructures,
  };

  return {
    output: agentGraph,
    diagnostics: ctx.diagnostics,
  };
}
