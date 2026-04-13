/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { AnimatedEdge } from './AnimatedEdge';
import { ConditionalEdge } from './ConditionalEdge';
import { LoopBackEdge } from './LoopBackEdge';

export { AnimatedEdge, ConditionalEdge, LoopBackEdge };

/** Edge type registry for React Flow */
export const graphEdgeTypes = {
  smoothstep: AnimatedEdge,
  conditional: ConditionalEdge,
  'loop-back': LoopBackEdge,
} as const;
