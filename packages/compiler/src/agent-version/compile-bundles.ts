/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { CompilerContext } from '../compiler-context.js';
import type { Bundle } from '../types.js';
import type { NamedMap } from '@agentscript/language';
import {
  extractStringValue,
  iterateNamedMap,
  getCstRange,
} from '../ast-helpers.js';
import { bundleTargetType } from '../generated/agent-dsl.js';

/**
 * Compile bundle declarations to AgentJSON Bundle objects.
 *
 * Each bundle entry maps a name to a `<scheme>://` URI target. The compiler
 * parses the URI scheme, validates it against the bundleTargetType enum, and
 * strips the prefix to emit the bare identifier as invocation_target_name.
 */
export function compileBundles(
  bundles: NamedMap<Record<string, unknown>> | undefined,
  ctx: CompilerContext
): Bundle[] {
  if (!bundles) return [];

  const result: Bundle[] = [];

  for (const [name, block] of iterateNamedMap(bundles)) {
    const rawTarget = extractStringValue(block.target);

    if (!rawTarget || rawTarget.trim() === '') {
      ctx.error(
        `Bundle '${name}' requires a non-empty target`,
        getCstRange(block.target)
      );
      continue;
    }

    const schemeSep = rawTarget.indexOf('://');
    if (schemeSep === -1) {
      ctx.error(
        `Bundle '${name}' target must use a URI scheme (e.g. "bundle://prospecting"), got "${rawTarget}"`,
        getCstRange(block.target)
      );
      continue;
    }

    const scheme = rawTarget.slice(0, schemeSep);
    const parsed = bundleTargetType.safeParse(scheme);
    if (!parsed.success) {
      const supported = bundleTargetType.options.map(s => `${s}://`).join(', ');
      ctx.error(
        `Bundle '${name}' target uses unsupported scheme "${scheme}://". Supported: ${supported}`,
        getCstRange(block.target)
      );
      continue;
    }

    result.push({
      name,
      invocation_target_type: parsed.data,
      invocation_target_name: rawTarget.slice(schemeSep + '://'.length),
    });
  }

  return result;
}
