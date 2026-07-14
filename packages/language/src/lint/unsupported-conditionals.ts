/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { AstRoot, AstNodeLike } from '../core/types.js';
import { isAstNodeLike } from '../core/types.js';
import { DiagnosticSeverity, attachDiagnostic } from '../core/diagnostics.js';
import {
  storeKey,
  type LintPass,
  type PassStore,
} from '../core/analysis/lint-engine.js';
import { lintDiagnostic } from './lint-utils.js';
import {
  type Statement,
  IfStatement,
  RunStatement,
} from '../core/statements.js';

const NESTED_IF_MESSAGE =
  "AgentScript does not support nested 'if' statements. " +
  "Combine conditions with 'and'/'or', or restructure the logic.";

function isStatement(value: unknown): value is Statement {
  return (
    isAstNodeLike(value) &&
    '__kind' in value &&
    typeof value.__kind === 'string'
  );
}

// `else if` chain links surface as IfStatements in the parent's `orelse`,
// distinguished from a user-written nested `if` only by their CST type.
function isElseIfChainLink(stmt: IfStatement): boolean {
  return stmt.__cst?.node?.type === 'else_if_clause';
}

function flagNestedIf(stmt: IfStatement): void {
  const range = stmt.__cst?.range;
  if (!range) return;
  if (!isAstNodeLike(stmt)) return;
  attachDiagnostic(
    stmt,
    lintDiagnostic(
      range,
      NESTED_IF_MESSAGE,
      DiagnosticSeverity.Error,
      'unsupported-nested-if'
    )
  );
}

/**
 * Walk a list of statements that lives *inside* another IfStatement
 * (its body or its orelse). `else if` chain links (CST type `else_if_clause`)
 * are part of the supported syntax and pass through; user-written nested
 * `if` statements get flagged.
 */
function checkInside(stmts: readonly Statement[]): void {
  for (const stmt of stmts) {
    if (!(stmt instanceof IfStatement)) continue;
    if (!isElseIfChainLink(stmt)) {
      flagNestedIf(stmt);
    }
    checkInside(stmt.body);
    checkInside(stmt.orelse);
  }
}

/**
 * Walk a procedure (top-level statement list). Top-level IfStatements
 * are fine; only nested ones get flagged. Recurse into each top-level
 * statement to find any nesting inside.
 */
function checkProcedure(stmts: readonly unknown[]): void {
  for (const raw of stmts) {
    if (!isStatement(raw)) continue;
    if (raw instanceof IfStatement) {
      // Top-level if is allowed; recurse to find nested ifs and elif chain.
      checkInside(raw.body);
      checkInside(raw.orelse);
    } else if (raw instanceof RunStatement) {
      // RunStatement.body is a plain Statement[], not a ProcedureValue,
      // so the engine does not visit it on its own. Treat it as another
      // top-level procedure. If a new Statement subclass is ever added
      // that contains nested statements, it must be handled here too.
      checkProcedure(raw.body);
    }
  }
}

class UnsupportedConditionalsPass implements LintPass {
  readonly id = storeKey('unsupported-conditionals');
  readonly description =
    "Flags nested 'if' statements as unsupported by the AgentScript language spec.";

  private procedures: AstNodeLike[] = [];

  init(): void {
    this.procedures = [];
  }

  enterNode(_key: string, value: unknown, _parent: unknown): void {
    if (isAstNodeLike(value) && value.__kind === 'ProcedureValue') {
      this.procedures.push(value);
    }
  }

  run(_store: PassStore, _root: AstRoot): void {
    for (const proc of this.procedures) {
      const stmts = proc.statements;
      if (Array.isArray(stmts) && stmts.length > 0) {
        checkProcedure(stmts);
      }
    }
  }
}

export function unsupportedConditionalsPass(): LintPass {
  return new UnsupportedConditionalsPass();
}
