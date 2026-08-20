/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { ContextConfiguration } from '../types.js';
import type { CompilerContext } from '../compiler-context.js';
import { extractBooleanValue } from '../ast-helpers.js';

/**
 * Compile context configuration from top-level context block.
 *
 * The context block contains:
 * - memory: memory configuration with enabled flag (boolean)
 * - user_profile: user profile configuration with enabled flag (boolean)
 * - past_conversations: conversation history configuration with enabled flag (boolean)
 * - salesforce: Salesforce context provider configuration with enabled flag (boolean)
 * - data_cloud: Data Cloud context provider configuration with enabled flag (boolean)
 *
 * @param contextBlock - The parsed context block from AST
 * @param ctx - Compiler context for error reporting
 * @returns Compiled ContextConfiguration or undefined if context block is not present
 */
export function compileContext(
  contextBlock:
    | {
        memory?: { enabled?: { value?: boolean } };
        user_profile?: { enabled?: { value?: boolean } };
        past_conversations?: { enabled?: { value?: boolean } };
        salesforce?: {
          enabled?: { value?: boolean };
          auto_enabled?: { value?: boolean };
        };
        data_cloud?: {
          enabled?: { value?: boolean };
          auto_enabled?: { value?: boolean };
        };
      }
    | null
    | undefined,
  ctx: CompilerContext
): ContextConfiguration | undefined {
  if (!contextBlock) {
    return undefined;
  }

  const result: ContextConfiguration = {};

  // Extract memory configuration if present
  if (contextBlock.memory) {
    const enabled = extractBooleanValue(contextBlock.memory.enabled);

    if (enabled === null || enabled === undefined) {
      ctx.error(
        'Context memory block requires an "enabled" field with a boolean value'
      );
    } else {
      result.memory = { enabled };
    }
  }

  // Extract user_profile configuration if present
  if (contextBlock.user_profile) {
    const enabled = extractBooleanValue(contextBlock.user_profile.enabled);

    if (enabled === null || enabled === undefined) {
      ctx.error(
        'Context user_profile block requires an "enabled" field with a boolean value'
      );
    } else {
      result.user_profile = { enabled };
    }
  }

  // Extract past_conversations configuration if present
  if (contextBlock.past_conversations) {
    const enabled = extractBooleanValue(
      contextBlock.past_conversations.enabled
    );

    if (enabled === null || enabled === undefined) {
      ctx.error(
        'Context past_conversations block requires an "enabled" field with a boolean value'
      );
    } else {
      result.past_conversations = { enabled };
    }
  }

  // Extract salesforce configuration if present
  if (contextBlock.salesforce) {
    const enabled = extractBooleanValue(contextBlock.salesforce.enabled);

    if (enabled === null || enabled === undefined) {
      ctx.error(
        'Context salesforce block requires an "enabled" field with a boolean value'
      );
    } else {
      result.salesforce = { enabled };
    }
  }

  // Extract data_cloud configuration if present
  if (contextBlock.data_cloud) {
    const enabled = extractBooleanValue(contextBlock.data_cloud.enabled);

    if (enabled === null || enabled === undefined) {
      ctx.error(
        'Context data_cloud block requires an "enabled" field with a boolean value'
      );
    } else {
      result.data_cloud = { enabled };
    }
  }

  // Return undefined if context block is empty
  if (Object.keys(result).length === 0) {
    return undefined;
  }

  return result;
}
