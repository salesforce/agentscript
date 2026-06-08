import type {
  EmitContext,
  SyntaxNode,
  Parsed,
  AstNode,
  CstMeta,
  Comment,
  CommentAttachment,
} from './types.js';
import { emitIndent, toRange } from './types.js';
import {
  withCst,
  createNode,
  AstNodeBase,
  getKeyText,
  emitKeyName,
  wrapWithComments,
  parseCommentNode,
} from './types.js';
import { CommentAttacher, attach } from './comment-attacher.js';
import type { Expression, TemplatePart } from './expressions.js';
import { Ellipsis, parseTemplateParts } from './expressions.js';
import {
  type Diagnostic,
  createDiagnostic,
  DiagnosticSeverity,
} from './diagnostics.js';

export interface Statement {
  readonly __kind: string;
  __emit(ctx: EmitContext): string;
  __diagnostics: Diagnostic[];
  __cst?: CstMeta;
  __comments?: Comment[];
}

export class Template extends AstNodeBase implements Statement {
  readonly __kind = 'Template';

  /**
   * When true, the `|` was on its own line with content on following lines.
   * Detected from CST: `|` followed by only whitespace/newline before content.
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

  __emit(ctx: EmitContext): string {
    const indent = emitIndent(ctx);
    const rawInner = this.parts.map(p => p.__emit(ctx)).join('');
    // Relies on dedentTemplateParts post-dedent invariant: continuation
    // lines already have only relative indentation from column 0.
    // See dedentTemplateParts() in expressions.ts for details.
    const childIndent = emitIndent({ ...ctx, indent: ctx.indent + 1 });
    const lines = rawInner.split('\n');

    // When `|` was on its own line (bare pipe multi-line), emit `|` then
    // newline then all content lines indented. Otherwise emit `|` + first
    // line on same line.
    if (this.barePipeMultiline && lines.length > 0) {
      const allReindented = lines
        .map(line => {
          if (line.trim().length === 0) return '';
          return childIndent + line;
        })
        .join('\n');
      return `${indent}|\n${allReindented}`;
    }

    // Continuation lines get the pipe-column indent prefix; the line
    // content already carries the correct relative indentation.
    const continuationIndent = indent + (this.spaceAfterPipe ? '  ' : ' ');
    const reindented = lines
      .map((line, i) => {
        if (i === 0) return line; // first line stays after |
        if (line.trim().length === 0) return '';
        return continuationIndent + line;
      })
      .join('\n');
    const sep = this.spaceAfterPipe ? ' ' : '';
    const prefix = reindented.length > 0 ? `${indent}|${sep}` : `${indent}|`;
    return `${prefix}${reindented}`;
  }

  static parse(
    node: SyntaxNode,
    parseExpr: (n: SyntaxNode) => Expression
  ): Parsed<Template> {
    const { parts, diagnostics } = parseTemplateParts(node, parseExpr);
    const stmt = withCst(new Template(parts), node);
    // Detect bare pipe multi-line and space-after-pipe from CST source text
    const nodeText = node.text;
    if (nodeText && parts.length > 0) {
      const afterPipe = nodeText.slice(1); // skip '|'
      const firstNonWs = afterPipe.search(/\S/);
      if (firstNonWs > 0 && afterPipe.slice(0, firstNonWs).includes('\n')) {
        stmt.barePipeMultiline = true;
      }
      // Detect space between `|` and inline content (e.g. `| Hello`)
      if (
        !stmt.barePipeMultiline &&
        afterPipe.length > 0 &&
        afterPipe[0] === ' '
      ) {
        stmt.spaceAfterPipe = true;
      }
    }
    stmt.__diagnostics.push(...diagnostics);
    return stmt;
  }
}

export class WithClause extends AstNodeBase implements Statement {
  readonly __kind = 'WithClause';
  __paramCstNode?: SyntaxNode;

  constructor(
    public param: string,
    public value: Expression
  ) {
    super();
  }

  __emit(ctx: EmitContext): string {
    const indent = emitIndent(ctx);
    // Bare `with param` (no value in CST) — emit without `=`.
    // Only when the WithClause itself was parsed from source (has CST) but the
    // Ellipsis was synthesized (no CST) — meaning the source had no `= ...`.
    // Programmatically constructed nodes (neither has CST) should emit `= ...`.
    if (this.value instanceof Ellipsis && !this.value.__cst && this.__cst) {
      return `${indent}with ${emitKeyName(this.param)}`;
    }
    // Preserve original spacing from CST; default to spaces when no CST.
    const hasSpaces = this.__cst?.node?.text?.includes(' = ') ?? true;
    const eq = hasSpaces ? ' = ' : '=';
    return `${indent}with ${emitKeyName(this.param)}${eq}${this.value.__emit(ctx)}`;
  }

  static parse(
    node: SyntaxNode,
    parseExpr: (n: SyntaxNode) => Expression
  ): Parsed<WithClause> {
    const paramNode = node.childForFieldName('param');
    const valueNode = node.childForFieldName('value');

    const param = paramNode ? getKeyText(paramNode) : '';
    const value = valueNode ? parseExpr(valueNode) : new Ellipsis();

    const clause = withCst(new WithClause(param, value), node);
    if (paramNode) clause.__paramCstNode = paramNode;
    return clause;
  }

  /** Desugar comma-separated `with x=a,y=b` into separate WithClause nodes. */
  static parseAll(
    node: SyntaxNode,
    parseExpr: (n: SyntaxNode) => Expression
  ): Parsed<WithClause>[] {
    const paramNodes = node.childrenForFieldName('param');
    const valueNodes = node.childrenForFieldName('value');

    if (paramNodes.length <= 1) {
      return [WithClause.parse(node, parseExpr)];
    }

    const clauses: Parsed<WithClause>[] = [];
    for (let i = 0; i < paramNodes.length; i++) {
      const paramNode = paramNodes[i];
      const valueNode = valueNodes[i];

      const param = paramNode ? getKeyText(paramNode) : '';
      const value = valueNode ? parseExpr(valueNode) : new Ellipsis();

      const clause = withCst(new WithClause(param, value), node);
      clause.__paramCstNode = paramNode;

      // Override range to cover only this param=value pair, not the entire
      // with_statement. Without this, all desugared clauses share the parent
      // node's range and cursor-sync always highlights the first one.
      if (paramNode && valueNode) {
        clause.__cst.range = {
          start: toRange(paramNode).start,
          end: toRange(valueNode).end,
        };
      }

      clauses.push(clause);
    }
    return clauses;
  }
}

export class SetClause extends AstNodeBase implements Statement {
  readonly __kind = 'SetClause';

  constructor(
    public target: Expression,
    public value: Expression
  ) {
    super();
  }

  __emit(ctx: EmitContext): string {
    const indent = emitIndent(ctx);
    // Preserve original spacing from CST; default to spaces for `set`.
    // Fall back to CST text if target or value is missing (e.g., `set =broken`).
    if (!this.target || !this.value) {
      const cstText = this.__cst?.node?.text?.trim();
      return cstText ? `${indent}${cstText}` : `${indent}set`;
    }
    const hasSpaces = this.__cst?.node?.text?.includes(' = ') ?? true;
    const eq = hasSpaces ? ' = ' : '=';
    return `${indent}set ${this.target.__emit(ctx)}${eq}${this.value.__emit(ctx)}`;
  }

  static parse(
    node: SyntaxNode,
    parseExpr: (n: SyntaxNode) => Expression
  ): Parsed<SetClause> {
    const targetNode = node.childForFieldName('target');
    const valueNode = node.childForFieldName('value');

    const target = targetNode ? parseExpr(targetNode) : null!;
    const value = valueNode ? parseExpr(valueNode) : null!;

    return withCst(new SetClause(target, value), node);
  }
}

export class ToClause extends AstNodeBase implements Statement {
  readonly __kind = 'ToClause';

  constructor(public target: Expression) {
    super();
  }

  __emit(ctx: EmitContext): string {
    const indent = emitIndent(ctx);
    return `${indent}to ${this.target.__emit(ctx)}`;
  }

  static parse(
    node: SyntaxNode,
    parseExpr: (n: SyntaxNode) => Expression
  ): Parsed<ToClause> {
    const targetNode = node.childForFieldName('target');
    const target = targetNode ? parseExpr(targetNode) : null!;
    return withCst(new ToClause(target), node);
  }
}

export class AvailableWhen extends AstNodeBase implements Statement {
  readonly __kind = 'AvailableWhen';

  constructor(public condition: Expression) {
    super();
  }

  __emit(ctx: EmitContext): string {
    const indent = emitIndent(ctx);
    // Fall back to CST text when condition is null (broken parse)
    const condText = this.condition
      ? this.condition.__emit(ctx)
      : (this.__cst?.node?.childForFieldName('condition')?.text ?? '');
    return `${indent}available when ${condText}`;
  }

  static parse(
    node: SyntaxNode,
    parseExpr: (n: SyntaxNode) => Expression
  ): Parsed<AvailableWhen> {
    const conditionNode = node.childForFieldName('condition');
    const condition = conditionNode ? parseExpr(conditionNode) : null!;
    return withCst(new AvailableWhen(condition), node);
  }
}

export class RunStatement extends AstNodeBase implements Statement {
  readonly __kind = 'RunStatement';

  constructor(
    public target: Expression,
    public body: Statement[]
  ) {
    super();
  }

  __emit(ctx: EmitContext): string {
    const indent = emitIndent(ctx);
    const targetText = this.target
      ? this.target.__emit(ctx)
      : (this.__cst?.node?.childForFieldName('target')?.text ?? '');

    // When target is empty/whitespace (broken parse), fall back to full
    // CST text to preserve original content like `run !!!invalid`.
    if (!targetText.trim() && this.__cst?.node) {
      const cstText = this.__cst.node.text?.trim();
      if (cstText) {
        const lines = cstText.split('\n');
        return lines.map(line => `${indent}${line.trim()}`).join('\n');
      }
    }

    let out = `${indent}run ${targetText}`;

    if (this.body.length > 0) {
      out += '\n';
      const bodyCtx = { ...ctx, indent: ctx.indent + 1 };
      out += this.body
        .map(s => wrapWithComments(s.__emit(bodyCtx), s, bodyCtx))
        .join('\n');
    }

    return out;
  }

  static parse(
    node: SyntaxNode,
    parseExpr: (n: SyntaxNode) => Expression,
    parseStmt: (n: SyntaxNode) => Statement | Statement[] | null
  ): Parsed<RunStatement> {
    let targetNode = node.childForFieldName('target');
    const bodyNode = node.childForFieldName('block_value');
    const diagnostics: Diagnostic[] = [];

    // When parser wraps the target + `with` in an ERROR node
    // (e.g. `run @actions.foo \n with ...`), the real target is inside
    // the ERROR and the `...` becomes the grammar's `target` field.
    // Recover the real target and diagnose the invalid syntax.
    for (const child of node.children) {
      if (child.type !== 'ERROR') continue;

      const hasWith = child.children.some(c => c.type === 'with');
      if (!hasWith) continue;

      // Extract the real target from ERROR
      for (const errChild of child.namedChildren) {
        if (
          errChild.type === 'expression' ||
          errChild.type === 'member_expression' ||
          errChild.type === 'atom'
        ) {
          targetNode = errChild;
          break;
        }
      }

      // The target field now holds the invalid `with` argument (e.g. `...`).
      // Find the `with` keyword and the bare expression after the ERROR
      // to produce a tightly-scoped diagnostic.
      const withNode = child.children.find(c => c.type === 'with');
      const errorIdx = node.children.indexOf(child);
      for (let i = errorIdx + 1; i < node.children.length; i++) {
        const sibling = node.children[i];
        if (sibling.type === 'expression') {
          const rangeStart = withNode
            ? toRange(withNode).start
            : toRange(child).start;
          diagnostics.push(
            createDiagnostic(
              { start: rangeStart, end: toRange(sibling).end },
              `Invalid \`with\` clause: \`with ${sibling.text}\`. ` +
                '`with` requires named arguments (e.g., `with name=@variables.name`).',
              DiagnosticSeverity.Error,
              'syntax-error'
            )
          );
          break;
        }
      }
      break;
    }

    const target = targetNode ? parseExpr(targetNode) : null!;
    const body: Statement[] = [];
    const attacher = new CommentAttacher();
    const outerComments = node.children
      .filter(child => child.type === 'comment')
      .map(c => parseCommentNode(c, 'leading'));

    if (bodyNode) {
      const preBodyComments = outerComments.filter(comment => {
        const line = comment.range?.start.line;
        return line !== undefined && line < bodyNode.startRow;
      });
      for (const c of preBodyComments) {
        attacher.pushLeading(c);
      }

      for (const child of bodyNode.children) {
        if (child.type === 'comment') {
          if (!attacher.tryAttachInline(child, body[body.length - 1])) {
            attacher.pushLeadingNode(child);
          }
          continue;
        }
        const result = parseStmt(child);
        if (!result) continue;
        if (Array.isArray(result)) {
          const normalized = result.filter(
            (stmt): stmt is Statement => stmt !== null
          );
          if (normalized.length === 0) continue;
          attacher.consumeOntoFirst(normalized);
          body.push(...normalized);
        } else {
          attacher.consumeOnto(result);
          body.push(result);
        }
      }

      const postBodyComments = outerComments
        .filter(comment => {
          const line = comment.range?.start.line;
          return line !== undefined && line > bodyNode.endRow;
        })
        .map(c => ({ ...c, attachment: 'trailing' as CommentAttachment }));
      if (postBodyComments.length > 0 && body.length > 0) {
        attach(body[body.length - 1], postBodyComments);
      }
    }

    // Preserve ERROR children of the run_statement as UnknownStatements
    // (e.g., "with =broken", "set =broken" that parser couldn't parse).
    // Merge adjacent ERROR nodes on the same line into a single statement.
    let pendingErrorText = '';
    let pendingErrorNode: SyntaxNode | null = null;
    for (const child of node.children) {
      if (child.isError) {
        const text = child.text?.trim();
        if (text) {
          if (
            pendingErrorNode &&
            child.startRow === pendingErrorNode.startRow
          ) {
            pendingErrorText += ' ' + text;
          } else {
            if (pendingErrorText && pendingErrorNode) {
              body.push(
                withCst(
                  new UnknownStatement(pendingErrorText),
                  pendingErrorNode
                )
              );
            }
            pendingErrorText = text;
            pendingErrorNode = child;
          }
        }
      } else if (pendingErrorText && pendingErrorNode) {
        body.push(
          withCst(new UnknownStatement(pendingErrorText), pendingErrorNode)
        );
        pendingErrorText = '';
        pendingErrorNode = null;
      }
    }
    if (pendingErrorText && pendingErrorNode) {
      body.push(
        withCst(new UnknownStatement(pendingErrorText), pendingErrorNode)
      );
    }

    attacher.flush();

    const parsed = withCst(new RunStatement(target, body), node);
    if (diagnostics.length > 0) {
      parsed.__diagnostics.push(...diagnostics);
    }
    return parsed;
  }
}

// Python-style if/elif/else: elif is a nested IfStatement in orelse
export class IfStatement extends AstNodeBase implements Statement {
  readonly __kind = 'IfStatement';

  constructor(
    public condition: Expression,
    public body: Statement[],
    public orelse: Statement[] = []
  ) {
    super();
  }

  __emit(ctx: EmitContext): string {
    return this.__emitConditional(ctx, 'if');
  }

  private __emitConditional(ctx: EmitContext, keyword: 'if' | 'elif'): string {
    const indent = emitIndent(ctx);

    // When the body and orelse are both empty (broken condition caused
    // parser to lose the body), fall back to CST text.
    if (
      this.body.length === 0 &&
      this.orelse.length === 0 &&
      this.__cst?.node
    ) {
      const cstText = this.__cst.node.text?.trim();
      if (cstText) {
        const lines = cstText.split('\n');
        return lines.map(line => `${indent}${line.trim()}`).join('\n');
      }
    }

    // Fall back to CST text when condition is null (broken condition parse)
    let condText = this.condition
      ? this.condition.__emit(ctx)
      : (this.__cst?.node?.childForFieldName('condition')?.text ?? '');

    // When condition is null/empty or the CST first line has extra tokens
    // beyond what the AST captured (e.g., `if abc == 1 xxx:` where the
    // expression parser only captured `abc == 1`), reconstruct from the
    // CST node's first line which contains the full `if <cond>:` text.
    if (this.__cst?.node) {
      const firstLine = this.__cst.node.text?.split('\n')[0]?.trim() ?? '';
      const match = firstLine.match(/^(?:if|elif)\s+(.*?):\s*$/);
      if (match && match[1].length > condText.trim().length) {
        condText = match[1];
      }
    }

    let out = `${indent}${keyword} ${condText}:\n`;

    const bodyCtx = { ...ctx, indent: ctx.indent + 1 };
    out += this.body
      .map(s => wrapWithComments(s.__emit(bodyCtx), s, bodyCtx))
      .join('\n');

    if (this.orelse.length > 0) {
      if (this.orelse.length === 1 && this.orelse[0] instanceof IfStatement) {
        out += '\n' + this.orelse[0].__emitConditional(ctx, 'elif');
      } else {
        out += '\n' + `${indent}else:\n`;
        out += this.orelse
          .map(s => wrapWithComments(s.__emit(bodyCtx), s, bodyCtx))
          .join('\n');
      }
    }

    return out;
  }

  static parse(
    node: SyntaxNode,
    parseExpr: (n: SyntaxNode) => Expression,
    parseProcedure: (n: SyntaxNode) => Statement[]
  ): Parsed<IfStatement> {
    const conditionNode = node.childForFieldName('condition');
    const consequenceNode = node.childForFieldName('consequence');

    const condition = conditionNode ? parseExpr(conditionNode) : null!;
    const body = consequenceNode ? parseProcedure(consequenceNode) : [];

    const alternatives = node.childrenForFieldName('alternative');

    // Build orelse from back to front
    let orelse: Statement[] = [];

    for (let i = alternatives.length - 1; i >= 0; i--) {
      const alt = alternatives[i];
      if (alt.type === 'else_clause') {
        const elseConsequence = alt.childForFieldName('consequence');
        orelse = elseConsequence ? parseProcedure(elseConsequence) : [];
      } else if (alt.type === 'elif_clause') {
        const elifCondition = parseExpr(alt.childForFieldName('condition')!);
        const elifConsequence = alt.childForFieldName('consequence');
        const elifBody = elifConsequence ? parseProcedure(elifConsequence) : [];
        orelse = [
          withCst(new IfStatement(elifCondition, elifBody, orelse), alt),
        ];
      }
    }

    return withCst(new IfStatement(condition, body, orelse), node);
  }
}

export function createStatement<T extends Statement>(stmt: T): AstNode<T> {
  return createNode(stmt);
}

type ParseExprFn = (node: SyntaxNode) => Expression;
type ParseProcedureFn = (node: SyntaxNode) => Statement[];
type ParseStmtFn = (node: SyntaxNode) => Statement | Statement[] | null;

/** All parsers receive the same arguments; each uses only what it needs. */
type StatementParser = (
  node: SyntaxNode,
  parseExpr: ParseExprFn,
  parseProcedure: ParseProcedureFn,
  parseStmt: ParseStmtFn
) => Statement | Statement[];

export class TransitionStatement extends AstNodeBase implements Statement {
  readonly __kind = 'TransitionStatement';

  constructor(public clauses: Statement[]) {
    super();
  }

  __emit(ctx: EmitContext): string {
    const indent = emitIndent(ctx);
    const parts = this.clauses.map(c => c.__emit({ ...ctx, indent: 0 }));
    return `${indent}transition ${parts.join(', ')}`;
  }

  static parse(
    node: SyntaxNode,
    parseExpr: (n: SyntaxNode) => Expression
  ): Parsed<TransitionStatement> {
    const clauses: Statement[] = [];
    const listNode = node.childForFieldName('with_to_statement_list');
    if (listNode) {
      for (const child of listNode.namedChildren) {
        if (child.type === 'to_statement') {
          clauses.push(ToClause.parse(child, parseExpr));
        } else if (child.type === 'with_statement') {
          const parsed = WithClause.parseAll(child, parseExpr);
          if (Array.isArray(parsed)) clauses.push(...parsed);
          else clauses.push(parsed);
        }
      }
    }
    return withCst(new TransitionStatement(clauses), node);
  }
}

/**
 * Represents an unrecognized CST node found in a statement context.
 * Preserves the original text so round-trip emit doesn't silently lose content,
 * and carries a diagnostic so the user is informed of the problem.
 */
export class UnknownStatement extends AstNodeBase implements Statement {
  readonly __kind = 'UnknownStatement';

  constructor(public text: string) {
    super();
  }

  __emit(ctx: EmitContext): string {
    const indent = emitIndent(ctx);
    const lines = this.text.split('\n');
    return lines.map(line => `${indent}${line}`).join('\n');
  }
}

/** Statement parser dispatch table. Maps CST node types to parser functions. */
export const statementParsers: Record<string, StatementParser> = {
  template: (node, parseExpr) => Template.parse(node, parseExpr),

  with_statement: (node, parseExpr) => WithClause.parseAll(node, parseExpr),
  set_statement: (node, parseExpr) => SetClause.parse(node, parseExpr),
  to_statement: (node, parseExpr) => ToClause.parse(node, parseExpr),
  available_when_statement: (node, parseExpr) =>
    AvailableWhen.parse(node, parseExpr),
  transition_statement: (node, parseExpr) =>
    TransitionStatement.parse(node, parseExpr),

  run_statement: (node, parseExpr, _parseProcedure, parseStmt) =>
    RunStatement.parse(node, parseExpr, parseStmt),
  if_statement: (node, parseExpr, parseProcedure) =>
    IfStatement.parse(node, parseExpr, parseProcedure),
};
