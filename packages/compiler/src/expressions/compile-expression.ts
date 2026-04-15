import {
  type Expression,
  type TemplatePart,
  MemberExpression,
  AtIdentifier,
  Identifier,
  SubscriptExpression,
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
  NoneLiteral,
  decomposeAtMemberExpression,
  escapeStringValue,
} from '@agentscript/language';
import type { CompilerContext } from '../compiler-context.js';

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
  compiled = compiled.replace(/@variables\.(\w+)/g, (_, varName) => {
    const ns = ctx.getVariableNamespace(varName);
    if (ns === 'context') return `variables.${varName}`;
    if (ns === 'state') return `state.${varName}`;
    ctx.warning(
      `Variable '${varName}' not found in known variables, defaulting to state namespace`,
      expr.__cst?.range
    );
    return `state.${varName}`;
  });

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
  if (expr instanceof MemberExpression) {
    return compileMemberExpression(expr, ctx, opts);
  }
  if (expr instanceof AtIdentifier) {
    return compileAtIdentifier(expr, ctx);
  }
  if (expr instanceof SubscriptExpression) {
    return compileSubscriptExpression(expr, ctx, opts);
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
          return `$Context.${property}`;
        }
        const ns = ctx.getVariableNamespace(property);
        if (ns === 'context') return `variables.${property}`;
        if (ns === 'state') return `state.${property}`;
        ctx.warning(
          `Variable '${property}' not found in known variables, defaulting to state namespace`,
          expr.__cst?.range
        );
        return `state.${property}`;
      }

      case 'outputs':
        return `result.${property}`;

      case 'inputs': {
        const connName = ctx.connectionName;
        if (connName) {
          return `connection.${connName}.inputs.${property}`;
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
        if (property === 'user_input') {
          return 'state.__user_input__';
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
          return value;
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
        const obj = compileExprNode(expr.object, ctx, opts);
        return `${obj}.${property}`;
      }
    }
  }

  const obj = compileExprNode(expr.object, ctx, opts);
  // Convert .length to len() function call for runtime compatibility
  if (expr.property === 'length') {
    return `len(${obj})`;
  }
  return `${obj}.${expr.property}`;
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
  if (expr.object instanceof AtIdentifier && expr.object.name === 'outputs') {
    const index = compileExprNode(expr.index, ctx, opts);
    return `result[${index}]`;
  }

  if (
    expr.object instanceof AtIdentifier &&
    expr.object.name === 'system_variables'
  ) {
    const index = compileExprNode(expr.index, ctx, opts);
    if (index === '"user_input"') {
      return 'state["__user_input__"]';
    }
    ctx.error(`Unknown system variable: ${index}`, expr.__cst?.range);
    return `state[${index}]`;
  }

  const obj = compileExprNode(expr.object, ctx, opts);
  const index = compileExprNode(expr.index, ctx, opts);
  return `${obj}[${index}]`;
}

function compileBinaryExpression(
  expr: BinaryExpression,
  ctx: CompilerContext,
  opts: CompileExpressionOptions
): string {
  const left = compileExprNode(expr.left, ctx, opts);
  const right = compileExprNode(expr.right, ctx, opts);

  // Check if the right operand was parenthesized in the source
  // CST structure: parenthesized_expression > expression > binary_expression
  // So we need to check parent or grandparent for parenthesized_expression
  const rightCst = expr.right.__cst?.node;
  const rightParenthesized =
    rightCst?.parent?.type === 'parenthesized_expression' ||
    rightCst?.parent?.parent?.type === 'parenthesized_expression';

  if (rightParenthesized) {
    return `${left} ${expr.operator} (${right})`;
  }

  // Check if the left operand was parenthesized
  const leftCst = expr.left.__cst?.node;
  const leftParenthesized =
    leftCst?.parent?.type === 'parenthesized_expression' ||
    leftCst?.parent?.parent?.type === 'parenthesized_expression';

  if (leftParenthesized) {
    return `(${left}) ${expr.operator} ${right}`;
  }

  return `${left} ${expr.operator} ${right}`;
}

function compileUnaryExpression(
  expr: UnaryExpression,
  ctx: CompilerContext,
  opts: CompileExpressionOptions
): string {
  const operand = compileExprNode(expr.operand, ctx, opts);
  if (expr.operator === 'not') {
    return `not ${operand}`;
  }
  return `${expr.operator}${operand}`;
}

function compileComparisonExpression(
  expr: ComparisonExpression,
  ctx: CompilerContext,
  opts: CompileExpressionOptions
): string {
  const left = compileExprNode(expr.left, ctx, opts);
  const right = compileExprNode(expr.right, ctx, opts);

  // Preserve original whitespace around the operator from the source text
  const cstText = expr.__cst?.node?.text;
  if (cstText) {
    const leftCst = expr.left.__cst?.node?.text;
    const rightCst = expr.right.__cst?.node?.text;
    if (leftCst && rightCst) {
      // Extract the operator with surrounding whitespace from the CST
      const leftEnd = cstText.indexOf(leftCst) + leftCst.length;
      const rightStart = cstText.lastIndexOf(rightCst);
      if (leftEnd >= 0 && rightStart > leftEnd) {
        const operatorWithSpace = cstText.slice(leftEnd, rightStart);
        return `${left}${operatorWithSpace}${right}`;
      }
    }
  }

  return `${left} ${expr.operator} ${right}`;
}

function compileTernaryExpression(
  expr: TernaryExpression,
  ctx: CompilerContext,
  opts: CompileExpressionOptions
): string {
  const consequence = compileExprNode(expr.consequence, ctx, opts);
  const condition = compileExprNode(expr.condition, ctx, opts);
  const alternative = compileExprNode(expr.alternative, ctx, opts);
  return `${consequence} if ${condition} else ${alternative}`;
}

function compileCallExpression(
  expr: CallExpression,
  ctx: CompilerContext,
  opts: CompileExpressionOptions
): string {
  const func = compileExprNode(expr.func, ctx, opts);
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
    if (opts.isSystemMessage) {
      return `{!${compiled}}`;
    }
    return `{{${compiled}}}`;
  }
  return '';
}
