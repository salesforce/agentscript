/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { CompilerContext } from '../compiler-context.js';
import type { LiveConfiguration } from '../types.js';
import { extractBooleanValue } from '../ast-helpers.js';
import { extractBlockParams } from './model-config.js';

/**
 * Compile the top-level `live:` block into agent_version.live (agent-dsl
 * LiveConfiguration). Live is experimental, agent-version-level configuration.
 *
 * Returns undefined when the block is absent, so `live` is only emitted when
 * authored. `enabled` is always emitted (defaulting to false, matching the
 * agent-dsl default) so an authored-but-empty `live:` block is explicit in the
 * output. `params` are turned into plain values with the same extraction as
 * `model_config.params` and omitted when empty.
 */
export function compileLive(
  liveBlock: unknown,
  ctx: CompilerContext
): LiveConfiguration | undefined {
  if (!liveBlock || typeof liveBlock !== 'object') return undefined;

  const block = liveBlock as Record<string, unknown>;
  const live: LiveConfiguration = {
    enabled: extractBooleanValue(block.enabled) ?? false,
  };

  const params = extractBlockParams(block.params, ctx);
  if (params) {
    live.params = params;
  }

  return live;
}
