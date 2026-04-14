import type {
  EmitContext,
  SyntaxNode,
  Parsed,
  AstNode,
  CstMeta,
  Comment,
} from './types.js';
import { withCst, createNode, AstNodeBase, emitIndent } from './types.js';
import type { Diagnostic } from './diagnostics.js';
import { createDiagnostic, DiagnosticSeverity } from './diagnostics.js';

export interface Expression {
  readonly __kind: string;
  __emit(ctx: EmitContext): string;
  __diagnostics: Diagnostic[];
  __cst?: CstMeta;
  __comments?: Comment[];
  /** User-friendly description for error messages (e.g., "number 42") */
  __describe(): string;
}

export class StringLiteral extends AstNodeBase implements Expression {
  static readonly kind = 'StringLiteral' as const;
  static readonly kindLabel = 'a string';
  readonly __kind = StringLiteral.kind;

  constructor(public value: string) {
    super();
  }

  __describe(): string {
    return `string "${this.value}"`;
  }

  __emit(_ctx: EmitContext): string {
    // Prefer CST text for round-trip fidelity (preserves original escaping).
    // For unclosed strings (CST text doesn't end with a matching quote),
    // fall through to the clean emit path to prevent newline accumulation.
    const cstText = this.__cst?.node?.text;
    if (cstText) {
      const quote = cstText[0];
      if (
        (quote === '"' || quote === "'") &&
        cstText.length > 1 &&
        cstText.endsWith(quote)
      ) {
        return cstText;
      }
      // Unclosed string — fall through to clean emit
    }

    const escaped = this.value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\t/g, '\\t')
      .replace(/\r/g, '\\r');
    return `"${escaped}"`;
  }

  static parse(node: SyntaxNode): Parsed<StringLiteral> {
    let value = '';
    for (const child of node.namedChildren) {
      if (child.type === 'string_content') {
        value += child.text;
      } else if (child.type === 'escape_sequence') {
        if (child.text === '\\"') value += '"';
        else if (child.text === "\\'") value += "'";
        else if (child.text === '\\\\') value += '\\';
        else if (child.text === '\\n') value += '\n';
        else if (child.text === '\\t') value += '\t';
        else if (child.text === '\\r') value += '\r';
      }
    }
    const parsed = withCst(new StringLiteral(value), node);
    // Flag raw newlines (source spans multiple lines), but not \n escape sequences
    const hasRawNewlines = node.startRow !== node.endRow;
    if (hasRawNewlines) {
      parsed.__diagnostics = [
        createDiagnostic(
          node,
          'String literals must not contain raw newlines. Use template syntax (| ...) for multi-line content.',
          DiagnosticSeverity.Error,
          'string-contains-newline'
        ),
      ];
    }
    return parsed;
  }
}

/** A plain text segment within a template. */
export class TemplateText extends AstNodeBase {
  static readonly kind = 'TemplateText' as const;
  static readonly kindLabel = 'template text';
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
  static readonly kindLabel = 'template interpolation';
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

export class TemplateExpression extends AstNodeBase implements Expression {
  static readonly kind = 'TemplateExpression' as const;
  static readonly kindLabel = 'a template';
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

export class NumberLiteral extends AstNodeBase implements Expression {
  static readonly kind = 'NumberLiteral' as const;
  static readonly kindLabel = 'a number';
  readonly __kind = NumberLiteral.kind;

  constructor(public value: number) {
    super();
  }

  __describe(): string {
    return `number ${this.value}`;
  }

  __emit(_ctx: EmitContext): string {
    // Prefer CST text for round-trip fidelity (preserves "1.0" vs "1", etc.)
    if (this.__cst) {
      return this.__cst.node.text;
    }
    return String(this.value);
  }

  static parse(node: SyntaxNode): Parsed<NumberLiteral> {
    return withCst(new NumberLiteral(Number(node.text)), node);
  }
}

export class BooleanLiteral extends AstNodeBase implements Expression {
  static readonly kind = 'BooleanLiteral' as const;
  static readonly kindLabel = 'True or False';
  readonly __kind = BooleanLiteral.kind;

  constructor(public value: boolean) {
    super();
  }

  __describe(): string {
    return this.value ? 'True' : 'False';
  }

  __emit(_ctx: EmitContext): string {
    return this.value ? 'True' : 'False';
  }

  static parse(node: SyntaxNode): Parsed<BooleanLiteral> {
    return withCst(new BooleanLiteral(node.text === 'True'), node);
  }
}

export class NoneLiteral extends AstNodeBase implements Expression {
  static readonly kind = 'NoneLiteral' as const;
  static readonly kindLabel = 'None';
  readonly __kind = NoneLiteral.kind;

  __describe(): string {
    return 'None';
  }

  __emit(_ctx: EmitContext): string {
    return 'None';
  }

  static parse(node: SyntaxNode): Parsed<NoneLiteral> {
    return withCst(new NoneLiteral(), node);
  }
}

export class Identifier extends AstNodeBase implements Expression {
  static readonly kind = 'Identifier' as const;
  static readonly kindLabel = 'an identifier';
  readonly __kind = Identifier.kind;

  constructor(public name: string) {
    super();
  }

  __describe(): string {
    return `identifier "${this.name}"`;
  }

  __emit(_ctx: EmitContext): string {
    return this.name;
  }

  static parse(node: SyntaxNode): Parsed<Identifier> {
    return withCst(new Identifier(node.text), node);
  }
}

/**
 * Placeholder expression for values that failed to parse.
 * Preserves the raw source text for faithful round-trip emission.
 */
export class ErrorValue extends AstNodeBase implements Expression {
  static readonly kind = 'ErrorValue' as const;
  static readonly kindLabel = 'an error value';
  readonly __kind = ErrorValue.kind;

  constructor(public rawText: string) {
    super();
  }

  __describe(): string {
    return `error value: ${this.rawText}`;
  }

  __emit(_ctx: EmitContext): string {
    return this.rawText;
  }
}

export class AtIdentifier extends AstNodeBase implements Expression {
  static readonly kind = 'AtIdentifier' as const;
  static readonly kindLabel = 'a reference (e.g., @Foo)';
  readonly __kind = AtIdentifier.kind;

  constructor(public name: string) {
    super();
  }

  __describe(): string {
    return `reference @${this.name}`;
  }

  __emit(_ctx: EmitContext): string {
    return `@${this.name}`;
  }

  static parse(node: SyntaxNode): Parsed<AtIdentifier> {
    const idNode = node.namedChildren.find(n => n.type === 'id');
    const name = idNode?.text ?? node.text.slice(1);
    return withCst(new AtIdentifier(name), node);
  }
}

export class MemberExpression extends AstNodeBase implements Expression {
  static readonly kind = 'MemberExpression' as const;
  static readonly kindLabel = 'a reference (e.g., @Foo.Bar)';
  readonly __kind = MemberExpression.kind;

  constructor(
    public object: Expression,
    public property: string
  ) {
    super();
  }

  __describe(): string {
    return `expression ${this.__emit({ indent: 0 })}`;
  }

  __emit(ctx: EmitContext): string {
    return `${this.object.__emit(ctx)}.${this.property}`;
  }

  static parse(
    node: SyntaxNode,
    parseExpr: (n: SyntaxNode) => Expression
  ): Parsed<MemberExpression> {
    const children = node.namedChildren;
    const objectNode = children[0];
    const propertyNode = children.find(n => n.type === 'id');

    const object = parseExpr(objectNode);
    const property = propertyNode?.text ?? '';

    return withCst(new MemberExpression(object, property), node);
  }
}

export class SubscriptExpression extends AstNodeBase implements Expression {
  static readonly kind = 'SubscriptExpression' as const;
  static readonly kindLabel = 'a subscript expression';
  readonly __kind = SubscriptExpression.kind;

  constructor(
    public object: Expression,
    public index: Expression
  ) {
    super();
  }

  __describe(): string {
    return `expression ${this.__emit({ indent: 0 })}`;
  }

  __emit(ctx: EmitContext): string {
    return `${this.object.__emit(ctx)}[${this.index.__emit(ctx)}]`;
  }

  static parse(
    node: SyntaxNode,
    parseExpr: (n: SyntaxNode) => Expression
  ): Parsed<SubscriptExpression> {
    const children = node.namedChildren;
    const object = parseExpr(children[0]);
    const index = parseExpr(children[1]);

    return withCst(new SubscriptExpression(object, index), node);
  }
}

export type BinaryOperator = '+' | '-' | '*' | '/' | 'and' | 'or';

export class BinaryExpression extends AstNodeBase implements Expression {
  static readonly kind = 'BinaryExpression' as const;
  static readonly kindLabel = 'a binary expression';
  readonly __kind = BinaryExpression.kind;

  constructor(
    public left: Expression,
    public operator: BinaryOperator,
    public right: Expression
  ) {
    super();
  }

  __describe(): string {
    return `expression ${this.__emit({ indent: 0 })}`;
  }

  __emit(ctx: EmitContext): string {
    return `${this.left.__emit(ctx)} ${this.operator} ${this.right.__emit(ctx)}`;
  }

  static parse(
    node: SyntaxNode,
    parseExpr: (n: SyntaxNode) => Expression
  ): Parsed<BinaryExpression> {
    const children = node.namedChildren;
    const left = parseExpr(children[0]);
    const right = parseExpr(children[1]);

    const operators: BinaryOperator[] = ['+', '-', '*', '/', 'and', 'or'];
    let operator: BinaryOperator = '+';
    for (const child of node.children) {
      if (child.isNamed) continue;
      const matched = operators.find(op => op === child.text);
      if (matched) {
        operator = matched;
        break;
      }
    }

    return withCst(new BinaryExpression(left, operator, right), node);
  }
}

export type UnaryOperator = 'not' | '+' | '-';

export class UnaryExpression extends AstNodeBase implements Expression {
  static readonly kind = 'UnaryExpression' as const;
  static readonly kindLabel = 'a unary expression';
  readonly __kind = UnaryExpression.kind;

  constructor(
    public operator: UnaryOperator,
    public operand: Expression
  ) {
    super();
  }

  __describe(): string {
    return `expression ${this.__emit({ indent: 0 })}`;
  }

  __emit(ctx: EmitContext): string {
    if (this.operator === 'not') {
      return `not ${this.operand.__emit(ctx)}`;
    }
    return `${this.operator}${this.operand.__emit(ctx)}`;
  }

  static parse(
    node: SyntaxNode,
    parseExpr: (n: SyntaxNode) => Expression
  ): Parsed<UnaryExpression> {
    const children = node.namedChildren;
    const operand = parseExpr(children[0]);

    let operator: UnaryOperator = 'not';
    if (node.text.startsWith('not ')) operator = 'not';
    else if (node.text.startsWith('-')) operator = '-';
    else if (node.text.startsWith('+')) operator = '+';

    return withCst(new UnaryExpression(operator, operand), node);
  }
}

export type ComparisonOperator =
  | '=='
  | '!='
  | '<'
  | '>'
  | '<='
  | '>='
  | 'is'
  | 'is not';

export class ComparisonExpression extends AstNodeBase implements Expression {
  static readonly kind = 'ComparisonExpression' as const;
  static readonly kindLabel = 'a comparison';
  readonly __kind = ComparisonExpression.kind;

  constructor(
    public left: Expression,
    public operator: ComparisonOperator,
    public right: Expression
  ) {
    super();
  }

  __describe(): string {
    return `expression ${this.__emit({ indent: 0 })}`;
  }

  __emit(ctx: EmitContext): string {
    return `${this.left.__emit(ctx)} ${this.operator} ${this.right.__emit(ctx)}`;
  }

  static parse(
    node: SyntaxNode,
    parseExpr: (n: SyntaxNode) => Expression
  ): Parsed<ComparisonExpression> {
    // Filter out ERROR nodes from named children to get left/right operands
    const operands = node.namedChildren.filter(c => !c.isError);
    const left = parseExpr(operands[0]);
    const right = operands.length > 1 ? parseExpr(operands[1]) : left;

    // Detect operator from the non-expression children between left and right.
    // Anonymous children are operator tokens (e.g. `==`, or `is` + `not`).
    // ERROR children contain invalid operators (e.g. bare `=`) that we
    // preserve for round-trip fidelity.
    const opParts: string[] = [];
    for (const child of node.children) {
      // Skip the left and right expression operands
      if (child === operands[0] || child === operands[1]) continue;
      if (child.isError) {
        // ERROR nodes wrap invalid tokens — collect their text
        opParts.push(child.text.trim());
      } else if (!child.isNamed) {
        opParts.push(child.text.trim());
      }
    }
    const opText = opParts.filter(p => p.length > 0).join(' ');
    const operator: ComparisonOperator = (opText || '==') as ComparisonOperator;

    return withCst(new ComparisonExpression(left, operator, right), node);
  }
}

export class ListLiteral extends AstNodeBase implements Expression {
  static readonly kind = 'ListLiteral' as const;
  static readonly kindLabel = 'a list';
  readonly __kind = ListLiteral.kind;

  constructor(public elements: Expression[]) {
    super();
  }

  __describe(): string {
    return `list ${this.__emit({ indent: 0 })}`;
  }

  __emit(ctx: EmitContext): string {
    const items = this.elements.map(e => e.__emit(ctx)).join(', ');
    return `[${items}]`;
  }

  static parse(
    node: SyntaxNode,
    parseExpr: (n: SyntaxNode) => Expression
  ): Parsed<ListLiteral> {
    const elements: Expression[] = [];
    for (const child of node.namedChildren) {
      elements.push(parseExpr(child));
    }
    return withCst(new ListLiteral(elements), node);
  }
}

export class DictLiteral extends AstNodeBase implements Expression {
  static readonly kind = 'DictLiteral' as const;
  static readonly kindLabel = 'a dictionary';
  readonly __kind = DictLiteral.kind;

  constructor(
    public entries: Array<AstNode<{ key: Expression; value: Expression }>>
  ) {
    super();
  }

  __describe(): string {
    return `dictionary ${this.__emit({ indent: 0 })}`;
  }

  __emit(ctx: EmitContext): string {
    const items = this.entries
      .map(e => `${e.key.__emit(ctx)}: ${e.value.__emit(ctx)}`)
      .join(', ');
    return `{${items}}`;
  }

  static parse(
    node: SyntaxNode,
    parseExpr: (n: SyntaxNode) => Expression
  ): Parsed<DictLiteral> {
    const entries: DictLiteral['entries'] = [];
    for (const child of node.namedChildren) {
      if (child.type === 'dictionary_pair') {
        const rawKeyNode = child.childForFieldName('key');
        // Tree-sitter wraps dict keys in a `key` node (e.g., `(key (string))`).
        // Unwrap it so we parse the actual literal/identifier inside.
        const keyNode =
          rawKeyNode?.type === 'key' && rawKeyNode.namedChildren.length > 0
            ? rawKeyNode.namedChildren[0]
            : rawKeyNode;
        const valueNode = child.childForFieldName('value');
        if (keyNode && valueNode) {
          entries.push(
            withCst(
              { key: parseExpr(keyNode), value: parseExpr(valueNode) },
              child
            )
          );
        }
      }
    }
    return withCst(new DictLiteral(entries), node);
  }
}

/**
 * A function call expression, e.g. len(x)
 */
export class CallExpression extends AstNodeBase implements Expression {
  static readonly kind = 'CallExpression' as const;
  static readonly kindLabel = 'a function call';
  readonly __kind = CallExpression.kind;

  constructor(
    public func: Expression,
    public args: Expression[]
  ) {
    super();
  }

  __describe(): string {
    return `call ${this.__emit({ indent: 0 })}`;
  }

  __emit(ctx: EmitContext): string {
    const argsStr = this.args.map(a => a.__emit(ctx)).join(', ');
    return `${this.func.__emit(ctx)}(${argsStr})`;
  }

  static parse(
    node: SyntaxNode,
    parseExpr: (n: SyntaxNode) => Expression
  ): Parsed<CallExpression> {
    const funcNode = node.childForFieldName('function');
    const func = funcNode ? parseExpr(funcNode) : new Identifier('');
    const args: Expression[] = [];
    // Collect all 'argument' field children
    for (const child of node.childrenForFieldName('argument')) {
      args.push(parseExpr(child));
    }
    return withCst(new CallExpression(func, args), node);
  }
}

/**
 * Python-style ternary: consequence if condition else alternative
 */
export class TernaryExpression extends AstNodeBase implements Expression {
  static readonly kind = 'TernaryExpression' as const;
  static readonly kindLabel = 'a ternary expression';
  readonly __kind = TernaryExpression.kind;

  constructor(
    public consequence: Expression,
    public condition: Expression,
    public alternative: Expression
  ) {
    super();
  }

  __describe(): string {
    return `expression ${this.__emit({ indent: 0 })}`;
  }

  __emit(ctx: EmitContext): string {
    return `${this.consequence.__emit(ctx)} if ${this.condition.__emit(ctx)} else ${this.alternative.__emit(ctx)}`;
  }

  static parse(
    node: SyntaxNode,
    parseExpr: (n: SyntaxNode) => Expression
  ): Parsed<TernaryExpression> {
    const consequenceNode = node.childForFieldName('consequence');
    const conditionNode = node.childForFieldName('condition');
    const alternativeNode = node.childForFieldName('alternative');

    const consequence = consequenceNode
      ? parseExpr(consequenceNode)
      : new Identifier('');
    const condition = conditionNode
      ? parseExpr(conditionNode)
      : new Identifier('');
    const alternative = alternativeNode
      ? parseExpr(alternativeNode)
      : new Identifier('');

    return withCst(
      new TernaryExpression(consequence, condition, alternative),
      node
    );
  }
}

export class Ellipsis extends AstNodeBase implements Expression {
  static readonly kind = 'Ellipsis' as const;
  static readonly kindLabel = 'an ellipsis (...)';
  readonly __kind = Ellipsis.kind;

  __describe(): string {
    return 'ellipsis (...)';
  }

  __emit(_ctx: EmitContext): string {
    return '...';
  }

  static parse(node: SyntaxNode): Parsed<Ellipsis> {
    return withCst(new Ellipsis(), node);
  }
}

/**
 * A spread/unpack expression, e.g. *items or *@variables.artifacts
 * Python-style iterable unpacking in function calls and list literals.
 */
export class SpreadExpression extends AstNodeBase implements Expression {
  static readonly kind = 'SpreadExpression' as const;
  static readonly kindLabel = 'a spread expression';
  readonly __kind = SpreadExpression.kind;

  constructor(public expression: Expression) {
    super();
  }

  __describe(): string {
    return `spread *${this.expression.__describe()}`;
  }

  __emit(ctx: EmitContext): string {
    return `*${this.expression.__emit(ctx)}`;
  }

  static parse(
    node: SyntaxNode,
    parseExpr: (n: SyntaxNode) => Expression
  ): Parsed<SpreadExpression> {
    const exprNode = node.childForFieldName('expression');
    if (exprNode) {
      return withCst(new SpreadExpression(parseExpr(exprNode)), node);
    }
    const inner = withCst(new ErrorValue(''), node);
    inner.__diagnostics.push(
      createDiagnostic(
        node,
        'Spread operator `*` requires an expression to unpack',
        DiagnosticSeverity.Error,
        'spread-missing-expression'
      )
    );
    return withCst(new SpreadExpression(inner), node);
  }
}

export function createExpression<T extends Expression>(expr: T): AstNode<T> {
  return createNode(expr);
}

export function isMemberExpression(expr: unknown): expr is MemberExpression {
  return expr instanceof MemberExpression;
}

export function isAtIdentifier(expr: unknown): expr is AtIdentifier {
  return expr instanceof AtIdentifier;
}

export interface AtMemberDecomposition {
  namespace: string;
  property: string;
}

/**
 * Decompose a `namespace.property` member expression into its parts.
 * Matches `@namespace.property` (AtIdentifier) unconditionally.
 * Also matches bare `namespace.property` (Identifier) when the name
 * appears in the optional {@link knownNamespaces} set.
 */
export function decomposeMemberExpression(
  expr: unknown,
  knownNamespaces?: ReadonlySet<string>
): AtMemberDecomposition | null {
  if (!isMemberExpression(expr)) return null;
  if (!expr.property) return null;
  if (isAtIdentifier(expr.object)) {
    return { namespace: expr.object.name, property: expr.property };
  }
  if (
    knownNamespaces &&
    expr.object instanceof Identifier &&
    knownNamespaces.has(expr.object.name)
  ) {
    return { namespace: expr.object.name, property: expr.property };
  }
  return null;
}

/**
 * Decompose an `@namespace.property` expression into its parts.
 * Returns null if the expression is not a MemberExpression with an AtIdentifier object.
 */
export function decomposeAtMemberExpression(
  expr: unknown
): AtMemberDecomposition | null {
  return decomposeMemberExpression(expr);
}

/**
 * All expression classes -- single source of truth for kinds and labels.
 * ExpressionKind, EXPRESSION_KINDS, and KIND_LABELS are derived automatically.
 */
const ALL_EXPRESSION_CLASSES = [
  StringLiteral,
  TemplateExpression,
  NumberLiteral,
  BooleanLiteral,
  NoneLiteral,
  Identifier,
  AtIdentifier,
  MemberExpression,
  SubscriptExpression,
  BinaryExpression,
  UnaryExpression,
  ComparisonExpression,
  TernaryExpression,
  CallExpression,
  ListLiteral,
  DictLiteral,
  Ellipsis,
  SpreadExpression,
] as const;

export type ExpressionKind = (typeof ALL_EXPRESSION_CLASSES)[number]['kind'];

export const EXPRESSION_KINDS: ReadonlySet<ExpressionKind> = new Set(
  ALL_EXPRESSION_CLASSES.map(C => C.kind)
);

export const KIND_LABELS: ReadonlyMap<ExpressionKind, string> = new Map(
  ALL_EXPRESSION_CLASSES.map(C => [C.kind, C.kindLabel])
);

const EXPRESSION_KIND_STRINGS: ReadonlySet<string> = EXPRESSION_KINDS;
export function isExpressionKind(kind: string): kind is ExpressionKind {
  return EXPRESSION_KIND_STRINGS.has(kind);
}

type ParseExprFn = (node: SyntaxNode) => Expression;

type ExpressionParser =
  | ((node: SyntaxNode) => Expression)
  | ((node: SyntaxNode, parseExpr: ParseExprFn) => Expression);

/**
 * Expression parser dispatch table.
 * Maps CST node types to their parser functions.
 */
export const expressionParsers = {
  string: (node: SyntaxNode) => StringLiteral.parse(node),
  template: (node: SyntaxNode, parseExpr: ParseExprFn) =>
    TemplateExpression.parse(node, parseExpr),
  number: (node: SyntaxNode) => NumberLiteral.parse(node),
  True: (node: SyntaxNode) => BooleanLiteral.parse(node),
  False: (node: SyntaxNode) => BooleanLiteral.parse(node),
  None: (node: SyntaxNode) => NoneLiteral.parse(node),
  ellipsis: (node: SyntaxNode) => Ellipsis.parse(node),

  id: (node: SyntaxNode) => Identifier.parse(node),
  at_id: (node: SyntaxNode) => AtIdentifier.parse(node),

  member_expression: (node: SyntaxNode, parseExpr: ParseExprFn) =>
    MemberExpression.parse(node, parseExpr),
  subscript_expression: (node: SyntaxNode, parseExpr: ParseExprFn) =>
    SubscriptExpression.parse(node, parseExpr),
  binary_expression: (node: SyntaxNode, parseExpr: ParseExprFn) =>
    BinaryExpression.parse(node, parseExpr),
  unary_expression: (node: SyntaxNode, parseExpr: ParseExprFn) =>
    UnaryExpression.parse(node, parseExpr),
  comparison_expression: (node: SyntaxNode, parseExpr: ParseExprFn) =>
    ComparisonExpression.parse(node, parseExpr),
  ternary_expression: (node: SyntaxNode, parseExpr: ParseExprFn) =>
    TernaryExpression.parse(node, parseExpr),
  call_expression: (node: SyntaxNode, parseExpr: ParseExprFn) =>
    CallExpression.parse(node, parseExpr),
  list: (node: SyntaxNode, parseExpr: ParseExprFn) =>
    ListLiteral.parse(node, parseExpr),
  dictionary: (node: SyntaxNode, parseExpr: ParseExprFn) =>
    DictLiteral.parse(node, parseExpr),
  spread_expression: (node: SyntaxNode, parseExpr: ParseExprFn) =>
    SpreadExpression.parse(node, parseExpr),
} satisfies Record<string, ExpressionParser>;
