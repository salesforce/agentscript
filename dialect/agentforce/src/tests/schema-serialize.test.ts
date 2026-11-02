/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  buildSerializedSchema,
  DIAGNOSTIC_CODES,
} from '../schema-serialize.js';
import { defaultRules as agentforceRules } from '../lint/passes/index.js';

describe('DIAGNOSTIC_CODES', () => {
  it('has an entry for every lint pass id, and no stale entries', () => {
    const passIds = agentforceRules()
      .map(pass => pass.id)
      .sort();
    const mapKeys = Object.keys(DIAGNOSTIC_CODES).sort();

    expect(mapKeys).toEqual(passIds);
  });
});

describe('buildSerializedSchema', () => {
  it('includes actionTargetSchemes with all 25 schemes', () => {
    const schema = buildSerializedSchema();

    expect(schema.actionTargetSchemes).toBeDefined();
    expect(schema.actionTargetSchemes.length).toBe(25);

    // Verify presence of all expected schemes
    const expectedSchemes = [
      'api',
      'apex',
      'apexRest',
      'auraEnabled',
      'cdpMlPrediction',
      'createCatalogItemRequest',
      'decisionTableAction',
      'executeIntegrationProcedure',
      'expressionSet',
      'externalConnector',
      'externalService',
      'flow',
      'generatePromptResponse',
      'integrationProcedureAction',
      'mcpTool',
      'platformMcpTool',
      'namedQuery',
      'placeholder',
      'prompt',
      'quickAction',
      'retriever',
      'runExpressionSet',
      'serviceCatalog',
      'slack',
      'standardInvocableAction',
    ];

    for (const scheme of expectedSchemes) {
      expect(schema.actionTargetSchemes).toContain(scheme);
    }

    // Specifically verify standardInvocableAction (mentioned in requirements)
    expect(schema.actionTargetSchemes).toContain('standardInvocableAction');
  });

  it('exposes variables modifiers as [mutable, linked] without context', () => {
    const schema = buildSerializedSchema();

    const variablesBlock = schema.rootBlocks.variables;
    expect(variablesBlock).toBeDefined();
    expect(variablesBlock.fieldKind).toBe('TypedMap');
    if (variablesBlock.fieldKind !== 'TypedMap') throw new Error('unreachable');
    expect(variablesBlock.modifiers).toBeDefined();

    // Should have exactly mutable and linked
    expect(variablesBlock.modifiers).toHaveLength(2);
    expect(variablesBlock.modifiers).toContain('mutable');
    expect(variablesBlock.modifiers).toContain('linked');

    // Should NOT have context
    expect(variablesBlock.modifiers).not.toContain('context');
  });

  it('includes end_session in globalScopes.utils.members', () => {
    const schema = buildSerializedSchema();

    const utils = schema.globalScopes.utils;
    expect(utils).toBeDefined();
    expect(utils.members.end_session).toBeDefined();
    expect(utils.members.end_session.capability).toBe('invocationTarget');
  });

  it('includes knowledge and connection in root blocks', () => {
    const schema = buildSerializedSchema();

    expect(schema.rootBlocks.knowledge).toBeDefined();
    expect(schema.rootBlocks.connection).toBeDefined();

    // Should NOT have knowledge_actions or connections (old names)
    expect(schema.rootBlocks.knowledge_actions).toBeUndefined();
    expect(schema.rootBlocks.connections).toBeUndefined();
  });

  it('maintains backward compatibility: global scopes emit typed members', () => {
    const schema = buildSerializedSchema();

    const systemVariables = schema.globalScopes.system_variables;
    expect(systemVariables).toBeDefined();

    // Leaf primitive members carry their declared type.
    expect(systemVariables.members.user_input).toEqual({ type: 'string' });

    // Nested members serialize their subMembers to arbitrary depth.
    const lastReply = systemVariables.members.last_reply;
    expect(lastReply.subMembers).toBeDefined();
    expect(lastReply.subMembers?.interrupted).toEqual({ type: 'boolean' });
    expect(lastReply.subMembers?.interrupted_heard_text).toEqual({
      type: 'string',
    });
  });

  it('includes agentTypes with AgentforceServiceAgent and CustomAgent', () => {
    const schema = buildSerializedSchema();

    expect(schema.agentTypes).toBeDefined();
    expect(schema.agentTypes.length).toBeGreaterThan(0);

    // Spot-check specific agent types
    expect(schema.agentTypes).toContain('AgentforceServiceAgent');
    expect(schema.agentTypes).toContain('CustomAgent');
  });

  it('includes connectedAgentSchemes with agent and agentforce', () => {
    const schema = buildSerializedSchema();

    expect(schema.connectedAgentSchemes).toBeDefined();
    expect(schema.connectedAgentSchemes.length).toBe(2);
    expect(schema.connectedAgentSchemes).toContain('agent');
    expect(schema.connectedAgentSchemes).toContain('agentforce');
  });

  it('includes responseFormatTargetSchemes', () => {
    const schema = buildSerializedSchema();

    expect(schema.responseFormatTargetSchemes).toBeDefined();
    expect(schema.responseFormatTargetSchemes.length).toBeGreaterThan(0);

    // Spot-check some expected schemes
    expect(schema.responseFormatTargetSchemes).toContain('apex');
    expect(schema.responseFormatTargetSchemes).toContain('flow');
    expect(schema.responseFormatTargetSchemes).toContain('system');
  });

  it('includes connectionInputTypes with string, number, boolean', () => {
    const schema = buildSerializedSchema();

    expect(schema.connectionInputTypes).toBeDefined();
    expect(schema.connectionInputTypes.length).toBe(3);
    expect(schema.connectionInputTypes).toContain('string');
    expect(schema.connectionInputTypes).toContain('number');
    expect(schema.connectionInputTypes).toContain('boolean');
  });
});
