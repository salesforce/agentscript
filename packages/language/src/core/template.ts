/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { EmitContext, SyntaxNode, Parsed } from './types.js';
import { withCst, AstNodeBase, emitIndent } from './types.js';
import type { Diagnostic } from './diagnostics.js';
import { createDiagnostic, DiagnosticSeverity } from './diagnostics.js';
import type { Expression } from './expression-base.js';
import { ExpressionBase } from './expression-base.js';

/** A plain text segment within a template. */
export class TemplateText extends AstNodeBase {
  static readonly kind = 'TemplateText' as const;
  readonly __kind = TemplateText.kind;

  constructor(public value: string) {
    super();
  }

  __describe(): string {
    const preview = this.value.slice(0, 20);
    return `template text "${preview}${this.value.length > 20 ? '...' : ''}"`;
  }

  __emit(_ctx: EmitContext): string {
    return this.value;
  }
}

/** An interpolated expression `{!expr}` within a template. */
export class TemplateInterpolation extends AstNodeBase {
  static readonly kind = 'TemplateInterpolation' as const;
  readonly __kind = TemplateInterpolation.kind;

  constructor(public expression: Expression) {
    super();
  }

  __describe(): string {
    return `interpolation {!${this.expression.__describe()}}`;
  }

  __emit(ctx: EmitContext): string {
    return `{!${this.expression.__emit(ctx)}}`;
  }
}

export type TemplatePart = TemplateText | TemplateInterpolation;

/**
 * All template part classes -- single source of truth for part kinds.
 * TemplatePartKind and TEMPLATE_PART_KINDS are derived automatically.
 */
const ALL_TEMPLATE_PART_CLASSES = [
  TemplateText,
  TemplateInterpolation,
] as const;

export type TemplatePartKind =
  (typeof ALL_TEMPLATE_PART_CLASSES)[number]['kind'];

export const TEMPLATE_PART_KINDS: ReadonlySet<TemplatePartKind> = new Set(
  ALL_TEMPLATE_PART_CLASSES.map(C => C.kind)
);

const TEMPLATE_PART_KIND_STRINGS: ReadonlySet<string> = TEMPLATE_PART_KINDS;
export function isTemplatePartKind(kind: string): kind is TemplatePartKind {
  return TEMPLATE_PART_KIND_STRINGS.has(kind);
}

/** Parse template CST node into TemplatePart nodes with diagnostics. */
export function parseTemplateParts(
  node: SyntaxNode,
  parseExpr: (n: SyntaxNode) => Expression
): { parts: TemplatePart[]; diagnostics: Diagnostic[] } {
  const parts: TemplatePart[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const child of node.namedChildren) {
    if (child.type === 'template_content') {
      parts.push(withCst(new TemplateText(child.text), child));
    } else if (child.type === 'template_expression') {
      const exprNode = child.childForFieldName('expression');
      if (exprNode) {
        parts.push(
          withCst(new TemplateInterpolation(parseExpr(exprNode)), child)
        );
      } else {
        diagnostics.push(
          createDiagnostic(
            child,
            'Malformed template interpolation: missing expression',
            DiagnosticSeverity.Warning,
            'malformed-interpolation'
          )
        );
        parts.push(withCst(new TemplateText(child.text), child));
      }
    } else {
      diagnostics.push(
        createDiagnostic(
          child,
          `Unexpected node in template: ${child.type}`,
          DiagnosticSeverity.Warning,
          'unexpected-template-node'
        )
      );
    }
  }
  dedentTemplateParts(parts, node);
  return { parts, diagnostics };
}

/**
 * Strip base-level indentation from TemplateText values within a template.
 *
 * Uses the `|` character's source column to compute the content start column
 * (pipe column + 1 + first line leading whitespace), then strips that many
 * characters from each continuation line. This preserves intentional relative
 * indentation beyond the content start.
 *
 * Falls back to min-indent when CST position is unavailable.
 *
 * ## Post-dedent invariant (consumed by Template.__emit / TemplateExpression.__emit)
 *
 * After this function runs, continuation lines contain only *relative*
 * indentation measured from column 0. Any remaining leading whitespace is
 * intentional (e.g. nested list items) and must be preserved by emit.
 *
 * The emit methods rely on this: they compute `baseIndent` as the minimum
 * leading whitespace across non-blank continuation lines, strip that base,
 * and re-indent to the target output depth. Because dedent has already
 * removed source-level formatting, emit's min-indent correctly isolates
 * intentional relative indentation without knowledge of the original
 * source column.
 */
function dedentTemplateParts(parts: TemplatePart[], node: SyntaxNode): void {
  // Build the full text to compute base indentation.
  const fullText = parts
    .map(p => (p instanceof TemplateText ? p.value : 'X'))
    .join('');

  const firstNewline = fullText.indexOf('\n');

  // --- Phase 1: Strip base indentation from continuation lines ---
  if (firstNewline !== -1) {
    const lines = fullText.split('\n');

    // Compute the content start column using the pipe's source position.
    // This matches how YAML block scalars determine the indentation base:
    // the content starts at the column of | + 1 + first line's leading whitespace.
    const pipeColumn = node.startPosition?.column;
    let stripAmount: number;
    if (pipeColumn !== undefined) {
      const firstLineIndent = lines[0].match(/^(\s*)/)?.[1]?.length ?? 0;
      stripAmount = pipeColumn + 1 + firstLineIndent;
    } else {
      // Fallback: use minimum indentation of continuation lines
      let minIndent = Infinity;
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim().length === 0) continue;
        const indent = lines[i].search(/\S/);
        if (indent >= 0) minIndent = Math.min(minIndent, indent);
      }
      stripAmount = minIndent === Infinity ? 0 : minIndent;
    }

    if (stripAmount > 0) {
      // globalLineIndex tracks position across all parts so we skip
      // the very first line (line 0) which has no base indentation.
      // Interpolation parts don't contain newlines in the grammar,
      // so they don't advance the line counter.
      let globalLineIndex = 0;
      // Track whether we're at the start of a line. Only strip indent
      // at line starts — mid-line text after interpolations must be
      // preserved as-is (e.g. ` and ` between two interpolations).
      let atLineStart = true;

      for (const part of parts) {
        if (!(part instanceof TemplateText)) {
          // Interpolations don't contain newlines, so after an
          // interpolation we're mid-line.
          atLineStart = false;
          continue;
        }
        const text = part.value;
        const partLines = text.split('\n');
        for (let i = 0; i < partLines.length; i++) {
          if (i > 0) {
            globalLineIndex++;
            atLineStart = true;
          }
          if (atLineStart && globalLineIndex > 0 && partLines[i].length > 0) {
            const lineIndent = partLines[i].search(/\S|$/);
            partLines[i] = partLines[i].slice(
              Math.min(lineIndent, stripAmount)
            );
          }
        }
        // After processing this text part, we're at line start only
        // if the part ended with a newline (i.e. last line is empty)
        atLineStart = partLines[partLines.length - 1].length === 0;
        part.value = partLines.join('\n');
      }
    }
  }

  // --- Phase 2: Produce clean semantic values ---
  // Trim first-line leading whitespace (space after `|`), strip leading
  // newlines, normalize blank lines, and trim trailing whitespace.
  // This ensures consumers get final content without further post-processing.
  cleanTemplateParts(parts);
}

/**
 * Clean up TemplateText values after dedentation so consumers get
 * ready-to-use content without post-processing.
 *
 * Applies four transformations in order:
 * 1. Strip leading newlines from the first text part (preserving intentional blanks)
 * 2. Trim the space after `|` on the first line
 * 3. Normalize blank continuation lines to empty strings
 * 4. Trim trailing whitespace when the template ends with text (not an interpolation)
 */
function cleanTemplateParts(parts: TemplatePart[]): void {
  if (parts.length === 0) return;

  const firstText = parts.find(
    (p): p is TemplateText => p instanceof TemplateText
  );
  if (firstText) {
    firstText.value = stripLeadingNewlines(firstText.value);
    firstText.value = trimFirstLineWhitespace(firstText.value);
  }

  normalizeBlankLines(parts);
  trimTrailingTextWhitespace(parts);
}

/**
 * Strip leading newlines, but preserve one if two or more were present.
 *
 * Convention: two+ newlines after `|` signals an intentional blank line
 * between the pipe and content. A single newline is just the normal line
 * break after `|` and is discarded. This convention is shared with the
 * compiler's `dedent()` in `packages/compiler/src/utils.ts`.
 *
 * Examples:
 *   "| hello"      → (no newlines) → "hello"      — inline content
 *   "|\n  hello"   → (1 newline)   → "  hello"    — normal multiline
 *   "|\n\n  hello" → (2 newlines)  → "\n  hello"  — intentional blank line preserved
 */
function stripLeadingNewlines(value: string): string {
  const leadingNewlines = value.match(/^\n+/)?.[0]?.length ?? 0;
  const stripped = value.replace(/^\n+/, '');
  return leadingNewlines >= 2 ? '\n' + stripped : stripped;
}

/**
 * Trim leading whitespace from the first line only.
 * This removes the space between `|` and the start of inline content.
 */
function trimFirstLineWhitespace(value: string): string {
  const nlPos = value.indexOf('\n');
  if (nlPos === -1) return value.trimStart();
  return value.slice(0, nlPos).trimStart() + value.slice(nlPos);
}

/**
 * Normalize whitespace-only continuation lines to empty strings across
 * all TemplateText parts. Skips the first line of each part (line index 0)
 * since that is either the content start or a continuation of a previous line.
 */
function normalizeBlankLines(parts: TemplatePart[]): void {
  for (const part of parts) {
    if (!(part instanceof TemplateText)) continue;
    const tp = part;
    const partLines = tp.value.split('\n');
    for (let i = 1; i < partLines.length; i++) {
      if (partLines[i].trim().length === 0) {
        partLines[i] = '';
      }
    }
    tp.value = partLines.join('\n');
  }
}

/**
 * Trim trailing whitespace from the last part, but only when it is
 * TemplateText. When the last part is an interpolation, the preceding
 * text's trailing whitespace is meaningful content (e.g., "hello ${name}"
 * — the space before `${` must be kept).
 */
function trimTrailingTextWhitespace(parts: TemplatePart[]): void {
  const lastPart = parts[parts.length - 1];
  if (lastPart instanceof TemplateText) {
    lastPart.value = lastPart.value.trimEnd();
  }
}

export class TemplateExpression extends ExpressionBase {
  static readonly kind = 'TemplateExpression' as const;
  readonly __kind = TemplateExpression.kind;

  /**
   * When true, the `|` was on its own line with content on following lines.
   * Detected from CST text: `|` followed by only whitespace/newline before content.
   */
  public barePipeMultiline = false;

  /**
   * When true, emit a space between `|` and the content (e.g. `| Hello`).
   * Detected from CST source text during parse; defaults to false for
   * programmatically constructed templates.
   */
  public spaceAfterPipe = false;

  constructor(public parts: TemplatePart[]) {
    super();
  }

  get content(): string {
    return this.parts.map(p => p.__emit({ indent: 0 })).join('');
  }

  __describe(): string {
    const c = this.content;
    const preview = c.slice(0, 20);
    return `template "${preview}${c.length > 20 ? '...' : ''}"`;
  }

  __emit(ctx: EmitContext): string {
    const rawInner = this.parts.map(p => p.__emit(ctx)).join('');
    // Relies on dedentTemplateParts post-dedent invariant: continuation
    // lines already have only relative indentation from column 0.
    // See dedentTemplateParts() above for details.
    const childIndent = emitIndent({ ...ctx, indent: ctx.indent + 1 });
    const lines = rawInner.split('\n');

    // When `|` was on its own line (bare pipe multi-line), emit `|` then
    // newline then all content lines indented — preserving relative indent.
    if (this.barePipeMultiline && lines.length > 0) {
      const allReindented = lines
        .map(line => {
          if (line.trim().length === 0) return '';
          return childIndent + line;
        })
        .join('\n');
      return `|\n${allReindented}`;
    }

    const sep = this.spaceAfterPipe ? ' ' : '';
    return lines
      .map((line, i) => {
        if (i === 0) return line.length > 0 ? `|${sep}${line}` : '|';
        if (line.trim().length === 0) return '';
        return `${childIndent}${line}`;
      })
      .join('\n');
  }

  static parse(
    node: SyntaxNode,
    parseExpr: (n: SyntaxNode) => Expression
  ): Parsed<TemplateExpression> {
    const { parts, diagnostics } = parseTemplateParts(node, parseExpr);
    const expr = withCst(new TemplateExpression(parts), node);
    // Detect bare pipe multi-line and space-after-pipe from CST source text
    const nodeText = node.text;
    if (nodeText && parts.length > 0) {
      const afterPipe = nodeText.slice(1); // skip '|'
      const firstNonWs = afterPipe.search(/\S/);
      if (firstNonWs > 0 && afterPipe.slice(0, firstNonWs).includes('\n')) {
        expr.barePipeMultiline = true;
      }
      // Detect space between `|` and inline content (e.g. `| Hello`)
      if (
        !expr.barePipeMultiline &&
        afterPipe.length > 0 &&
        afterPipe[0] === ' '
      ) {
        expr.spaceAfterPipe = true;
      }
    }
    expr.__diagnostics.push(...diagnostics);
    return expr;
  }
}
