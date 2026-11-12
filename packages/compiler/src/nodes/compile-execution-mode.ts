/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { Tool } from '../types.js';
import { extractSourcedString } from '../ast-helpers.js';
import { sourced, type Sourced } from '../sourced.js';
import type { RunStatement } from '@agentscript/language';
import { analyzeRunOptions } from '@agentscript/agentforce-dialect';
import type { CompilerContext } from '../compiler-context.js';

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

export function compileRunExecutionMode(
  stmt: RunStatement,
  ctx: CompilerContext
): Sourced<NonBlockingBehavior> | undefined {
  const { executionMode, diagnostics } = analyzeRunOptions(stmt);
  for (const diagnostic of diagnostics) {
    ctx.addDiagnostic(
      diagnostic.severity,
      diagnostic.message,
      diagnostic.range,
      diagnostic.code
    );
  }
  return diagnostics.length === 0
    ? compileExecutionMode(executionMode)
    : undefined;
}
