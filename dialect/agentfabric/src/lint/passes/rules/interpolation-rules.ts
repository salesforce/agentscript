/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import {
  CallExpression,
  StringLiteral,
  DiagnosticSeverity,
  attachDiagnostic,
  lintDiagnostic,
} from '@agentscript/language';
import type { AstNodeLike } from '@agentscript/language';

const INTERPOLATION_PATTERN = /\{!(.+?)}/;

/**
 * Flags string literals containing interpolation syntax (`{!...}`) used as
 * function arguments. Interpolation is only evaluated in template expressions
 * (pipe syntax), not inside quoted strings. Users should use string
 * concatenation instead (e.g. `"text" + @ref`).
 */
export function checkInterpolationInCallArgRules(expr: AstNodeLike): void {
  if (!(expr instanceof CallExpression)) return;

  for (const arg of expr.args) {
    if (!(arg instanceof StringLiteral)) continue;

    const match = INTERPOLATION_PATTERN.exec(arg.value);
    if (!match) continue;

    const cst = arg.__cst;
    if (!cst) continue;

    const ref = match[1];
    attachDiagnostic(
      arg as unknown as AstNodeLike,
      lintDiagnostic(
        cst.range,
        `String interpolation ({!...}) does not work inside function arguments. Use string concatenation instead: "..." + ${ref}`,
        DiagnosticSeverity.Warning,
        'interpolation-in-call-arg'
      )
    );
  }
}
