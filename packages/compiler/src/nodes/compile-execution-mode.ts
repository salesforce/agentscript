/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { Tool } from '../types.js';
import { extractSourcedString } from '../ast-helpers.js';
import { sourced, type Sourced } from '../sourced.js';

type NonBlockingBehavior = NonNullable<Tool['non_blocking_behavior']>;

export function compileExecutionMode(
  value: unknown
): Sourced<NonBlockingBehavior> | undefined {
  if (value === undefined) return undefined;
  const behavior = extractSourcedString(value);
  if (behavior?.value === 'blocking') return undefined;
  if (behavior?.value === 'fire_and_forget') {
    return sourced(behavior.value, behavior.range);
  }
  return undefined;
}
