/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import {
  CollectionBlock,
  NamedBlock,
  StringValue,
  SymbolKind,
} from '@agentscript/language';

/**
 * A single skill reference attached to a subagent.
 */
export const AFSkillBlock = NamedBlock(
  'SkillBlock',
  {
    target: StringValue.describe(
      'External skill target URI (e.g., "skill://Developer_Name_v2").'
    ).required(),
  },
  {
    symbol: { kind: SymbolKind.Method },
    scopeAlias: 'skill',
    capabilities: ['invocationTarget'],
  }
).describe('Skill reference — an external capability the subagent can invoke.');

export const AFSkillsBlock = CollectionBlock(AFSkillBlock).describe(
  'Collection of skill references available to this subagent.'
);
