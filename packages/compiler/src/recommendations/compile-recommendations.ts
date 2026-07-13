/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { RecommendedPromptsConfiguration } from '../types.js';
import type { CompilerContext } from '../compiler-context.js';
import { extractBooleanValue } from '../ast-helpers.js';
import { extractStringSequence } from '../modality/extract-sequence.js';

/**
 * Compile recommended prompts from the system > recommended_prompts block.
 *
 * Script fields map 1:1 to output fields (snake_case convention):
 *   in_conversation         → in_conversation
 *   welcome_screen          → welcome_screen
 *   starter_prompts          → starter_prompts
 *
 * Validations are enforced at schema level via
 * `recommendedPromptsConfigurationSchema.safeParse(...)` (called by
 * compile-agent-version.ts), which is derived from the OpenAPI-generated
 * `recommendedPromptsConfiguration` schema:
 *   - starter_prompts only allowed when welcome_screen is true (refine)
 *   - starter_prompts must have at least 3 entries (refine)
 *   - max items (20) and string length (1-50) enforced by the generated
 *     base schema — NOT duplicated here.
 *
 * Agent type restriction (AgentforceEmployeeAgent only) is enforced
 * by the lint pass in config-validation.ts.
 */
export function compileRecommendedPrompts(
  recsBlock: Record<string, unknown> | null | undefined,
  ctx: CompilerContext
): RecommendedPromptsConfiguration | undefined {
  if (!recsBlock) {
    return undefined;
  }

  // Default to true: recommendations should show up by default once the block
  // is present. Users must explicitly set False to disable them.
  const inConversation = extractBooleanValue(recsBlock.in_conversation) ?? true;
  const welcomeScreen = extractBooleanValue(recsBlock.welcome_screen) ?? true;

  const result: RecommendedPromptsConfiguration = {
    in_conversation: inConversation,
    welcome_screen: welcomeScreen,
  };

  const prompts = extractStringSequence(
    recsBlock.starter_prompts as Parameters<typeof extractStringSequence>[0],
    'recommended_prompts.starter_prompts',
    ctx
  );

  if (prompts.length > 0) {
    result.starter_prompts = prompts;
  }

  return result;
}
