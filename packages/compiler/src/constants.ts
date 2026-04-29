/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

// ---------------------------------------------------------------------------
// Schema version
// ---------------------------------------------------------------------------

export const SCHEMA_VERSION = '2.0' as const;

// ---------------------------------------------------------------------------
// Internal variable names
// ---------------------------------------------------------------------------

export const NEXT_TOPIC_VARIABLE = 'AgentScriptInternal_next_topic';
export const AGENT_INSTRUCTIONS_VARIABLE =
  'AgentScriptInternal_agent_instructions';
export const RUNTIME_CONDITION_VARIABLE = 'AgentScriptInternal_condition';

export const EMPTY_TOPIC_VALUE = '"__EMPTY__"';
export const NEXT_TOPIC_EMPTY_CONDITION = `state.${NEXT_TOPIC_VARIABLE}=="${EMPTY_TOPIC_VALUE.replace(/"/g, '')}"`;

export const EMPTY_ESCALATION_NODE_VALUE = "'__human__'";
export const ESCALATION_TARGET = '__human__';

export const END_SESSION_NODE_VALUE = "'end_session'";
export const END_SESSION_TARGET = '__end_session_action__';

// ---------------------------------------------------------------------------
// Transition target namespaces
// ---------------------------------------------------------------------------

/** Namespaces accepted when resolving transition `to` targets. */
export const TRANSITION_TARGET_NAMESPACES = [
  'topic',
  'subagent',
  'start_agent',
  'connected_subagent',
];

// ---------------------------------------------------------------------------
// Synthetic action targets
// ---------------------------------------------------------------------------

export const STATE_UPDATE_ACTION = '__state_update_action__';

// ---------------------------------------------------------------------------
// Default planner type
// ---------------------------------------------------------------------------

export const DEFAULT_PLANNER_TYPE =
  'Atlas__ConcurrentMultiAgentOrchestration' as const;

// ---------------------------------------------------------------------------
// Default agent type
// ---------------------------------------------------------------------------

export const DEFAULT_AGENT_TYPE = 'EinsteinServiceAgent' as const;

// ---------------------------------------------------------------------------
// Reasoning type
// ---------------------------------------------------------------------------

export const DEFAULT_REASONING_TYPE = 'salesforce.default';

// ---------------------------------------------------------------------------
// Hyperclassifier model URI prefix
// ---------------------------------------------------------------------------

export const HYPERCLASSIFIER_MODEL_PREFIX =
  'sfdc_ai__DefaultEinsteinHyperClassifier';

// ---------------------------------------------------------------------------
// Internal state variable generators
// ---------------------------------------------------------------------------

import type { StateVariable } from './types.js';

export type InternalStateVariable = StateVariable;

export const ALWAYS_PRESENT_STATE_VARIABLES: InternalStateVariable[] = [
  {
    developer_name: NEXT_TOPIC_VARIABLE,
    label: 'Next Topic',
    description: 'The next topic to be visited',
    data_type: 'string',
    is_list: false,
    default: EMPTY_TOPIC_VALUE,
    visibility: 'Internal',
  },
];

export const INSTRUCTION_STATE_VARIABLE: InternalStateVariable = {
  developer_name: AGENT_INSTRUCTIONS_VARIABLE,
  label: 'Agent Instructions',
  description: 'The agent instructions',
  data_type: 'string',
  is_list: false,
  default: "''",
  visibility: 'Internal',
};

export const CONDITION_STATE_VARIABLE: InternalStateVariable = {
  developer_name: RUNTIME_CONDITION_VARIABLE,
  label: 'Runtime Condition',
  description: 'Runtime condition evaluation for if statements',
  data_type: 'boolean',
  is_list: false,
  visibility: 'Internal',
};

/**
 * Set of internal state variable names that are always present
 * (used to avoid duplication with user-defined variables).
 */
export const ALWAYS_PRESENT_STATE_VARIABLE_NAMES = new Set(
  ALWAYS_PRESENT_STATE_VARIABLES.map(v => v.developer_name)
);
