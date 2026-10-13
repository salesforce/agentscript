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
 *
 * The dialect surface uses the exact agent-dsl `billingMode` enum values, so
 * the parsed mode passes through to AgentJSON unchanged.
 */
export interface BillingConfiguration {
  mode: 'ACTION_BASED' | 'OUTCOME_BASED';
}

const BILLING_MODES: ReadonlyArray<BillingConfiguration['mode']> = [
  'ACTION_BASED',
  'OUTCOME_BASED',
];

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

  if (!BILLING_MODES.includes(mode as BillingConfiguration['mode'])) {
    ctx.error(
      `Invalid billing mode: "${mode}". Must be one of: ${BILLING_MODES.join(', ')}`,
      getCstRange(block.mode)
    );
    return undefined;
  }

  return { mode: mode as BillingConfiguration['mode'] };
}
