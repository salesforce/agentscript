/**
 * Strongly-typed representations of parsed AgentForce document blocks.
 *
 * All types are generated from the AgentForce dialect schema via codegen,
 * so they stay in sync with the dialect automatically.
 */

export type {
  ParsedAgentforce,
  ParsedConfig,
  ParsedSystem,
  ParsedLanguage,
  ParsedModality,
  ParsedVoiceModality,
  ParsedKnowledge,
  ParsedSecurity,
  ParsedTopic,
  ParsedSubagent,
  ParsedStartAgent,
  ParsedTopicReasoning,
  ParsedConnection,
  ParsedConnectedAgent,
  ParsedReasoningAction,
  ParsedMessages,
} from '@agentscript/agentforce-dialect';

import type {
  ParsedTopic,
  ParsedSubagent,
  ParsedStartAgent,
  ParsedReasoningAction,
} from '@agentscript/agentforce-dialect';

/** Reasoning action parsed type (used throughout the compiler as ParsedTool). */
export type ParsedTool = ParsedReasoningAction;

/**
 * Union type for the compiler — accepts topic, subagent, and start_agent blocks.
 * The compiler normalizes all to the same SubAgentNode output.
 */
export type ParsedTopicLike = (
  | ParsedTopic
  | ParsedSubagent
  | ParsedStartAgent
) &
  Record<string, unknown>;
