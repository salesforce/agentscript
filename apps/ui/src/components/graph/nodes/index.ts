/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { StartNode } from './StartNode';
import { TopicNode } from './TopicNode';
import { ActionNode } from './ActionNode';
import { CompoundTopicNode } from './CompoundTopicNode';
import { ConditionalNode } from './ConditionalNode';
import { TransitionNode } from './TransitionNode';
import { RunNode } from './RunNode';
import { SetNode } from './SetNode';
import { TemplateNode } from './TemplateNode';
import { PhaseNode } from './PhaseNode';
import { LlmNode } from './LlmNode';
import { ReasoningGroupNode } from './ReasoningGroupNode';
import { BuildInstructionsNode } from './BuildInstructionsNode';
export {
  StartNode,
  TopicNode,
  ActionNode,
  CompoundTopicNode,
  ConditionalNode,
  TransitionNode,
  RunNode,
  SetNode,
  TemplateNode,
  PhaseNode,
  LlmNode,
  ReasoningGroupNode,
  BuildInstructionsNode,
};

/** Node type registry for React Flow */
export const graphNodeTypes = {
  start: StartNode,
  'start-agent': TopicNode,
  topic: TopicNode,
  action: ActionNode,
  'compound-topic': CompoundTopicNode,
  conditional: ConditionalNode,
  transition: TransitionNode,
  run: RunNode,
  set: SetNode,
  template: TemplateNode,
  phase: PhaseNode,
  'phase-label': PhaseNode,
  llm: LlmNode,
  'reasoning-group': ReasoningGroupNode,
  'build-instructions': BuildInstructionsNode,
} as const;
