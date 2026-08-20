/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { Expression } from '@agentscript/language';
import { decomposeAtMemberExpression } from '@agentscript/language';
import type { CompilerContext } from '../compiler-context.js';
import type { NodeBundleReference } from '../types.js';
import { getCstRange } from '../ast-helpers.js';

/**
 * Extract node-level bundle references from a subagent's `bundles` field.
 *
 * Each item in the sequence must be an `@bundles.<name>` reference expression.
 * The name after the namespace becomes the bundle reference name.
 */
export function extractNodeBundles(
  topicBlock: { bundles?: unknown },
  ctx: CompilerContext
): NodeBundleReference[] {
  const seq = topicBlock.bundles;
  if (!seq) return [];

  const items = (seq as { items?: unknown[] }).items;
  if (!Array.isArray(items)) return [];

  const result: NodeBundleReference[] = [];
  for (const item of items) {
    const expr = item as Expression;
    const ref = decomposeAtMemberExpression(expr);

    if (!ref || ref.namespace !== 'bundles') {
      ctx.error(
        'Node-level bundle reference must be @bundles.<name>',
        getCstRange(item)
      );
      continue;
    }

    result.push({ name: ref.property });
  }

  return result;
}
