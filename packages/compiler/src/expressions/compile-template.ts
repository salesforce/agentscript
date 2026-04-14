import type { TemplatePart } from '@agentscript/language';
import {
  TemplateText,
  TemplateInterpolation,
  Template,
  TemplateExpression,
  ProcedureValue,
} from '@agentscript/language';
import type { CompilerContext } from '../compiler-context.js';
import {
  compileExpression,
  type CompileExpressionOptions,
} from './compile-expression.js';

/**
 * Compile a template (sequence of text + interpolations) into a string.
 *
 * Templates in source: `| Hello {!@variables.name}!`
 * Compiled output: `Hello {{state.name}}!`
 * System message: `Hello {!$Context.name}!`
 */
export function compileTemplate(
  parts: TemplatePart[],
  ctx: CompilerContext,
  opts: CompileExpressionOptions = {}
): string {
  return parts
    .map(part => {
      const kind = (part as { __kind?: string }).__kind;
      if (part instanceof TemplateText || kind === 'TemplateText') {
        return (part as TemplateText).value;
      }
      if (
        part instanceof TemplateInterpolation ||
        kind === 'TemplateInterpolation'
      ) {
        const compiled = compileExpression(
          (part as TemplateInterpolation).expression,
          ctx,
          opts
        );
        if (opts.isSystemMessage) {
          return `{!${compiled}}`;
        }
        // Action references (action.X) should not be wrapped in {{}}
        if (compiled.startsWith('action.')) {
          return compiled;
        }
        return `{{${compiled}}}`;
      }
      return '';
    })
    .join('');
}

/**
 * Compile a template value (string or TemplateExpression or Template statement)
 * into a plain string.
 */
export function compileTemplateValue(
  value: unknown,
  ctx: CompilerContext,
  opts: CompileExpressionOptions = {}
): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';

  const kind = (value as { __kind?: string }).__kind;

  // ProcedureValueNode: has .statements array (wraps Template statements)
  if (value instanceof ProcedureValue || kind === 'ProcedureValue') {
    const stmts = (value as ProcedureValue).statements;
    if (stmts?.length > 0) {
      return stmts
        .map(stmt => compileTemplateValue(stmt, ctx, opts))
        .filter(Boolean)
        .join('\n');
    }
  }

  // Template statement or TemplateExpression — both have .parts
  if (
    value instanceof Template ||
    value instanceof TemplateExpression ||
    kind === 'Template' ||
    kind === 'TemplateExpression'
  ) {
    return compileTemplate((value as Template).parts, ctx, opts);
  }

  // Structural fallbacks for non-class values (e.g. StringLiteral plain objects)
  if ('content' in value) {
    const c = (value as { content: unknown }).content;
    if (typeof c === 'string') return c;
  }

  if ('value' in value) {
    const v = (value as { value: unknown }).value;
    if (typeof v === 'string') return v;
  }

  return '';
}
