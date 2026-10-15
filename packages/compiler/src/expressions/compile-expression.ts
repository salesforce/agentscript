/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import {
  type Expression,
  type BinaryOperator,
  type TemplatePart,
  MemberExpression,
  AtIdentifier,
  Identifier,
  SubscriptExpression,
  SliceExpression,
  BinaryExpression,
  UnaryExpression,
  ComparisonExpression,
  TernaryExpression,
  CallExpression,
  StringLiteral,
  NumberLiteral,
  BooleanLiteral,
  TemplateExpression,
  TemplateText,
  TemplateInterpolation,
  Ellipsis,
  SpreadExpression,
  KeywordArgument,
  NoneLiteral,
  decomposeAtMemberExpression,
  escapeStringValue,
} from '@agentscript/language';
import type { Range } from '@agentscript/types';
import type { CompilerContext } from '../compiler-context.js';
import { extractNumberValue } from '../ast-helpers.js';

/**
 * Resolve a `@variables.X` reference to its runtime-namespaced string.
 *
 * - Mutable variables → `state.X`
 * - Linked (context) variables → `variables.X`
 * - Unknown variables → `state.X` and warn (the runtime treats unknown
 *   names as state, but flag it so the user catches typos)
 */
function resolveVariableRef(
  varName: string,
  ctx: CompilerContext,
  range: Range | undefined
): string {
  const ns = ctx.getVariableNamespace(varName);
  if (ns === 'context') return `variables.${varName}`;
  if (ns === 'state') return `state.${varName}`;
  ctx.warning(
    `Variable '${varName}' not found in known variables, defaulting to state namespace`,
    range
  );
  return `state.${varName}`;
}

/**
 * Extract an *integer* literal value (including unary-minus negatives) from an
 * AST expression node for file-reference slice/subscript bounds. Delegates the
 * NumberLiteral + UnaryExpression('-') walk to the shared `extractNumberValue`
 * and adds the integer guard those bounds require — a fractional bound (`[1.5]`)
 * is not a valid index and returns undefined so the caller skips capture.
 */
function extractIntegerLiteral(expr: Expression): number | undefined {
  const value = extractNumberValue(expr);
  if (value === undefined || !Number.isInteger(value)) return undefined;
  return value;
}

/**
 * Compile an AST Expression into its runtime string representation.
 */
export function compileExpression(
  expr: Expression,
  ctx: CompilerContext,
  options: CompileExpressionOptions = {}
): string {
  let compiled = compileExprNode(expr, ctx, options);

  // Post-process: Replace any remaining @variables references that weren't
  // properly compiled (e.g., inside function calls like len(@variables.x))
  // This matches agent-dsl's regex-based approach for comprehensive coverage.
  compiled = compiled.replace(/@variables\.(\w+)/g, (_, varName) =>
    resolveVariableRef(varName, ctx, expr.__cst?.range)
  );

  return compiled;
}

export interface CompileExpressionOptions {
  allowActionReferences?: boolean;
  allowFormatReferences?: boolean;
  isSystemMessage?: boolean;
  /** Label for the current expression context, used in error messages (e.g. "'set' clause", "'with' clause") */
  expressionContext?: string;
}

function compileExprNode(
  expr: Expression,
  ctx: CompilerContext,
  opts: CompileExpressionOptions
): string {
  // Defense-in-depth: the parser may produce null expression nodes for
  // incomplete syntax (e.g. `set foo = ` with nothing after `=`). Guard
  // here — the single chokepoint that compileExpression, compileValueExpression,
  // and recursive callers all funnel through.
  if ((expr as Expression | null | undefined) == null) {
    ctx.error(
      'Internal: expression node was null',
      undefined,
      'COMPILER_NULL_EXPRESSION'
    );
    return '';
  }
  if (expr instanceof MemberExpression) {
    return compileMemberExpression(expr, ctx, opts);
  }
  if (expr instanceof AtIdentifier) {
    return compileAtIdentifier(expr, ctx);
  }
  if (expr instanceof SubscriptExpression) {
    return compileSubscriptExpression(expr, ctx, opts);
  }
  if (expr instanceof SliceExpression) {
    // Slices are only legal inside a subscript, where compileSubscriptExpression
    // handles them directly. Bare slices should never reach this path.
    ctx.error(
      'Slice syntax is only valid inside a subscript (e.g. list[1:3])',
      expr.__cst?.range
    );
    return '';
  }
  if (expr instanceof BinaryExpression) {
    return compileBinaryExpression(expr, ctx, opts);
  }
  if (expr instanceof UnaryExpression) {
    return compileUnaryExpression(expr, ctx, opts);
  }
  if (expr instanceof ComparisonExpression) {
    return compileComparisonExpression(expr, ctx, opts);
  }
  if (expr instanceof TernaryExpression) {
    return compileTernaryExpression(expr, ctx, opts);
  }
  if (expr instanceof CallExpression) {
    return compileCallExpression(expr, ctx, opts);
  }
  if (expr instanceof StringLiteral) {
    return `"${escapeStringValue(expr.value)}"`;
  }
  if (expr instanceof NumberLiteral) {
    return String(expr.value);
  }
  if (expr instanceof BooleanLiteral) {
    return expr.value ? 'True' : 'False';
  }
  if (expr instanceof Identifier) {
    return expr.name;
  }
  if (expr instanceof TemplateExpression) {
    return compileTemplateExpression(expr, ctx, opts);
  }
  if (expr instanceof Ellipsis) {
    return '...';
  }
  if (expr instanceof SpreadExpression) {
    return `*${compileExprNode(expr.expression, ctx, opts)}`;
  }
  if (expr instanceof KeywordArgument) {
    return `${expr.name}=${compileExprNode(expr.value, ctx, opts)}`;
  }
  if (expr instanceof NoneLiteral) {
    return 'None';
  }

  ctx.error(`Unsupported expression kind: ${expr.__kind}`, expr.__cst?.range);
  return '';
}

function compileMemberExpression(
  expr: MemberExpression,
  ctx: CompilerContext,
  opts: CompileExpressionOptions
): string {
  const decomposed = decomposeAtMemberExpression(expr);
  if (decomposed) {
    const { namespace, property } = decomposed;

    switch (namespace) {
      case 'variables': {
        if (opts.isSystemMessage) {
          // Linked variables resolve through $Context (sourced from session
          // context at runtime); mutable variables resolve through the
          // regular state/context namespace, matching template behavior.
          const ns = ctx.getVariableNamespace(property);
          if (ns === 'context') return `$Context.${property}`;
          return resolveVariableRef(property, ctx, expr.__cst?.range);
        }
        return resolveVariableRef(property, ctx, expr.__cst?.range);
      }

      case 'outputs':
        return `result.${property}`;

      case 'inputs': {
        const connName = ctx.connectionName;
        if (connName) {
          return `connection.${connName}.${property}`;
        }
        ctx.warning(
          `Connection input '${property}' not in a connection context, defaulting to empty namespace`,
          expr.__cst?.range
        );
        return `inputs.${property}`;
      }

      case 'actions':
      case 'tool_definitions':
      case 'tools': {
        if (!opts.allowActionReferences) {
          const where = opts.expressionContext
            ? ` in a ${opts.expressionContext}`
            : '';
          ctx.error(
            `@${namespace}.${property} cannot be used${where}. Use @${namespace} references inside instruction templates instead (e.g. | text {!@${namespace}.${property}}).`,
            expr.__cst?.range
          );
        }
        // Resolve to the tool key name if a mapping exists
        const toolKey = ctx.actionReferenceMap.get(property) ?? property;
        return `action.${toolKey}`;
      }

      case 'response_formats':
      case 'response_actions': {
        if (!opts.allowFormatReferences) {
          const where = opts.expressionContext
            ? ` in a ${opts.expressionContext}`
            : '';
          ctx.error(
            `@${namespace}.${property} cannot be used${where}. Use @${namespace} references inside instruction templates instead (e.g. | text {!@${namespace}.${property}}).`,
            expr.__cst?.range
          );
        }
        // Resolve to the response format tool name if a mapping exists
        const formatKey =
          ctx.responseFormatReferenceMap.get(property) ?? property;
        return `response_formats.${formatKey}`;
      }

      case 'system_variables': {
        switch (property) {
          case 'user_input':
            return 'system.input_text';
          case 'current_modality':
            return 'system.current_modality';
          case 'current_connection':
            return 'system.current_connection';
          case 'last_reply':
            // Nested object; sub-members (`.interrupted`,
            // `.interrupted_heard_text`) fall through to the generic member
            // builder, yielding `system.last_reply.<member>`.
            return 'system.last_reply';
          case 'uploaded_files':
            // Bare @system_variables.uploaded_files reference (or its .length consumer)
            ctx.fileCapture.capture({ all: true }, expr.__cst?.range);
            return 'system.uploaded_files';
        }
        ctx.error(`Unknown system variable: ${property}`, expr.__cst?.range);
        return `state.${property}`;
      }

      case 'knowledge': {
        const value = ctx.knowledgeFields.get(property);
        if (value !== undefined) {
          // AgentScript expressions use Python-style 'True'/'False' keywords, not JSON booleans
          if (typeof value === 'boolean') {
            return value ? 'True' : 'False';
          }
          return `"${escapeStringValue(value)}"`;
        }
        ctx.error(`Unknown @knowledge field: '${property}'`, expr.__cst?.range);
        return '';
      }

      case 'topic':
      case 'subagent': {
        ctx.error(
          `@${namespace} cannot be referenced in LLM instructions; use transitions to switch between @${namespace}`,
          expr.__cst?.range
        );
        return '';
      }

      default: {
        const obj = compileAccessTarget(expr.object, ctx, opts);
        return `${obj}.${property}`;
      }
    }
  }

  const obj = compileExprNode(expr.object, ctx, opts);
  // Convert .length to len() function call for runtime compatibility
  if (expr.property === 'length') {
    return `len(${obj})`;
  }
  return `${compileAccessTarget(expr.object, ctx, opts)}.${expr.property}`;
}

function compileAtIdentifier(expr: AtIdentifier, ctx: CompilerContext): string {
  ctx.error(
    `Bare @${expr.name} reference requires a property (e.g., @${expr.name}.property)`,
    expr.__cst?.range
  );
  return `@${expr.name}`;
}

function compileSubscriptExpression(
  expr: SubscriptExpression,
  ctx: CompilerContext,
  opts: CompileExpressionOptions
): string {
  const compileIndex = (): string =>
    expr.index instanceof SliceExpression
      ? compileSlice(expr.index, ctx, opts)
      : compileExprNode(expr.index, ctx, opts);

  if (expr.object instanceof AtIdentifier && expr.object.name === 'outputs') {
    return `result[${compileIndex()}]`;
  }

  if (
    expr.object instanceof AtIdentifier &&
    expr.object.name === 'system_variables'
  ) {
    if (expr.index instanceof SliceExpression) {
      ctx.error(
        'Slices are not supported on @system_variables (use @system_variables.uploaded_files[…] for slicing uploaded files)',
        expr.__cst?.range
      );
      return '';
    }
    const index = compileExprNode(expr.index, ctx, opts);
    switch (index) {
      case '"user_input"':
        return 'system["input_text"]';
      case '"current_modality"':
        return 'system["current_modality"]';
      case '"current_connection"':
        return 'system["current_connection"]';
      case '"last_reply"':
        // Nested object; sub-member subscripts fall through to the generic
        // subscript builder, yielding `system["last_reply"][...]`.
        return 'system["last_reply"]';
      case '"uploaded_files"':
        // Bracket form @system_variables["uploaded_files"]
        ctx.fileCapture.capture({ all: true }, expr.__cst?.range);
        return 'system["uploaded_files"]';
    }
    ctx.error(`Unknown system variable: ${index}`, expr.__cst?.range);
    return `state[${index}]`;
  }

  // `@system_variables.uploaded_files[…]` — a subscript on a member expression
  // whose object resolves to `system.uploaded_files`. Slices are legal here
  // (uploaded_files is a list).
  if (
    expr.object instanceof MemberExpression &&
    expr.object.object instanceof AtIdentifier &&
    expr.object.object.name === 'system_variables' &&
    expr.object.property === 'uploaded_files'
  ) {
    // Capture the subscript or slice
    if (expr.index instanceof SliceExpression) {
      // Slice: extract start/stop/step bounds if they are integer literals
      const start = expr.index.start
        ? extractIntegerLiteral(expr.index.start)
        : null;
      const stop = expr.index.stop
        ? extractIntegerLiteral(expr.index.stop)
        : null;
      const step = expr.index.step
        ? extractIntegerLiteral(expr.index.step)
        : null;

      // If any component is a non-literal (variable/expression), we cannot
      // pre-resolve. Conservatively skip capture and emit a diagnostic.
      if (
        (expr.index.start && start === undefined) ||
        (expr.index.stop && stop === undefined) ||
        (expr.index.step && step === undefined)
      ) {
        ctx.warning(
          'Slice bounds must be integer literals for file reference tracking; dynamic slices are not captured',
          expr.__cst?.range
        );
      } else if (step === 0) {
        // `[a:b:0]` is invalid Python (raises ValueError on apply). Skip capture
        // and surface it rather than emit a descriptor the runtime would choke on.
        ctx.warning(
          'Slice step must not be 0; this file reference is not captured',
          expr.__cst?.range
        );
      } else {
        // The step (`[a:b:2]`) is carried through to the descriptor so the
        // runtime applies the exact strided selection (fifo[start:stop:step])
        // rather than over-selecting the whole start:stop range.
        ctx.fileCapture.capture(
          {
            slice: {
              start: start ?? null,
              stop: stop ?? null,
              step: step ?? null,
            },
          },
          expr.__cst?.range
        );
      }
    } else {
      // Subscript: extract index if it's an integer literal
      const index = extractIntegerLiteral(expr.index);
      if (index !== undefined) {
        ctx.fileCapture.capture({ index }, expr.__cst?.range);
      } else {
        // Dynamic subscript (variable/expression): cannot pre-resolve, skip capture + diagnostic
        ctx.warning(
          'Subscript index must be an integer literal for file reference tracking; dynamic subscripts are not captured',
          expr.__cst?.range
        );
      }
    }

    return `system.uploaded_files[${compileIndex()}]`;
  }

  const obj = compileAccessTarget(expr.object, ctx, opts);
  return `${obj}[${compileIndex()}]`;
}

/**
 * Emit a Python-style slice, e.g. `1:3`, `:5`, `2:`, `1:9:2`. Slices are only
 * legal inside a subscript — the compiler never sees a bare slice.
 */
function compileSlice(
  slice: SliceExpression,
  ctx: CompilerContext,
  opts: CompileExpressionOptions
): string {
  const start = slice.start ? compileExprNode(slice.start, ctx, opts) : '';
  const stop = slice.stop ? compileExprNode(slice.stop, ctx, opts) : '';
  if (slice.step) {
    return `${start}:${stop}:${compileExprNode(slice.step, ctx, opts)}`;
  }
  return `${start}:${stop}`;
}

/**
 * Operator binding strength, following Python's precedence because compiled
 * expressions are evaluated as Python. Higher binds tighter; everything that
 * is not an operator expression (literals, references, calls, subscripts,
 * member accesses) is primary.
 */
const PRECEDENCE = {
  ternary: 1,
  or: 2,
  and: 3,
  not: 4,
  comparison: 5,
  additive: 6,
  multiplicative: 7,
  unary: 8,
  primary: 9,
} as const;

function binaryPrecedence(operator: BinaryOperator): number {
  switch (operator) {
    case 'or':
      return PRECEDENCE.or;
    case 'and':
      return PRECEDENCE.and;
    case '+':
    case '-':
      return PRECEDENCE.additive;
    case '*':
    case '/':
      return PRECEDENCE.multiplicative;
  }
}

function precedenceOf(expr: Expression): number {
  if (expr instanceof TernaryExpression) return PRECEDENCE.ternary;
  if (expr instanceof ComparisonExpression) return PRECEDENCE.comparison;
  if (expr instanceof UnaryExpression) {
    return expr.operator === 'not' ? PRECEDENCE.not : PRECEDENCE.unary;
  }
  if (expr instanceof BinaryExpression) return binaryPrecedence(expr.operator);
  return PRECEDENCE.primary;
}

/**
 * Compile an operand, adding parentheses when it binds more loosely than
 * `minPrecedence`. Grouping comes from the shape of the tree, not from the
 * source text, so the output is correct for hand-built ASTs too.
 */
function compileOperand(
  expr: Expression,
  minPrecedence: number,
  ctx: CompilerContext,
  opts: CompileExpressionOptions
): string {
  const compiled = compileExprNode(expr, ctx, opts);
  return precedenceOf(expr) < minPrecedence ? `(${compiled})` : compiled;
}

function compileBinaryExpression(
  expr: BinaryExpression,
  ctx: CompilerContext,
  opts: CompileExpressionOptions
): string {
  // Left-associative: an equal-precedence right operand needs parentheses.
  const precedence = binaryPrecedence(expr.operator);
  const left = compileOperand(expr.left, precedence, ctx, opts);
  const right = compileOperand(expr.right, precedence + 1, ctx, opts);
  return `${left} ${expr.operator} ${right}`;
}

function compileUnaryExpression(
  expr: UnaryExpression,
  ctx: CompilerContext,
  opts: CompileExpressionOptions
): string {
  if (expr.operator === 'not') {
    return `not ${compileOperand(expr.operand, PRECEDENCE.not, ctx, opts)}`;
  }
  const operand = compileOperand(expr.operand, PRECEDENCE.unary, ctx, opts);
  return `${expr.operator}${operand}`;
}

function compileComparisonExpression(
  expr: ComparisonExpression,
  ctx: CompilerContext,
  opts: CompileExpressionOptions
): string {
  // Python chains comparisons (`a < b < c` is `a < b and b < c`), so a
  // comparison operand of a comparison is always parenthesized.
  const minPrecedence = PRECEDENCE.comparison + 1;
  const left = compileOperand(expr.left, minPrecedence, ctx, opts);
  const right = compileOperand(expr.right, minPrecedence, ctx, opts);
  return `${left} ${expr.operator} ${right}`;
}

function compileTernaryExpression(
  expr: TernaryExpression,
  ctx: CompilerContext,
  opts: CompileExpressionOptions
): string {
  // Right-associative: only the alternative may be an unparenthesized ternary.
  const operandMin = PRECEDENCE.ternary + 1;
  const consequence = compileOperand(expr.consequence, operandMin, ctx, opts);
  const condition = compileOperand(expr.condition, operandMin, ctx, opts);
  const alternative = compileOperand(
    expr.alternative,
    PRECEDENCE.ternary,
    ctx,
    opts
  );
  return `${consequence} if ${condition} else ${alternative}`;
}

/** The target of `.x`, `[i]` or `(...)` must be primary. */
function compileAccessTarget(
  expr: Expression,
  ctx: CompilerContext,
  opts: CompileExpressionOptions
): string {
  return compileOperand(expr, PRECEDENCE.primary, ctx, opts);
}

function compileCallExpression(
  expr: CallExpression,
  ctx: CompilerContext,
  opts: CompileExpressionOptions
): string {
  const func = compileAccessTarget(expr.func, ctx, opts);
  const args = expr.args
    .map((a: Expression) => compileExprNode(a, ctx, opts))
    .join(', ');
  return `${func}(${args})`;
}

export function compileValueExpression(
  expr: Expression,
  ctx: CompilerContext,
  opts: CompileExpressionOptions = {}
): string {
  return compileExprNode(expr, ctx, opts);
}

function compileTemplateExpression(
  expr: TemplateExpression,
  ctx: CompilerContext,
  opts: CompileExpressionOptions
): string {
  return expr.parts.map(part => compileTemplatePart(part, ctx, opts)).join('');
}

function compileTemplatePart(
  part: TemplatePart,
  ctx: CompilerContext,
  opts: CompileExpressionOptions
): string {
  if (part instanceof TemplateText) {
    return part.value;
  }
  if (part instanceof TemplateInterpolation) {
    const compiled = compileExprNode(part.expression, ctx, opts);
    if (opts.isSystemMessage && compiled.startsWith('$Context.')) {
      return `{!${compiled}}`;
    }
    return `{{${compiled}}}`;
  }
  return '';
}
