/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { RuntimeConfiguration } from '../types.js';
import type { CompilerContext } from '../compiler-context.js';
import { extractBooleanValue, getCstRange } from '../ast-helpers.js';

/**
 * Compile runtime configuration from the `runtime` block under `config`.
 *
 * The runtime block holds opt-in runtime knobs:
 * - streaming: collapse /messages/stream into a single terminal SSE chunk
 * - thought_chunks: emit thought chunks alongside response chunks
 * - citation: skip citation enrichment post-orch step
 * - groundedness: force-off groundedness post-orch step
 * - reset_to_initial_node: rewind current_node to the initial node after each terminal node
 *
 * Each field is optional and omitted from the compiled output when unset.
 * When the `runtime:` block is present, it must declare at least one field —
 * an empty block is a compile error.
 *
 * @param runtimeBlock - The parsed runtime sub-block from `config.runtime`
 * @param ctx - Compiler context for error reporting
 * @returns Compiled RuntimeConfiguration, or undefined if the block is absent
 *          or holds no extractable fields (an error is also emitted in the latter case)
 */
export function compileRuntime(
  runtimeBlock:
    | {
        streaming?: { value?: boolean };
        thought_chunks?: { value?: boolean };
        citation?: { value?: boolean };
        groundedness?: { value?: boolean };
        reset_to_initial_node?: { value?: boolean };
      }
    | null
    | undefined,
  ctx: CompilerContext
): RuntimeConfiguration | undefined {
  if (!runtimeBlock) {
    return undefined;
  }

  const fields: Array<keyof RuntimeConfiguration> = [
    'streaming',
    'thought_chunks',
    'citation',
    'groundedness',
    'reset_to_initial_node',
  ];

  const result: RuntimeConfiguration = {};
  for (const key of fields) {
    const value = extractBooleanValue(runtimeBlock[key]);
    if (value !== undefined && value !== null) {
      result[key] = value;
    }
  }

  if (Object.keys(result).length === 0) {
    ctx.error(
      'runtime block must declare at least one field (streaming, thought_chunks, citation, groundedness, or reset_to_initial_node). Remove the empty `runtime:` block if no runtime overrides are needed.',
      getCstRange(runtimeBlock)
    );
    return undefined;
  }

  return result;
}
