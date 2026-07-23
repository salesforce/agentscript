/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Allowed Agentforce agent types.
 *
 * Lists the agent types the backend currently supports. Types the backend has
 * deprecated are intentionally omitted so they are neither suggested in
 * autocomplete nor accepted for new scripts. Service agents are authored under
 * the `AgentforceServiceAgent` alias, which the backend remaps to its canonical
 * type, so only the alias is listed.
 *
 * A value outside this list is rejected with an `agent-type-not-allowed`
 * diagnostic. Keep this in sync with the backend when types are added or
 * deprecated.
 */

/** Canonical agent type API values plus the AgentforceServiceAgent UI alias. */
export const ALLOWED_AGENT_TYPES = [
  // Service agents are authored as AgentforceServiceAgent; the backend remaps
  // this alias to its canonical type, so the canonical form is not listed here.
  'AgentforceServiceAgent',
  // Canonical agent type API values.
  'EinsteinSDR',
  'SalesEinsteinCoach',
  'BankingServiceAgent',
  'ServicePlanner',
  'AppDevAgent',
  'AgentforceEmployeeAgent',
  'CustomAgent',
  'LightningAppBuilder',
  'SalesCanvasAgent',
  'ScaleAgent',
  'ThirdPartyA2AAgent',
] as const;

export type AllowedAgentType = (typeof ALLOWED_AGENT_TYPES)[number];

/**
 * Agent types the backend recognizes but strips from the public agent JSON
 * schema (`NON_PUBLIC_AGENT_TYPES` in agent-dsl). These must never appear in
 * `ALLOWED_AGENT_TYPES`: the editor would accept them, but the compiler's
 * public Zod enum omits them, so compilation would fail with a
 * `schema-validation` error. Keep in sync with agent-dsl's non-public set.
 */
export const NON_PUBLIC_AGENT_TYPES: readonly string[] = ['Setup'] as const;

/** Lowercased lookup set of allowed agent types for case-insensitive matching. */
const ALLOWED_AGENT_TYPE_KEYS: ReadonlySet<string> = new Set(
  ALLOWED_AGENT_TYPES.map(t => t.toLowerCase())
);

/** Returns true if `value` is a recognized agent type (case-insensitive). */
export function isAllowedAgentType(value: string): boolean {
  return ALLOWED_AGENT_TYPE_KEYS.has(value.trim().toLowerCase());
}
