/**
 * AgentGraph — the top-level compiler output type.
 * Mirrors the Python AgentGraph class from unified_agent_specification_adaptor.py.
 */

import type { UnifiedAgentSpecification } from './unified-agent-specification.js';
import type { LLMProvider, InvokableClient } from './service-types.js';

export interface AgentGraphTrigger {
  id: string;
  kind: 'a2a';
  namespace: string;
  target_id: string;
  on_message: {
    transition_to: string;
  };
}

export interface AgentGraph {
  unifiedAgentSpec: UnifiedAgentSpecification;
  llmProviders: LLMProvider[];
  invokableClients: InvokableClient[];
  responseNodeNames: string[];
  trigger: AgentGraphTrigger | null;
  /** Mapping of output-structure ref ids to outputStructure schemas.
   *  Node-level linkage is carried by `llm.output-structure-ref`. */
  outputStructures: Record<string, Record<string, unknown>>;
}
