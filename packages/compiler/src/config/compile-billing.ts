/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { CompilerContext } from '../compiler-context.js';
import { extractStringValue, getCstRange } from '../ast-helpers.js';

/**
 * Billing configuration matching agent-dsl BillingConfig.
 */
export interface BillingConfiguration {
  mode: 'ACTION_BASED' | 'OUTCOME_BASED';
}

/**
 * Authored billing mode → agent-dsl `billingMode` value.
 *
 * The DSL surface uses RESOLUTION_BASED, which agent JSON still calls
 * OUTCOME_BASED. OUTCOME_BASED remains accepted as a deprecated alias (the
 * dialect warns on it) and compiles to the same agent JSON.
 */
const BILLING_MODES: ReadonlyMap<string, BillingConfiguration['mode']> =
  new Map([
    ['ACTION_BASED', 'ACTION_BASED'],
    ['RESOLUTION_BASED', 'OUTCOME_BASED'],
    ['OUTCOME_BASED', 'OUTCOME_BASED'],
  ]);

/**
 * Compile the billing block (nested under config) from AST to AgentJSON format.
 *
 * Billing is version-specific, so the output maps to agent_version.billing
 * rather than global_configuration (see compileAgentVersion).
 */
export function compileBilling(
  billingBlock: unknown | undefined,
  ctx: CompilerContext
): BillingConfiguration | undefined {
  if (!billingBlock) return undefined;

  const block = billingBlock as Record<string, unknown>;
  const mode = extractStringValue(block.mode);

  if (!mode) {
    ctx.error('billing block requires mode to be set', getCstRange(block));
    return undefined;
  }

  const compiledMode = BILLING_MODES.get(mode);
  if (!compiledMode) {
    ctx.error(
      `Invalid billing mode: "${mode}". Must be one of: ${[...BILLING_MODES.keys()].join(', ')}`,
      getCstRange(block.mode)
    );
    return undefined;
  }

  return { mode: compiledMode };
}
