/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Indentation-aware lexer for AgentScript.
 *
 * Produces a flat Token[] array including synthetic INDENT, DEDENT, and NEWLINE
 * tokens. Keywords are emitted as ID — the parser checks token text.
 *
 * Indentation: space = 1 unit, tab = 3 units (matching scanner.c).
 */

import invariant from 'tiny-invariant';
import { TokenKind, type Token, type Position } from './token.js';

// ---------------------------------------------------------------------------
// Character classification via charCode (replaces regex hot-path checks)
// ---------------------------------------------------------------------------

const CH_TAB = 9; // \t
const CH_LF = 10; // \n
const CH_CR = 13; // \r
const CH_SPACE = 32;
const CH_BANG = 33; // !
const CH_DQUOTE = 34; // "
const CH_HASH = 35; // #
const CH_DASH = 45; // -
const CH_DOT = 46; // .
const CH_0 = 48;
const CH_9 = 57;
const CH_LT = 60; // <
const CH_EQ = 61; // =
const CH_GT = 62; // >
const CH_A = 65;
const CH_Z = 90;
const CH_BACKSLASH = 92; // \
const CH_UNDERSCORE = 95; // _
const CH_a = 97;
const CH_z = 122;
const CH_LBRACE = 123; // {
const CH_NUL = 0;

function isIdStart(c: number): boolean {
  return (
    (c >= CH_A && c <= CH_Z) || (c >= CH_a && c <= CH_z) || c === CH_UNDERSCORE
  );
}

function isIdCont(c: number): boolean {
  return isIdStart(c) || (c >= CH_0 && c <= CH_9);
}

function isDigit(c: number): boolean {
  return c >= CH_0 && c <= CH_9;
}

function isHorizontalWs(c: number): boolean {
  return c === CH_SPACE || c === CH_TAB;
}

// ---------------------------------------------------------------------------
// charCode-indexed single-char token lookup (replaces Record<string, TokenKind>)
// ---------------------------------------------------------------------------

const SINGLE_CHAR_TOKENS: Array<TokenKind | 0> = new Array(128).fill(
  0
) as Array<TokenKind | 0>;
SINGLE_CHAR_TOKENS[43] = TokenKind.PLUS; // +
SINGLE_CHAR_TOKENS[CH_DASH] = TokenKind.MINUS; // -
SINGLE_CHAR_TOKENS[42] = TokenKind.STAR; // *
SINGLE_CHAR_TOKENS[47] = TokenKind.SLASH; // /
// % is not a valid operator in AgentScript (tree-sitter parity)
SINGLE_CHAR_TOKENS[CH_DOT] = TokenKind.DOT; // .
SINGLE_CHAR_TOKENS[44] = TokenKind.COMMA; // ,
SINGLE_CHAR_TOKENS[58] = TokenKind.COLON; // :
SINGLE_CHAR_TOKENS[61] = TokenKind.EQ; // =
SINGLE_CHAR_TOKENS[60] = TokenKind.LT; // <
SINGLE_CHAR_TOKENS[CH_GT] = TokenKind.GT; // >
SINGLE_CHAR_TOKENS[124] = TokenKind.PIPE; // |
SINGLE_CHAR_TOKENS[64] = TokenKind.AT; // @
SINGLE_CHAR_TOKENS[40] = TokenKind.LPAREN; // (
SINGLE_CHAR_TOKENS[41] = TokenKind.RPAREN; // )
SINGLE_CHAR_TOKENS[91] = TokenKind.LBRACKET; // [
SINGLE_CHAR_TOKENS[93] = TokenKind.RBRACKET; // ]
SINGLE_CHAR_TOKENS[CH_LBRACE] = TokenKind.LBRACE; // {
SINGLE_CHAR_TOKENS[125] = TokenKind.RBRACE; // }

export class Lexer {
  private source: string;
  private offset = 0;
  private row = 0;
  private col = 0;
  private tokens: Token[] = [];
  private indentStack: number[] = [0];
  /** True when the current line started with `|` (template line). */
  private onTemplateLine = false;
  /** Indent level of the line containing `|`. Content deeper than this is template content. */
  private templateBaseIndent = -1;
  /** True when inside a `{!...}` template expression. */
  private inTemplateExpr = false;
  /** Nested brace depth inside a template expression (for `{` inside `{!...}`). */
  private templateExprBraceDepth = 0;

  constructor(source: string) {
    this.source = source;
  }

  tokenize(): Token[] {
    // Pre-allocate token array backing store for large inputs
    this.tokens = [];
    const estimate = (this.source.length / 8) | 0;
    if (estimate > 64) {
      this.tokens.length = estimate;
      this.tokens.length = 0;
    }

    this.offset = 0;
    this.row = 0;
    this.col = 0;
    this.indentStack = [0];

    while (this.hasMore) {
      this.tokenizeLine();
    }

    // Emit remaining DEDENTs
    while (this.indentStack.length > 1) {
      this.indentStack.pop();
      this.emitVirtual(TokenKind.DEDENT);
    }
    this.emitVirtual(TokenKind.EOF);

    return this.tokens;
  }

  private tokenizeLine(): void {
    // Note: onTemplateLine persists across continuation lines and is only
    // reset when indentation decreases (DEDENT) in emitIndentation().
    // Measure leading indentation
    const indentLength = this.consumeIndentation();

    if (this.consumeNewline()) {
      return;
    }

    const c = this.peekCharCode();

    // Comment-only line: tree-sitter's scanner skips past comment-only lines
    // when deciding INDENT/DEDENT. If this comment is at deeper indent than
    // current but no real content follows at that depth, emit NEWLINE instead.
    // Similarly, if a comment is at shallower indent but the next real content
    // is back at the current block's depth, suppress the DEDENT.
    // When on a template line, only treat `#` as a comment if it's at or below
    // the template's base indent (outside the template content area).
    if (
      c === CH_HASH &&
      (!this.onTemplateLine || indentLength <= this.templateBaseIndent)
    ) {
      const currentIndent = this.indentStack[this.indentStack.length - 1]!;
      if (indentLength > currentIndent) {
        const nextContentIndent = this.peekNextContentIndent();
        if (nextContentIndent < indentLength) {
          // No real content at this depth — suppress INDENT
          if (this.tokens.length > 0) {
            this.emitVirtual(TokenKind.NEWLINE);
          }
          return this.tokenizeComment();
        }
      } else if (indentLength < currentIndent) {
        const nextContentIndent = this.peekNextContentIndent();
        if (nextContentIndent > indentLength) {
          // Next real content is at a deeper indent than the comment.
          // Emit indentation based on where the next content is, not
          // where the comment sits, so we only close the blocks that
          // actually end (not the ones the comment just happens to be
          // outside of).
          this.emitIndentation(nextContentIndent);
          return this.tokenizeComment();
        }
      }
      this.emitIndentation(indentLength);
      return this.tokenizeComment();
    }

    // Normal line — emit indentation tokens
    this.emitIndentation(indentLength);

    // Check for "- " sequence element at start of content
    if (c === CH_DASH) {
      const nc = this.peekCharCode(1); // NaN at EOF — won't match any CH_*
      const atEOF = this.offset + 1 >= this.source.length;
      if (nc === CH_SPACE || this.atNewline(1) || atEOF) {
        this.emit(TokenKind.DASH_SPACE, nc === CH_SPACE ? '- ' : '-');
      }
    }

    // Tokenize the rest of the line
    while (this.hasMore) {
      const c = this.peekCharCode();

      // Newline ends the line
      if (this.consumeNewline()) {
        return;
      }

      if (c === CH_CR) {
        // Not followed with line feed (otherwise this.consumeLine() would be true)
        invariant(!this.atNewline());
        this.advance();
        continue;
      }

      // Skip horizontal whitespace
      if (isHorizontalWs(c)) {
        this.advance();
        continue;
      }

      // Line continuation
      if (c === CH_BACKSLASH) {
        if (this.atNewline(1)) {
          this.advance(); // skip backslash
          invariant(this.consumeNewline());
          // Skip leading whitespace on continuation line
          while (isHorizontalWs(this.peekCharCode())) {
            this.advance();
          }
          continue;
        }
      }

      // Comment
      if (c === CH_HASH) {
        return this.tokenizeComment();
      }

      this.tokenizeToken();
    }
  }

  private emitIndentation(indentLength: number): void {
    const currentIndent = this.indentStack[this.indentStack.length - 1]!;

    if (indentLength > currentIndent) {
      this.indentStack.push(indentLength);
      this.emitVirtual(TokenKind.INDENT);
    } else if (indentLength < currentIndent) {
      // Emit DEDENTs and a NEWLINE; leave template context only when
      // indentation drops to or below the template's base indent level.
      if (indentLength <= this.templateBaseIndent) {
        this.onTemplateLine = false;
        this.inTemplateExpr = false;
        this.templateExprBraceDepth = 0;
      }
      while (
        this.indentStack.length > 1 &&
        this.indentStack[this.indentStack.length - 1]! > indentLength
      ) {
        this.indentStack.pop();
        this.emitVirtual(TokenKind.DEDENT);
      }
      this.emitVirtual(TokenKind.NEWLINE);
    } else {
      // Same indent — emit NEWLINE (line separator) unless we're at the start.
      // Leave template context only when at or below the template's base indent.
      if (indentLength <= this.templateBaseIndent) {
        this.onTemplateLine = false;
        this.inTemplateExpr = false;
        this.templateExprBraceDepth = 0;
      }
      if (this.tokens.length > 0) {
        this.emitVirtual(TokenKind.NEWLINE);
      }
    }
  }

  private tokenizeToken(): void {
    const c = this.peekCharCode();

    // Datetimes or numbers
    if (isDigit(c)) {
      // Datetime literal: YYYY-MM-DD...
      // Must check before numbers since datetimes start with digits
      if (this.tryDatetime()) {
        return;
      }
      this.tokenizeNumber();
      return;
    }

    // Identifier
    if (isIdStart(c)) {
      this.tokenizeId();
      return;
    }

    // String (double-quoted always, single-quoted only if not a contraction)
    // Inside template lines (after |), quotes are literal characters — don't
    // start string tokenization unless we're inside a {!...} expression.
    if (!this.onTemplateLine || this.inTemplateExpr) {
      if (c === CH_DQUOTE) {
        this.tokenizeString();
        return;
      }
    }

    // Template expression start {!
    if (c === CH_LBRACE && this.peekCharCode(1) === CH_BANG) {
      this.inTemplateExpr = true;
      this.templateExprBraceDepth = 0;
      this.emit(TokenKind.TEMPLATE_EXPR_START, '{!');
      return;
    }

    // Tokens beginning with .
    if (c === CH_DOT) {
      if (this.peekCharCode(1) === CH_DOT && this.peekCharCode(2) === CH_DOT) {
        this.emit(TokenKind.ELLIPSIS, '...');
        return;
      }
      // Leading-dot number (e.g., .5, .123) — but not after identifiers
      // (which would be member access like @variable.5)
      if (isDigit(this.peekCharCode(1))) {
        const prev = this.tokens[this.tokens.length - 1];
        const isMemberAccess =
          prev !== undefined &&
          (prev.kind === TokenKind.ID ||
            prev.kind === TokenKind.NUMBER ||
            prev.kind === TokenKind.RPAREN ||
            prev.kind === TokenKind.RBRACKET);
        if (!isMemberAccess) {
          this.tokenizeNumber();
          return;
        }
      }
    }

    if (c === CH_DASH) {
      if (this.peekCharCode(1) === CH_GT) {
        return this.emit(TokenKind.ARROW, '->');
      }
    }

    // == != <= >=
    const nc = this.peekCharCode(1);
    if (nc === CH_EQ) {
      // next is '='
      if (c === CH_EQ) {
        return this.emit(TokenKind.EQEQ, '==');
      }
      if (c === CH_BANG) {
        return this.emit(TokenKind.NEQ, '!=');
      }
      if (c === CH_LT) {
        return this.emit(TokenKind.LTE, '<=');
      }
      if (c === CH_GT) {
        return this.emit(TokenKind.GTE, '>=');
      }
    }

    // Single-char tokens (charCode-indexed lookup)
    const kind = c < 128 ? SINGLE_CHAR_TOKENS[c] : 0;
    if (kind) {
      this.emitSpan(kind, 1);
      // Track template lines: `|` starts a template context for this line
      // and continuation lines indented deeper than this level.
      if (kind === TokenKind.PIPE) {
        this.onTemplateLine = true;
        this.templateBaseIndent =
          this.indentStack[this.indentStack.length - 1]!;
      }
      // Track brace depth inside {!...} template expressions so that nested
      // braces (e.g. JSON objects) don't prematurely close the expression.
      if (this.inTemplateExpr) {
        if (kind === TokenKind.LBRACE) {
          this.templateExprBraceDepth++;
        } else if (kind === TokenKind.RBRACE) {
          if (this.templateExprBraceDepth > 0) {
            this.templateExprBraceDepth--;
          } else {
            this.inTemplateExpr = false;
          }
        }
      }
      return;
    }

    // Unknown character — emit error token
    this.emitSpan(TokenKind.ERROR_TOKEN, 1);
  }

  private tokenizeId(): void {
    let i = 0;
    for (; ; i++) {
      const c = this.peekCharCode(i);
      if (!isIdCont(c)) break;
    }
    this.emitSpan(TokenKind.ID, i);
  }

  private tokenizeNumber(): void {
    let tokenLength = 0;

    // Leading dot (e.g., .5) — consume the `.` first
    const leadingDot = this.peekCharCode(tokenLength) === CH_DOT;
    if (leadingDot) {
      tokenLength++;
    }

    // Integer part — inline advance (digits never contain newlines)
    while (isDigit(this.peekCharCode(tokenLength))) {
      tokenLength++;
    }

    // Decimal part — only consume `.` if followed by a digit (and no leading dot)
    if (!leadingDot && this.peekCharCode(tokenLength) === CH_DOT) {
      tokenLength++;
    }

    while (isDigit(this.peekCharCode(tokenLength))) {
      tokenLength++;
    }

    this.emitSpan(TokenKind.NUMBER, tokenLength);
  }

  private tryDatetime(): boolean {
    // ISO 8601: YYYY-MM-DD optionally followed by time
    // Need at least YYYY-MM-DD = 10 chars
    const remaining = this.source.length - this.offset;
    if (remaining < 10) return false;

    // Fast reject: most numbers aren't datetimes. Check the fixed '-' positions
    // before allocating a slice or running the regex.
    if (
      this.source.charCodeAt(this.offset + 4) !== CH_DASH ||
      this.source.charCodeAt(this.offset + 7) !== CH_DASH
    ) {
      return false;
    }

    const slice = this.source.slice(this.offset, this.offset + 30);
    const match = slice.match(
      /^\d{4}-\d{2}-\d{2}(T\d{1,2}(:\d{2})?(:\d{2})?(\.\d+)?Z?)?/
    );
    if (!match) return false;

    // Only treat as datetime if it has the full YYYY-MM-DD pattern
    // and the character after isn't an identifier character
    const matchText = match[0];
    if (matchText.length < 10) return false; // Must have at least YYYY-MM-DD

    this.emit(TokenKind.DATETIME, matchText);
    return true;
  }

  private tokenizeString(): void {
    const start = this.position;
    const startOffset = this.offset;
    const quoteCode = this.peekCharCode(); // " or '

    // Opening quote
    this.advance();

    while (this.hasMore) {
      const c = this.peekCharCode();

      if (c === quoteCode) {
        this.advance(); // closing quote
        const text = this.source.slice(startOffset, this.offset);
        this.tokens.push(
          this.makeToken(
            TokenKind.STRING,
            text,
            start,
            this.position,
            startOffset
          )
        );
        return;
      }

      if (c === CH_BACKSLASH) {
        this.advance(2);
        continue;
      }

      if (this.atNewline()) {
        // Unclosed string — stop at newline for error recovery
        break;
      }
      if (c === CH_CR) {
        // Bare \r inside string — treat as content
        invariant(!this.atNewline());
        this.advance();
        continue;
      }

      if (c === CH_NUL) {
        // Null byte — tree-sitter rejects these in string content
        break;
      }

      this.advance();
    }

    // Unclosed string
    const text = this.source.slice(startOffset, this.offset);
    this.tokens.push(
      this.makeToken(TokenKind.STRING, text, start, this.position, startOffset)
    );
  }

  private tokenizeComment(): void {
    const start = this.position;
    const startOffset = this.offset;
    // Consume # and everything until end of line or EOF
    while (this.hasMore && !this.atNewline()) {
      this.advance();
    }
    const text = this.source.slice(startOffset, this.offset);
    this.tokens.push(
      this.makeToken(TokenKind.COMMENT, text, start, this.position, startOffset)
    );
    this.consumeNewline();
  }

  private consumeIndentation(): number {
    let indentLength = 0;
    while (this.hasMore) {
      const c = this.peekCharCode();
      if (c === CH_SPACE) {
        indentLength += 1;
        this.advance();
      } else if (c === CH_TAB) {
        indentLength += 3;
        this.advance();
      } else {
        break;
      }
    }
    return indentLength;
  }

  /**
   * Scan ahead (without advancing) past comment/blank lines to find the indent
   * of the next line with real (non-comment) content. Returns -1 if only
   * comments, blanks, or EOF remain. Matches tree-sitter scanner behavior which
   * skips past comment-only lines when computing INDENT/DEDENT.
   */
  private peekNextContentIndent(): number {
    const startPosition = this.position;
    const startOffset = this.offset;

    // Skip past the current comment line
    while (this.hasMore) {
      if (this.consumeNewline()) break;
      this.advance();
    }

    // Scan subsequent lines
    while (this.hasMore) {
      // Measure indent
      const lineIndent = this.consumeIndentation();

      // Blank line — skip
      if (this.consumeNewline()) continue;

      // Comment line — skip
      const c = this.peekCharCode();
      if (c === CH_HASH) {
        while (this.hasMore) {
          if (this.consumeNewline()) break;
          this.advance();
        }
        continue;
      }

      this.offset = startOffset;
      this.row = startPosition.row;
      this.col = startPosition.column;

      // Real content — return its indent
      return lineIndent;
    }

    this.offset = startOffset;
    this.row = startPosition.row;
    this.col = startPosition.column;
    return -1;
  }

  // --- Utility methods ---

  private peekCharCode(additiveOffset: number = 0): number {
    return this.source.charCodeAt(this.offset + additiveOffset);
  }

  private get hasMore(): boolean {
    return this.offset < this.source.length && this.offset >= 0;
  }

  /**
   * Attempt to advance n characters.
   * @returns how many characters were advanced.
   */
  private advance(n: number = 1): number {
    n = Math.max(0, Math.min(n, this.source.length - this.offset));

    this.col += n;
    for (let i = 0; i < n; i++) {
      if (this.peekCharCode(i) === CH_LF) {
        this.row++;
        this.col = n - i - 1;
      }
    }
    this.offset += n;
    return n;
  }

  /**
   * Attempt to consume a newline.
   * @returns whether a newline was consumed.
   */
  private consumeNewline(): boolean {
    const newChars = this.atNewline();
    if (newChars > 0) {
      invariant(this.advance(newChars));
      return true;
    }
    return false;
  }

  /**
   * Checks if the current position is at a newline.
   * @param additiveOffset
   * @returns 0 if not at a newline, 1 if at an LF newline, 2 if at a CR LF newline.
   */
  private atNewline(additiveOffset: number = 0): 0 | 1 | 2 {
    const firstChar = this.peekCharCode(additiveOffset);
    if (firstChar === CH_LF) return 1;
    if (firstChar === CH_CR && this.peekCharCode(additiveOffset + 1) === CH_LF)
      return 2;
    return 0;
  }

  private get position(): Position {
    return { row: this.row, column: this.col };
  }

  private emitSpan(kind: TokenKind, length: number): void {
    const text = this.source.slice(this.offset, this.offset + length);
    return this.emit(kind, text);
  }

  private emit(kind: TokenKind, text: string): void {
    const startPosition = this.position;
    const startOffset = this.offset;
    invariant(
      text === this.source.slice(startOffset, startOffset + text.length),
      `expected '${text}' but got ${this.source.slice(startOffset, startOffset + text.length)} at offset ${startOffset}`
    );

    this.advance(text.length);
    this.tokens.push(
      this.makeToken(kind, text, startPosition, this.position, startOffset)
    );
  }

  private emitVirtual(kind: TokenKind): void {
    return this.emit(kind, '');
  }

  private makeToken(
    kind: TokenKind,
    text: string,
    start: Position,
    end: Position,
    startOffset: number
  ): Token {
    return { kind, text, start, end, startOffset };
  }
}
