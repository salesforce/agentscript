import type { AstRoot, AstNodeLike } from '../core/types.js';
import { isAstNodeLike } from '../core/types.js';
import { isEmittable } from '../core/children.js';
import { DiagnosticSeverity, DiagnosticTag } from '../core/diagnostics.js';
import { attachDiagnostic } from '../core/diagnostics.js';
import {
  storeKey,
  type LintPass,
  type PassStore,
} from '../core/analysis/lint.js';
import { lintDiagnostic } from './lint-utils.js';
import {
  type Statement,
  IfStatement,
  RunStatement,
  TransitionStatement,
} from '../core/statements.js';

/**
 * Determine whether a statement is unconditionally terminal
 * (i.e., control flow never continues past it).
 */
function isTerminal(stmt: Statement): boolean {
  if (stmt instanceof TransitionStatement) return true;

  if (stmt instanceof IfStatement) {
    if (stmt.orelse.length === 0) return false;
    return alwaysTerminates(stmt.body) && alwaysTerminates(stmt.orelse);
  }

  return false;
}

/**
 * Check whether a sequential statement list always terminates
 * (i.e., control flow never falls through the end).
 *
 * In a sequential list, if any statement is unconditionally terminal,
 * control either reaches it and terminates, or an earlier terminal
 * was reached first. Either way the list never falls through.
 */
function alwaysTerminates(stmts: Statement[]): boolean {
  return stmts.some(isTerminal);
}

/** Build a diagnostic message based on the kind of terminal statement. */
function unreachableMessage(terminalStmt: Statement): string {
  if (terminalStmt instanceof TransitionStatement) {
    return (
      "Code will never execute after 'transition'. " +
      'Move this code before the transition, or wrap the transition in a conditional block.'
    );
  }

  // Exhaustive IfStatement (all branches terminate)
  return (
    "Code will never execute because all branches of the preceding 'if' block transition away. " +
    'Add an else branch without a transition, or move this code into one of the branches.'
  );
}

/** Runtime check that a value conforms to the Statement interface. */
function isStatement(value: unknown): value is Statement {
  return (
    isEmittable(value) && '__kind' in value && typeof value.__kind === 'string'
  );
}

/**
 * Check a statement list for unreachable code and attach diagnostics.
 * Also recurses into nested statement lists (if/else bodies, run bodies).
 *
 * Accepts `readonly unknown[]` because ProcedureValue.statements is
 * accessed via AstNodeLike's index signature (yielding `unknown`).
 * Each element is narrowed to Statement at runtime.
 */
function checkStatements(stmts: readonly unknown[]): void {
  let terminalStmt: Statement | null = null;

  for (const raw of stmts) {
    if (!isStatement(raw)) continue;
    const stmt = raw;

    if (terminalStmt) {
      // Statement classes extend AstNodeBase, so isAstNodeLike succeeds at runtime.
      const range = stmt.__cst?.range ?? {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      };
      if (!isAstNodeLike(stmt)) continue;
      attachDiagnostic(
        stmt,
        lintDiagnostic(
          range,
          unreachableMessage(terminalStmt),
          DiagnosticSeverity.Warning,
          'unreachable-code',
          { tags: [DiagnosticTag.Unnecessary] }
        )
      );
      continue;
    }

    if (isTerminal(stmt)) {
      terminalStmt = stmt;
    }

    // Recurse into nested statement lists
    if (stmt instanceof IfStatement) {
      checkStatements(stmt.body);
      checkStatements(stmt.orelse);
    } else if (stmt instanceof RunStatement) {
      checkStatements(stmt.body);
    }
  }
}

class UnreachableCodePass implements LintPass {
  readonly id = storeKey('unreachable-code');
  readonly description =
    'Detects unreachable code after terminal statements like transition';

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
        checkStatements(stmts);
      }
    }
  }
}

export function unreachableCodePass(): LintPass {
  return new UnreachableCodePass();
}
