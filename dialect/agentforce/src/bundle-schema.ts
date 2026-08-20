/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Agentforce plugin authoring schema.
 *
 * Plugins are independent `.plugin` bundles containing a constrained subset
 * of Agentforce constructs. They may contribute system instructions, actions,
 * workflows, and subagents. Agent-only configuration and top-level skills are
 * intentionally excluded.
 */

import {
  NamedCollectionBlock,
  createSchemaContext,
} from '@agentscript/language';
import type {
  DialectConfig,
  FieldType,
  SchemaContext,
  SchemaInfo,
} from '@agentscript/language';
import { WorkflowBlock } from '@agentscript/agentscript-dialect';
import {
  AFActionsBlock,
  AFSubagentBlock,
  AFSystemBlock,
  AgentforceSchemaInfo,
} from './schema.js';
import { defaultRules } from './lint/passes/index.js';
import { DIALECT_VERSION } from './pkg-meta.js';

/** Dialect selected by `# @dialect: agentforce-plugin`. */
export const AGENTFORCE_PLUGIN_DIALECT_NAME = 'agentforce-plugin';

export const AgentforcePluginSchema = {
  system: AFSystemBlock.pick(['instructions']).describe(
    'System instructions contributed by the plugin and appended to the host agent instructions.'
  ),
  actions: AFActionsBlock.describe(
    'Agentforce action definitions exposed by the plugin.'
  ),
  workflows: NamedCollectionBlock(WorkflowBlock),
  subagent: NamedCollectionBlock(AFSubagentBlock),
} satisfies Record<string, FieldType>;

export type AgentforcePluginSchema = typeof AgentforcePluginSchema;

export const AgentforcePluginSchemaAliases: Record<string, string> = {};

export const AgentforcePluginSchemaInfo: SchemaInfo = {
  schema: AgentforcePluginSchema as Record<string, FieldType>,
  aliases: AgentforcePluginSchemaAliases,
  globalScopes: AgentforceSchemaInfo.globalScopes,
  nodeMemberAccess: AgentforceSchemaInfo.nodeMemberAccess,
};

export const agentforcePluginSchemaContext: SchemaContext = createSchemaContext(
  AgentforcePluginSchemaInfo
);

export const agentforcePluginDialect: DialectConfig = {
  name: AGENTFORCE_PLUGIN_DIALECT_NAME,
  displayName: 'Agentforce Plugin',
  description:
    'Agentforce plugin bundle containing system instructions, actions, workflows, and subagents',
  version: DIALECT_VERSION,
  schemaInfo: AgentforcePluginSchemaInfo,
  createRules: defaultRules,
  source: 'agentforce-plugin-lint',
};
