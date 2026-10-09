/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Model routing + cost tracking. Composable LlmDriver wrappers:
 *  - FallbackDriver routes across a chain of drivers, failing over on error.
 *  - CostTrackingDriver observes `usage` events into a CostTracker.
 * Both are transparent to the runtime, which only sees an LlmDriver.
 */

export {
  FallbackDriver,
  retryAll,
  type NamedDriver,
  type FallbackDriverOptions,
} from './fallback-driver.js';

export { CostTrackingDriver } from './cost-tracking-driver.js';

export {
  CostTracker,
  type ModelPrice,
  type UsageStats,
  type ModelUsage,
} from './cost.js';
