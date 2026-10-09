/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

export {
  SWARM_ITEM_PLACEHOLDER,
  MAX_SWARM_SUBAGENTS,
  MIN_SWARM_ITEMS,
  DEFAULT_SWARM_MAX_CONCURRENCY,
} from './types.js';
export type {
  SwarmOutcome,
  SwarmSpec,
  SwarmRunResult,
  SwarmOptions,
} from './types.js';
export {
  expandSwarmItems,
  renderSwarmResults,
  SwarmExpansionError,
} from './expand.js';
export { runPool } from './pool.js';
