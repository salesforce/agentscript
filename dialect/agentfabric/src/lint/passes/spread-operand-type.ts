import {
  storeKey,
  lintDiagnostic,
  SpreadExpression,
  NoneLiteral,
  NumberLiteral,
  BooleanLiteral,
  StringLiteral,
  DiagnosticSeverity,
  attachDiagnostic,
} from '@agentscript/language';
import type { LintPass, AstNodeLike } from '@agentscript/language';

/**
 * Flags SpreadExpression (`*expr`) when the operand is a known non-iterable
 * literal (None, number, boolean, or bare string). These will always fail at
 * runtime when the evaluator calls `extend()` on the value.
 *
 * Template expressions (interpolated strings) are intentionally allowed because
 * they may resolve to an iterable at runtime.
 */
class SpreadOperandTypePass implements LintPass {
  readonly id = storeKey('spread-operand-type');
  readonly description =
    'Rejects spread of known non-iterable literals (None, number, bool, string)';

  enterNode(_key: string, value: unknown): void {
    if (!(value instanceof SpreadExpression)) return;

    const inner = value.expression;
    let typeLabel: string | undefined;

    if (inner instanceof NoneLiteral) {
      typeLabel = 'None';
    } else if (inner instanceof NumberLiteral) {
      typeLabel = 'a number';
    } else if (inner instanceof BooleanLiteral) {
      typeLabel = 'a boolean';
    } else if (inner instanceof StringLiteral) {
      typeLabel = 'a string';
    }

    if (!typeLabel) return;

    const cst = value.__cst;
    if (!cst) return;

    attachDiagnostic(
      value as unknown as AstNodeLike,
      lintDiagnostic(
        cst.range,
        `Spread operand must be iterable, but got ${typeLabel}`,
        DiagnosticSeverity.Error,
        'non-iterable-spread'
      )
    );
  }
}

export function spreadOperandTypePass(): LintPass {
  return new SpreadOperandTypePass();
}
