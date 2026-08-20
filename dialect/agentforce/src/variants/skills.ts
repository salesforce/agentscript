/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import {
  NamedBlock,
  NamedCollectionBlock,
  StringValue,
  SymbolKind,
} from '@agentscript/language';

/**
 * A single skill reference attached to a subagent.
 * AF Skills schema shape should reflect that of
 * since skills are primarily stored and CRUDed via the SkillBuilder API.
 **/

export const AFSkillDefinitionBlock = NamedBlock(
  'SkillBlock',
  {
    instructions: StringValue.describe(
      `When present, it implies that this skill is an inline skill. Required if 'target' is NOT present.
      SKILL.md body. YAML frontmatter optional but recommended.`
    ),
    target: StringValue.describe(
      `When present, it implies that this skill is an external / AgentForce SkillStore skill that follows a URI pattern URI (e.g., 'skill://Developer_Name_v2').
       Conditionally required if 'instructions' is NOT present`
    ),
    description: StringValue.describe(
      "Description. Conditionally required for inline skills (when 'target' is NOT present)."
    ),
    label: StringValue.describe('Display label.'),
  },
  {
    symbol: { kind: SymbolKind.Method },
    scopeAlias: 'skill_definitions',
    capabilities: ['invocationTarget'],
  }
).describe(
  'A top-level skill definition — an external or inline capability a subagent can reference by name.'
);

export const AFSkillDefinitionsBlock = NamedCollectionBlock(
  AFSkillDefinitionBlock
).describe(
  'Top-level collection of skill definitions, referenced from a subagent via @skill_definitions.<name>.'
);
