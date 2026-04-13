/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Recursive descent parser for AgentScript.
 *
 * Core invariant: NEWLINE and DEDENT are unconditional synchronization points.
 * Every parse function that encounters an unexpected token calls synchronize()
 * which skips to the next NEWLINE/DEDENT/EOF.
 */

import { TokenKind, type Token } from './token.js';
import { Lexer } from './lexer.js';
import { CSTNode } from './cst-node.js';
import { makeErrorNode, isSyncPoint } from './errors.js';
import {
  parseExpression,
  wrapExpression,
  isKeyStart,
  isKeyTokenStart,
  isKeyTokenContinuation,
  parseKey,
  parseString,
  ATOM_TYPES,
} from './expressions.js';

/**
 * Maximum tokens to scan ahead when distinguishing a mapping key from an
 * expression. Keys are typically 1-3 words; 10 handles any realistic case
 * with margin. The loop terminates early on COLON, NEWLINE, or non-key tokens,
 * so this limit is a safety cap, not a performance concern.
 */
const MAX_KEY_LOOKAHEAD = 10;

/**
 * Token consumption — peek, advance, and query the token stream.
 */
export interface TokenStream {
  source: string;
  peek(): Token;
  peekAt(offset: number): Token;
  consume(): Token;
  currentOffset(): number;
  /** Get the source offset of the token at the current position (before consuming). */
  peekOffset(): number;
  isAtSyncPoint(): boolean;
}

/**
 * CST node construction — create, populate, and finalize nodes.
 */
export interface NodeBuilder {
  consumeNamed(type: string): CSTNode;
  startNode(type: string): CSTNode;
  startNodeAt(type: string, existingChild: CSTNode): CSTNode;
  finishNode(node: CSTNode, startTok: Token): void;
  addAnonymousChild(parent: CSTNode, token: Token): void;
}

/**
 * Combined interface used by expression parser to access parser state.
 * Avoids circular dependency between parser.ts and expressions.ts.
 */
export interface ParserContext extends TokenStream, NodeBuilder {}

export class Parser implements ParserContext {
  source: string;
  private tokens: Token[];
  private pos = 0;
  private _eof: Token | undefined;

  constructor(source: string) {
    this.source = source;
    const lexer = new Lexer(source);
    this.tokens = lexer.tokenize();
  }

  parse(): CSTNode {
    const root = this.parseSourceFile();
    return root;
  }

  // --- ParserContext implementation ---

  peek(): Token {
    return this.tokens[this.pos] ?? this.eofToken();
  }

  peekAt(offset: number): Token {
    return this.tokens[this.pos + offset] ?? this.eofToken();
  }

  consume(): Token {
    const tok = this.tokens[this.pos] ?? this.eofToken();
    if (this.pos < this.tokens.length) this.pos++;
    return tok;
  }

  consumeNamed(type: string): CSTNode {
    const tok = this.consume();
    const offset = tok.startOffset;
    return new CSTNode(
      type,
      this.source,
      offset,
      offset + tok.text.length,
      tok.start,
      tok.end
    );
  }

  currentOffset(): number {
    const idx = this.pos > 0 ? this.pos - 1 : 0;
    return (this.tokens[idx] ?? this.eofToken()).startOffset;
  }

  peekOffset(): number {
    return this.peek().startOffset;
  }

  isAtSyncPoint(): boolean {
    return isSyncPoint(this.peek().kind);
  }

  startNode(type: string): CSTNode {
    const tok = this.peek();
    const offset = tok.startOffset;
    return new CSTNode(type, this.source, offset, offset, tok.start, tok.end);
  }

  startNodeAt(type: string, existingChild: CSTNode): CSTNode {
    return new CSTNode(
      type,
      this.source,
      existingChild.startOffset,
      existingChild.endOffset,
      existingChild.startPosition,
      existingChild.endPosition
    );
  }

  finishNode(_node: CSTNode, _startTok: Token): void {
    // No-op: appendChild() tracks end position incrementally.
  }

  addAnonymousChild(parent: CSTNode, token: Token): void {
    const offset = token.startOffset;
    const child = new CSTNode(
      token.text,
      this.source,
      offset,
      offset + token.text.length,
      token.start,
      token.end,
      false
    );
    parent.appendChild(child);
  }

  // --- Top-level parsing ---

  private parseSourceFile(): CSTNode {
    const startTok = this.peek();
    const node = this.startNode('source_file');

    // Skip leading newlines and indentation (handles template literals with leading whitespace)
    this.skipNewlines();
    let outerIndent = false;
    if (this.peek().kind === TokenKind.INDENT) {
      this.consume();
      outerIndent = true;
    }

    if (this.peek().kind !== TokenKind.EOF) {
      // Consume leading comments at source_file level (tree-sitter treats them as extras)
      while (this.peek().kind === TokenKind.COMMENT) {
        node.appendChild(this.consumeNamed('comment'));
        if (this.peek().kind === TokenKind.NEWLINE) this.consume();
      }
      this.skipNewlines();

      // Determine what kind of source file this is
      if (this.peek().kind === TokenKind.DASH_SPACE) {
        // Sequence
        const seq = this.parseSequence();
        if (seq) node.appendChild(seq);
      } else if (!this.isAtEnd()) {
        // Try mapping first — look ahead for key: pattern
        const content = this.parseMappingOrExpression();
        if (content) node.appendChild(content);
      }

      // Consume trailing comments at source_file level
      this.skipNewlines();
      while (this.peek().kind === TokenKind.COMMENT) {
        node.appendChild(this.consumeNamed('comment'));
        if (this.peek().kind === TokenKind.NEWLINE) this.consume();
        this.skipNewlines();
      }

      // Catch-all: if there are unconsumed tokens, wrap them in ERROR nodes.
      // This ensures every byte of source is represented in the CST.
      while (!this.isAtEnd()) {
        if (
          this.peek().kind === TokenKind.NEWLINE ||
          this.peek().kind === TokenKind.DEDENT
        ) {
          this.consume();
          continue;
        }
        if (this.peek().kind === TokenKind.COMMENT) {
          node.appendChild(this.consumeNamed('comment'));
          continue;
        }
        const err = this.synchronize();
        if (err) {
          node.appendChild(err);
        } else {
          // Consume one token to guarantee progress
          this.consume();
        }
      }
    } else if (outerIndent && this.peek().kind === TokenKind.DEDENT) {
      this.consume();
    }

    this.finishNode(node, startTok);

    // Root node must span entire source (matches tree-sitter invariant)
    node.startOffset = 0;
    node.startPosition = { row: 0, column: 0 };
    node.endOffset = this.source.length;
    node.endPosition = this.eofToken().end;

    return node;
  }

  private parseMappingOrExpression(): CSTNode | null {
    // Look ahead: if we see ID/STRING followed by COLON, it's a mapping
    if (this.isMappingStart()) {
      return this.parseMapping();
    }

    // Otherwise, try expression (or assignment_expression)
    const expr = parseExpression(this, 0);
    if (!expr) return null;

    // Check for assignment: expr = expr
    if (this.peek().kind === TokenKind.EQ) {
      const node = this.startNodeAt('assignment_expression', expr);
      node.appendChild(wrapExpression(this, expr), 'left');
      this.addAnonymousChild(node, this.consume()); // =
      const right = parseExpression(this, 0);
      if (right) node.appendChild(wrapExpression(this, right), 'right');
      node.finalize();
      return node;
    }

    return wrapExpression(this, expr);
  }

  /**
   * Lookahead to determine if the current position starts a mapping (key-value
   * pairs) rather than an expression.
   *
   * Keys are at most a few tokens (1-3 words, possibly with hyphens/dots), so
   * we only need a small lookahead window. The limit exists as a safety cap —
   * it should never be reached on valid input.
   */
  private isMappingStart(): boolean {
    const tok = this.peek();

    // Comment at start can begin a mapping (comments are valid mapping items)
    if (tok.kind === TokenKind.COMMENT) return true;

    // Template pipe at start can begin a mapping item (template as statement)
    if (tok.kind === TokenKind.PIPE) return true;

    // Statement keywords (not followed by colon) start mappings
    if (tok.kind === TokenKind.ID && this.isStatementStart()) return true;

    // First token must be able to start a key; bail early otherwise.
    if (!isKeyTokenStart(tok.kind)) return false;

    // Scan forward on the same line past key-like tokens (ID, STRING, NUMBER,
    // MINUS, DOT) looking for COLON (normal case), INDENT/ARROW (missing-colon
    // recovery), or AT (missing-colon with @-expression value).
    const startRow = tok.start.row;
    for (let i = 1; i < MAX_KEY_LOOKAHEAD; i++) {
      const t = this.peekAt(i);
      if (
        t.kind === TokenKind.COLON ||
        t.kind === TokenKind.INDENT ||
        t.kind === TokenKind.ARROW ||
        t.kind === TokenKind.AT
      )
        return true;
      if (t.kind === TokenKind.EOF || t.start.row !== startRow) return false;
      if (!isKeyTokenContinuation(t.kind)) return false;
    }
    return false;
  }

  // --- Mapping ---

  parseMapping(): CSTNode {
    const startTok = this.peek();
    const node = this.startNode('mapping');

    while (!this.isAtEnd()) {
      this.skipNewlines();
      const tok = this.peek();
      if (tok.kind === TokenKind.DEDENT || tok.kind === TokenKind.EOF) break;

      // Don't consume trailing comments that belong to the parent scope.
      if (tok.kind === TokenKind.COMMENT && this.isTrailingCommentOnly()) {
        break;
      }

      const item = this.parseMappingItem();
      if (item) {
        node.appendChild(item);
      } else {
        // Can't parse — synchronize (skip to next line)
        const err = this.synchronize();
        if (err) {
          node.appendChild(err);
        } else if (!this.isAtEnd() && this.peek().kind !== TokenKind.DEDENT) {
          // Consume at least one token to avoid infinite loop
          this.consume();
        }
      }
    }

    this.finishNode(node, startTok);
    return node;
  }

  private parseMappingItem(): CSTNode | null {
    const tok = this.peek();

    // Statement keywords always take the statement path (tree-sitter parity).
    // Keywords cannot be used as mapping keys.
    if (tok.kind === TokenKind.ID) {
      switch (tok.text) {
        case 'if':
          return this.parseIfStatement();
        case 'run':
          return this.parseRunStatement();
        case 'set':
          return this.parseSetStatement();
        case 'transition':
          return this.parseTransitionStatement();
        case 'with': {
          if (this.peekAt(1).kind !== TokenKind.COLON) {
            return this.parseWithStatement();
          }
          break;
        }
        case 'available': {
          if (
            this.peekAt(1).kind === TokenKind.ID &&
            this.peekAt(1).text === 'when'
          ) {
            return this.parseAvailableWhenStatement();
          }
          break;
        }
      }
    }

    // Template
    if (tok.kind === TokenKind.PIPE) {
      return this.parseTemplate();
    }

    // Comment
    if (tok.kind === TokenKind.COMMENT) {
      return this.consumeNamed('comment');
    }

    // Standalone else/elif/for — wrap in ERROR with parsed body
    if (
      tok.kind === TokenKind.ID &&
      (tok.text === 'else' || tok.text === 'elif' || tok.text === 'for')
    ) {
      return this.parseOrphanBlock();
    }

    // Mapping element (key: value)
    if (isKeyStart(this)) {
      return this.parseMappingElement();
    }

    return null;
  }

  private parseMappingElement(): CSTNode {
    const startTok = this.peek();
    const node = this.startNode('mapping_element');

    // Key
    const key = parseKey(this);
    if (key) node.appendChild(key, 'key');

    // Colon (or recovery if missing)
    if (this.peek().kind === TokenKind.COLON) {
      this.addAnonymousChild(node, this.consume()); // :

      // Check for comment right after colon
      if (this.peek().kind === TokenKind.COMMENT) {
        node.appendChild(this.consumeNamed('comment'));
      }

      // Check for arrow -> (procedure)
      if (this.peek().kind === TokenKind.ARROW) {
        this.parseArrowBody(node);
      } else {
        // Optional colinear value
        const colinear = this.tryParseColinearValue();
        if (colinear) {
          if (colinear.errorPrefix) {
            node.appendChild(colinear.errorPrefix);
          }
          node.appendChild(colinear.value, 'colinear_value');
        }

        // Inline comment (on same line as value)
        if (this.peek().kind === TokenKind.COMMENT) {
          node.appendChild(this.consumeNamed('comment'));
        }

        // Extra tokens after colinear → wrap in ERROR inside mapping_element.
        // When a colinear value was parsed, absorb remaining same-ROW tokens
        // (including IDs like a broken `tz` that was meant to be `to`). This
        // prevents fragments from leaking into the parent mapping and shifting
        // each parse→emit cycle. The row check is critical: unclosed brackets
        // suppress NEWLINE, so cross-line tokens would still be at the same
        // logical position — but they belong to separate mapping elements.
        // Without a colinear, exempt IDs/STRINGs for same-row split recovery
        // (e.g., `linkedd string` → two mapping_elements merged by dialect).
        if (colinear) {
          const err = this.synchronizeRow(startTok.start.row);
          if (err) node.appendChild(err);
        } else if (
          !this.isAtSyncPoint() &&
          this.peek().kind !== TokenKind.INDENT &&
          this.peek().kind !== TokenKind.COMMENT &&
          this.peek().kind !== TokenKind.ID &&
          this.peek().kind !== TokenKind.STRING
        ) {
          const err = this.synchronize();
          if (err) node.appendChild(err);
        }

        // Continuation: expression_with_to on colinear value followed by
        // indented `to` clause (e.g., `go: @utils.transition\n    to @topic.next`).
        // Absorb the indented `to` into the expression_with_to rather than
        // treating it as a separate block_value.
        // NOTE: we only absorb `to`, not `with` — an indented `with` is typically
        // a with_statement in a block_value mapping, not a with clause on the expression.
        if (
          colinear &&
          colinear.value.type === 'expression_with_to' &&
          !colinear.value.childForFieldName('with_to_statement_list') &&
          this.peek().kind === TokenKind.INDENT &&
          this.peekAt(1).kind === TokenKind.ID &&
          this.peekAt(1).text === 'to'
        ) {
          this.consume(); // INDENT
          const withToList = this.tryParseWithToStatementList();
          if (withToList) {
            colinear.value.appendChild(withToList, 'with_to_statement_list');
            // Propagate end position: appendChild updated expression_with_to
            // but the mapping_element (its grandparent) was already finalized
            // when the colinear was appended. Update it so the element text
            // (used for verbatim emission) includes the continuation clause.
            node.endOffset = colinear.value.endOffset;
            node.endPosition = colinear.value.endPosition;
          }
          if (this.peek().kind === TokenKind.DEDENT) this.consume();
        } else if (this.peek().kind === TokenKind.INDENT) {
          // Optional indented block value
          this.consume(); // INDENT
          // Absorb leading comments into the mapping_element (before block_value)
          this.consumeLeadingComments(node);
          const blockValue = this.parseBlockValue();
          if (blockValue) node.appendChild(blockValue, 'block_value');
          // Absorb trailing comments into the mapping_element (after block_value)
          this.consumeTrailingComments(node);
          // Recovery: consume leftover tokens before DEDENT as ERROR
          // (e.g., unquoted multi-word text like "Hi, I'm an assistant")
          this.recoverToBlockEnd(node);
          if (this.peek().kind === TokenKind.DEDENT) this.consume();
        }
      }
    } else if (this.peek().kind === TokenKind.INDENT) {
      // Recovery: missing colon before indented block → insert MISSING ":"
      node.appendChild(this.makeMissing(':'));
      this.consume(); // INDENT
      this.consumeLeadingComments(node);
      const blockValue = this.parseBlockValue();
      if (blockValue) node.appendChild(blockValue, 'block_value');
      this.recoverToBlockEnd(node);
      if (this.peek().kind === TokenKind.DEDENT) this.consume();
    } else if (this.peek().kind === TokenKind.ARROW) {
      // Recovery: missing colon before arrow → insert MISSING ":"
      // e.g., `instructions ->` instead of `instructions: ->`
      node.appendChild(this.makeMissing(':'));
      this.parseArrowBody(node);
    } else if (
      key &&
      (this.peek().kind === TokenKind.ID ||
        this.peek().kind === TokenKind.AT) &&
      this.peek().start.row === startTok.start.row
    ) {
      // Recovery: missing colon with colinear value tokens before block.
      // e.g., `authenticationKey mutable string\n    description: "..."`
      //        `ActionName @actions.ActionName\n    with param=...`
      // The key consumed only part of the line; remaining tokens are the value.
      node.appendChild(this.makeMissing(':'));
      const colinear = this.tryParseColinearValue();
      if (colinear) {
        if (colinear.errorPrefix) {
          node.appendChild(colinear.errorPrefix);
        }
        node.appendChild(colinear.value, 'colinear_value');
      }

      // Inline comment (on same line as value)
      if (this.peek().kind === TokenKind.COMMENT) {
        node.appendChild(this.consumeNamed('comment'));
      }

      // Extra same-row tokens after missing-colon colinear → wrap in ERROR
      if (colinear) {
        const err = this.synchronizeRow(startTok.start.row);
        if (err) node.appendChild(err);
      }

      if (this.peek().kind === TokenKind.INDENT) {
        // Optional indented block value
        this.consume(); // INDENT
        this.consumeLeadingComments(node);
        const blockValue = this.parseBlockValue();
        if (blockValue) node.appendChild(blockValue, 'block_value');
        this.consumeTrailingComments(node);
        this.recoverToBlockEnd(node);
        if (this.peek().kind === TokenKind.DEDENT) this.consume();
      }
    }

    // Consume trailing NEWLINE
    if (this.peek().kind === TokenKind.NEWLINE) {
      this.consume();
    }

    this.finishNode(node, startTok);
    return node;
  }

  /** Consume `->` and its indented procedure body (shared by normal and missing-colon paths). */
  private parseArrowBody(node: CSTNode): void {
    this.addAnonymousChild(node, this.consume()); // ->
    // Inline comment after -> (e.g., `instructions: -> # comment`)
    if (this.peek().kind === TokenKind.COMMENT) {
      node.appendChild(this.consumeNamed('comment'));
    }
    if (this.peek().kind === TokenKind.INDENT) {
      this.consume(); // INDENT
      // Comments between -> and procedure body attach to mapping_element
      this.consumeLeadingComments(node);
      const proc = this.parseProcedure();
      if (proc) node.appendChild(proc, 'block_value');
      // Trailing comments after procedure attach to mapping_element
      this.consumeTrailingComments(node);
      if (this.peek().kind === TokenKind.DEDENT) this.consume();
    } else {
      // Arrow with no indented body → empty procedure with ERROR
      const emptyProc = this.startNode('procedure');
      emptyProc.appendChild(this.makeEmptyError());
      this.finishNode(emptyProc, this.peek());
      node.appendChild(emptyProc, 'block_value');
    }
  }

  private tryParseColinearValue(): {
    value: CSTNode;
    errorPrefix?: CSTNode;
  } | null {
    const tok = this.peek();

    // Template
    if (tok.kind === TokenKind.PIPE) {
      return { value: this.parseTemplateAsColinear() };
    }

    // Variable declaration: mutable/linked
    if (
      tok.kind === TokenKind.ID &&
      (tok.text === 'mutable' || tok.text === 'linked')
    ) {
      return { value: this.parseVariableDeclaration() };
    }

    // expression_with_to: expression followed by optional with/to clauses
    const expr = parseExpression(this, 0);
    if (!expr) return null;

    // Check for error prefix: if the expression is a number or digit-starting ID
    // (like "123" or "123bad") AND the next token is an ID on the same line,
    // the first is an error prefix and the second is the real value.
    // Wrap the first in ERROR and re-parse the rest.
    if (
      (expr.type === 'number' ||
        (expr.type === 'id' && /^[0-9]/.test(expr.text))) &&
      this.peek().kind === TokenKind.ID &&
      this.peek().start.row === expr.startRow
    ) {
      // Wrap number/digit-starting ID in ERROR
      const errNode = makeErrorNode(
        this.source,
        [wrapExpression(this, expr)],
        expr.startOffset,
        expr.endOffset,
        expr.startPosition,
        expr.endPosition
      );

      // Now re-parse the real colinear value (could be variable_declaration or expression)
      const realValue = this.tryParseColinearValue();

      // If we got a real value, return it with the error prefix for the caller to handle.
      if (realValue) {
        return { value: realValue.value, errorPrefix: errNode };
      }

      // No real value — just return the expression as-is
    }

    // Check for with/to statement list
    const withToList = this.tryParseWithToStatementList();
    if (withToList) {
      const ewt = this.startNodeAt('expression_with_to', expr);
      ewt.appendChild(wrapExpression(this, expr), 'expression');
      ewt.appendChild(withToList, 'with_to_statement_list');
      ewt.finalize();
      return { value: ewt };
    }

    // Check for assignment: expr = expr
    if (this.peek().kind === TokenKind.EQ) {
      const assign = this.startNodeAt('assignment_expression', expr);
      assign.appendChild(wrapExpression(this, expr), 'left');
      this.addAnonymousChild(assign, this.consume()); // =
      const right = parseExpression(this, 0);
      if (right) assign.appendChild(wrapExpression(this, right), 'right');
      assign.finalize();
      return { value: assign };
    }

    // Plain expression_with_to (just expression, no with/to)
    const ewt = this.startNodeAt('expression_with_to', expr);
    ewt.appendChild(wrapExpression(this, expr), 'expression');
    return { value: ewt };
  }

  private parseVariableDeclaration(): CSTNode {
    const startTok = this.peek();
    const node = this.startNode('variable_declaration');

    // mutable or linked
    this.addAnonymousChild(node, this.consume());

    // Check for duplicate modifier (error case: "mutable linked")
    if (
      this.peek().kind === TokenKind.ID &&
      (this.peek().text === 'mutable' || this.peek().text === 'linked')
    ) {
      // Wrap the extra modifier in ERROR
      const errExpr = parseExpression(this, 0);
      if (errExpr) {
        const wrapped = wrapExpression(this, errExpr);
        const errNode = makeErrorNode(
          this.source,
          [wrapped],
          wrapped.startOffset,
          wrapped.endOffset,
          wrapped.startPosition,
          wrapped.endPosition
        );
        node.appendChild(errNode);
      }
    }

    // type expression
    const typeExpr = parseExpression(this, 0);
    if (typeExpr) node.appendChild(wrapExpression(this, typeExpr), 'type');

    // Optional default: = expr
    if (this.peek().kind === TokenKind.EQ) {
      this.addAnonymousChild(node, this.consume()); // =
      const defaultExpr = parseExpression(this, 0);
      if (defaultExpr)
        node.appendChild(wrapExpression(this, defaultExpr), 'default');
    }

    this.finishNode(node, startTok);
    return node;
  }

  // --- Block value ---

  private parseBlockValue(): CSTNode | null {
    const tok = this.peek();

    // Sequence
    if (tok.kind === TokenKind.DASH_SPACE) {
      return this.parseSequence();
    }

    // Empty keyword
    if (tok.kind === TokenKind.ID && tok.text === 'empty') {
      const emptyNode = this.startNode('empty_keyword');
      this.addAnonymousChild(emptyNode, this.consume());
      this.finishNode(emptyNode, tok);
      return emptyNode;
    }

    // Mapping — either key:value or statement-starting content
    // isMappingStart() already checks isStatementStart() internally
    if (this.isMappingStart()) {
      return this.parseMapping();
    }

    // Atom (standalone value in block position)
    return this.parseAtomBlockValue();
  }

  private isStatementStart(): boolean {
    const tok = this.peek();
    if (tok.kind !== TokenKind.ID) return false;
    switch (tok.text) {
      case 'if':
      case 'run':
      case 'set':
      case 'transition':
        return true;
      case 'with':
        // "with" is a statement only if not followed by colon (which would make it a key)
        return this.peekAt(1).kind !== TokenKind.COLON;
      case 'available':
        return (
          this.peekAt(1).kind === TokenKind.ID && this.peekAt(1).text === 'when'
        );
      default:
        return false;
    }
  }

  private parseAtomBlockValue(): CSTNode | null {
    const expr = parseExpression(this, 0);
    if (!expr) return null;
    // tree-sitter's block_value rule wraps atom-type children in (atom ...)
    if (ATOM_TYPES.has(expr.type)) {
      const atom = new CSTNode(
        'atom',
        this.source,
        expr.startOffset,
        expr.endOffset,
        expr.startPosition,
        expr.endPosition
      );
      atom.appendChild(expr);
      return atom;
    }
    return expr;
  }

  // --- Sequence ---

  parseSequence(): CSTNode {
    const startTok = this.peek();
    const node = this.startNode('sequence');

    while (this.peek().kind === TokenKind.DASH_SPACE) {
      const elem = this.parseSequenceElement();
      if (elem) node.appendChild(elem);
      this.skipNewlines();
    }

    // Non-sequence items remaining at same indent → wrap in ERROR inside sequence
    while (
      !this.isAtEnd() &&
      this.peek().kind !== TokenKind.DEDENT &&
      this.peek().kind !== TokenKind.DASH_SPACE
    ) {
      this.skipNewlines();
      if (this.isAtEnd() || this.peek().kind === TokenKind.DEDENT) break;
      // Try to parse as mapping item and wrap in ERROR
      const item = this.parseMappingItem();
      if (item) {
        const errNode = makeErrorNode(
          this.source,
          [item],
          item.startOffset,
          item.endOffset,
          item.startPosition,
          item.endPosition
        );
        node.appendChild(errNode);
      } else {
        const err = this.synchronize();
        if (err) {
          node.appendChild(err);
        } else {
          this.consume();
        }
      }
    }

    this.finishNode(node, startTok);
    return node;
  }

  private parseSequenceElement(): CSTNode {
    const startTok = this.peek();
    const node = this.startNode('sequence_element');

    // Consume "- " or "-"
    this.addAnonymousChild(node, this.consume());

    // Check for colinear mapping element (key: value on same line)
    if (this.isColinearMappingElement()) {
      const mappingElem = this.parseColinearMappingElement();
      if (mappingElem)
        node.appendChild(mappingElem, 'colinear_mapping_element');

      // Optional block value (indented mapping below)
      if (this.peek().kind === TokenKind.NEWLINE) this.consume();
      if (this.peek().kind === TokenKind.INDENT) {
        this.consume();
        const blockValue = this.parseMapping();
        if (blockValue) node.appendChild(blockValue, 'block_value');
        if (this.peek().kind === TokenKind.DEDENT) this.consume();
      }
    } else if (
      this.peek().kind === TokenKind.NEWLINE ||
      this.peek().kind === TokenKind.EOF ||
      this.peek().kind === TokenKind.INDENT
    ) {
      // Bare dash with optional block value below (or immediately indented)
      if (this.peek().kind === TokenKind.NEWLINE) this.consume();
      if (this.peek().kind === TokenKind.INDENT) {
        this.consume();
        const blockValue = this.parseMapping();
        if (blockValue) node.appendChild(blockValue, 'block_value');
        if (this.peek().kind === TokenKind.DEDENT) this.consume();
      }
    } else {
      // Colinear value
      const colinear = this.tryParseColinearValue();
      if (colinear) {
        if (colinear.errorPrefix) node.appendChild(colinear.errorPrefix);
        node.appendChild(colinear.value, 'colinear_value');
      }
      // Inline comment after value
      if (this.peek().kind === TokenKind.COMMENT) {
        node.appendChild(this.consumeNamed('comment'));
      }
      if (this.peek().kind === TokenKind.NEWLINE) this.consume();
    }

    this.finishNode(node, startTok);
    return node;
  }

  private isColinearMappingElement(): boolean {
    // key: value on same line after "- "
    if (!isKeyStart(this)) return false;
    const tok = this.peek();

    // Look ahead: ID/STRING then COLON on same line
    const lookahead = 1;
    // Two-word key?
    if (
      this.peekAt(lookahead).kind === TokenKind.ID &&
      this.peekAt(lookahead).start.row === tok.start.row
    ) {
      const afterSecond = this.peekAt(lookahead + 1);
      if (
        afterSecond.kind === TokenKind.COLON &&
        afterSecond.start.row === tok.start.row
      ) {
        return true;
      }
      // Don't eagerly consume two-word key if first word is followed by colon
    }

    const next = this.peekAt(lookahead);
    return next.kind === TokenKind.COLON && next.start.row === tok.start.row;
  }

  private parseColinearMappingElement(): CSTNode {
    const startTok = this.peek();
    const node = this.startNode('mapping_element');

    const key = parseKey(this);
    if (key) node.appendChild(key, 'key');

    if (this.peek().kind === TokenKind.COLON) {
      this.addAnonymousChild(node, this.consume());
    }

    const colinear = this.tryParseColinearValue();
    if (colinear) {
      if (colinear.errorPrefix) node.appendChild(colinear.errorPrefix);
      node.appendChild(colinear.value, 'colinear_value');
    }

    this.finishNode(node, startTok);
    return node;
  }

  // --- Statements ---

  parseProcedure(): CSTNode {
    const startTok = this.peek();
    const node = this.startNode('procedure');

    while (!this.isAtEnd() && this.peek().kind !== TokenKind.DEDENT) {
      this.skipNewlines();
      if (this.isAtEnd() || this.peek().kind === TokenKind.DEDENT) break;

      // Don't consume trailing comments that belong to the parent scope
      // (tree-sitter parity: extras at block boundaries attach to the parent).
      if (
        this.peek().kind === TokenKind.COMMENT &&
        this.isTrailingCommentOnly()
      ) {
        break;
      }

      const stmt = this.parseStatement();
      if (stmt) {
        node.appendChild(stmt);
      } else {
        const err = this.synchronize();
        if (err) {
          node.appendChild(err);
        } else if (!this.isAtEnd() && this.peek().kind !== TokenKind.DEDENT) {
          this.consume();
        }
      }
    }

    // If the procedure is empty, add an ERROR node (Error 07, 34)
    if (node.namedChildren.length === 0) {
      node.appendChild(this.makeEmptyError());
    }

    this.finishNode(node, startTok);
    return node;
  }

  private parseStatement(): CSTNode | null {
    const tok = this.peek();

    if (tok.kind === TokenKind.ID) {
      switch (tok.text) {
        case 'if':
          return this.parseIfStatement();
        case 'run':
          return this.parseRunStatement();
        case 'set':
          return this.parseSetStatement();
        case 'transition':
          return this.parseTransitionStatement();
        case 'with':
          return this.parseWithStatement();
        case 'available': {
          if (
            this.peekAt(1).kind === TokenKind.ID &&
            this.peekAt(1).text === 'when'
          ) {
            return this.parseAvailableWhenStatement();
          }
          break;
        }
        case 'else':
        case 'elif':
        case 'for':
          // Orphan else/elif (without if) or unsupported for → wrap in ERROR
          return this.parseOrphanBlock();
      }
    }

    if (tok.kind === TokenKind.PIPE) {
      return this.parseTemplate();
    }

    if (tok.kind === TokenKind.COMMENT) {
      const comment = this.consumeNamed('comment');
      if (this.peek().kind === TokenKind.NEWLINE) this.consume();
      return comment;
    }

    // Fallback: try parsing as a bare expression (e.g., `...` inside a procedure)
    // This keeps expressions as proper expression nodes instead of ERROR-wrapped tokens.
    const expr = parseExpression(this, 0);
    if (expr) {
      const wrapped = wrapExpression(this, expr);
      if (this.peek().kind === TokenKind.NEWLINE) this.consume();
      return wrapped;
    }

    return null;
  }

  private parseIfStatement(): CSTNode {
    const startTok = this.peek();
    const node = this.startNode('if_statement');

    this.addAnonymousChild(node, this.consume()); // if

    // Condition
    let condition = parseExpression(this, 0);

    // Handle single `=` typo (should be `==`): wrap `=` in ERROR,
    // build comparison_expression, then continue parsing normally
    if (condition && this.peek().kind === TokenKind.EQ) {
      const eqTok = this.consume(); // =
      const right = parseExpression(this, 5); // parse right side above comparison
      if (right) {
        // Build: (comparison_expression (expr left) (ERROR =) (expr right))
        const cmp = this.startNodeAt('comparison_expression', condition);
        cmp.appendChild(wrapExpression(this, condition));
        // Wrap `=` in ERROR
        const eqChild = new CSTNode(
          '=',
          this.source,
          eqTok.startOffset,
          eqTok.startOffset + 1,
          eqTok.start,
          eqTok.end,
          false
        );
        const eqErr = makeErrorNode(
          this.source,
          [eqChild],
          eqTok.startOffset,
          eqTok.startOffset + 1,
          eqTok.start,
          eqTok.end
        );
        cmp.appendChild(eqErr);
        cmp.appendChild(wrapExpression(this, right));
        cmp.finalize();
        condition = cmp;
      }
    }

    if (condition)
      node.appendChild(wrapExpression(this, condition), 'condition');

    // Absorb extra tokens between condition and colon on the same row.
    // e.g., `if abc == 1 xxx:` — expression parser stops at `abc == 1`,
    // leaving `xxx` orphaned. Wrap leftover tokens in an ERROR so the
    // if_statement CST captures the full line for round-trip fidelity.
    // Unlike synchronizeRow, we MUST stop at COLON so it can be consumed
    // normally below — eating the colon would break consequence parsing.
    if (
      condition &&
      this.peek().kind !== TokenKind.COLON &&
      !this.isAtSyncPoint() &&
      this.peek().kind !== TokenKind.INDENT
    ) {
      const condRow = startTok.start.row;
      const err = this.synchronizeRowUntilColon(condRow);
      if (err) node.appendChild(err);
    }

    // Colon (or recovery)
    if (this.peek().kind === TokenKind.COLON) {
      this.addAnonymousChild(node, this.consume());
    } else if (this.peek().kind === TokenKind.INDENT) {
      // Missing colon → insert ERROR before consequence
      node.appendChild(this.makeEmptyError());
    } else {
      // No colon and no indent → error, if body at same indent
      node.appendChild(this.makeEmptyError());
    }

    // Inline comment after colon (e.g., `if cond: # comment`)
    if (this.peek().kind === TokenKind.COMMENT) {
      node.appendChild(this.consumeNamed('comment'));
    }

    // Absorb extra inline tokens after colon on the same row (e.g.,
    // `if cond: adfasdf`). These are not valid consequence statements
    // but must be captured inside the if_statement node, not left as
    // siblings.
    {
      const colonRow = startTok.start.row;
      const inlineErr = this.synchronizeRow(colonRow);
      if (inlineErr) node.appendChild(inlineErr);
    }

    // Consequence block
    if (this.peek().kind === TokenKind.INDENT) {
      this.consume();
      const proc = this.parseProcedure();
      if (proc) node.appendChild(proc, 'consequence');
      this.consumeTrailingComments(node);
      if (this.peek().kind === TokenKind.DEDENT) this.consume();
    } else if (this.peek().kind === TokenKind.NEWLINE || this.isAtSyncPoint()) {
      // Colon but no indented body → ERROR for missing consequence
      node.appendChild(this.makeEmptyError());
    }

    // Consume NEWLINE after consequence block
    if (this.peek().kind === TokenKind.NEWLINE) this.consume();

    // elif clauses
    while (this.peek().kind === TokenKind.ID && this.peek().text === 'elif') {
      const elif = this.parseElifClause();
      if (elif) node.appendChild(elif, 'alternative');
    }

    // else clause
    if (this.peek().kind === TokenKind.ID && this.peek().text === 'else') {
      const elseClause = this.parseElseClause();
      if (elseClause) node.appendChild(elseClause, 'alternative');
    }

    this.finishNode(node, startTok);
    return node;
  }

  private parseElifClause(): CSTNode {
    const startTok = this.peek();
    const node = this.startNode('elif_clause');

    this.addAnonymousChild(node, this.consume()); // elif

    const condition = parseExpression(this, 0);
    if (condition)
      node.appendChild(wrapExpression(this, condition), 'condition');

    // Absorb extra tokens between condition and colon (same as if)
    if (
      condition &&
      this.peek().kind !== TokenKind.COLON &&
      !this.isAtSyncPoint() &&
      this.peek().kind !== TokenKind.INDENT
    ) {
      const condRow = startTok.start.row;
      const err = this.synchronizeRowUntilColon(condRow);
      if (err) node.appendChild(err);
    }

    if (this.peek().kind === TokenKind.COLON) {
      this.addAnonymousChild(node, this.consume());
    }

    // Inline comment after colon
    if (this.peek().kind === TokenKind.COMMENT) {
      node.appendChild(this.consumeNamed('comment'));
    }

    // Absorb extra inline tokens after colon (same as if)
    {
      const colonRow = startTok.start.row;
      const inlineErr = this.synchronizeRow(colonRow);
      if (inlineErr) node.appendChild(inlineErr);
    }

    if (this.peek().kind === TokenKind.INDENT) {
      this.consume();
      const proc = this.parseProcedure();
      if (proc) node.appendChild(proc, 'consequence');
      this.consumeTrailingComments(node);
      if (this.peek().kind === TokenKind.DEDENT) this.consume();
    }

    if (this.peek().kind === TokenKind.NEWLINE) this.consume();

    this.finishNode(node, startTok);
    return node;
  }

  private parseElseClause(): CSTNode {
    const startTok = this.peek();
    const node = this.startNode('else_clause');

    this.addAnonymousChild(node, this.consume()); // else

    if (this.peek().kind === TokenKind.COLON) {
      this.addAnonymousChild(node, this.consume());
    }

    // Inline comment after colon
    if (this.peek().kind === TokenKind.COMMENT) {
      node.appendChild(this.consumeNamed('comment'));
    }

    // Absorb extra inline tokens after colon (same as if/elif)
    {
      const colonRow = startTok.start.row;
      const inlineErr = this.synchronizeRow(colonRow);
      if (inlineErr) node.appendChild(inlineErr);
    }

    if (this.peek().kind === TokenKind.INDENT) {
      this.consume();
      const proc = this.parseProcedure();
      if (proc) node.appendChild(proc, 'consequence');
      this.consumeTrailingComments(node);
      if (this.peek().kind === TokenKind.DEDENT) this.consume();
    }

    if (this.peek().kind === TokenKind.NEWLINE) this.consume();

    this.finishNode(node, startTok);
    return node;
  }

  private parseRunStatement(): CSTNode {
    const startTok = this.peek();
    const node = this.startNode('run_statement');

    this.addAnonymousChild(node, this.consume()); // run

    // Target expression
    if (!this.isAtSyncPoint()) {
      const target = parseExpression(this, 0);
      if (target) {
        node.appendChild(wrapExpression(this, target), 'target');
      } else {
        this.addMissingTarget(node);
      }
    } else {
      // `run` with no target at all → insert ERROR placeholder
      this.addMissingTarget(node);
    }

    // Optional indented block (procedure)
    if (this.peek().kind === TokenKind.INDENT) {
      this.consume();
      // Comments before procedure body attach to run_statement
      this.consumeLeadingComments(node);
      const proc = this.parseProcedure();
      if (proc) {
        // If procedure contains an ERROR with `with` keyword (invalid with clause),
        // attach children directly to run_statement so the dialect's
        // error recovery can find them (it looks at run_statement.children).
        const hasWithError = proc.namedChildren.some(
          c => c.isError && c.children.some(cc => cc.type === 'with')
        );
        if (hasWithError) {
          for (const child of proc.namedChildren) {
            node.appendChild(child);
          }
        } else {
          node.appendChild(proc, 'block_value');
        }
      }
      this.consumeTrailingComments(node);
      if (this.peek().kind === TokenKind.DEDENT) this.consume();
    }

    if (this.peek().kind === TokenKind.NEWLINE) this.consume();

    this.finishNode(node, startTok);
    return node;
  }

  private parseSetStatement(): CSTNode {
    const startTok = this.peek();
    const node = this.startNode('set_statement');

    this.addAnonymousChild(node, this.consume()); // set

    // Parse target at precedence 5 (above comparison/=) so = and == aren't consumed
    const target = parseExpression(this, 5);

    if (this.peek().kind === TokenKind.EQEQ) {
      // set @var == "value" → ERROR: == instead of =
      // Build comparison_expression(target, ==, rhs) and wrap in ERROR
      // Don't add target to node — we're returning an ERROR node instead
      const eqTok = this.consume(); // ==
      const rhs = parseExpression(this, 0);

      if (target && rhs) {
        const cmp = this.startNodeAt(
          'comparison_expression',
          wrapExpression(this, target)
        );
        cmp.appendChild(wrapExpression(this, target));
        cmp.appendChild(
          new CSTNode(
            eqTok.text,
            this.source,
            eqTok.startOffset,
            eqTok.startOffset + 2,
            eqTok.start,
            eqTok.end,
            false
          )
        );
        cmp.appendChild(wrapExpression(this, rhs));
        cmp.finalize();
        const wrappedCmp = wrapExpression(this, cmp);

        if (this.peek().kind === TokenKind.NEWLINE) this.consume();
        // Return ERROR instead of set_statement
        return makeErrorNode(
          this.source,
          [wrappedCmp],
          wrappedCmp.startOffset,
          wrappedCmp.endOffset,
          wrappedCmp.startPosition,
          wrappedCmp.endPosition
        );
      }
    }

    // Add target to node only after ruling out the == error case
    if (target) node.appendChild(wrapExpression(this, target), 'target');

    if (this.peek().kind === TokenKind.EQ) {
      this.addAnonymousChild(node, this.consume()); // =
      const value = parseExpression(this, 0);
      if (value) node.appendChild(wrapExpression(this, value), 'value');
    }

    if (this.peek().kind === TokenKind.NEWLINE) this.consume();

    this.finishNode(node, startTok);
    return node;
  }

  private parseTransitionStatement(): CSTNode {
    const startTok = this.peek();
    const node = this.startNode('transition_statement');

    this.addAnonymousChild(node, this.consume()); // transition

    // Optional with/to statement list
    const withToList = this.tryParseWithToStatementList();
    if (withToList) {
      node.appendChild(withToList, 'with_to_statement_list');
    }

    if (this.peek().kind === TokenKind.NEWLINE) this.consume();

    this.finishNode(node, startTok);
    return node;
  }

  private parseWithStatement(): CSTNode {
    const startTok = this.peek();

    // Check if `with` is followed by a valid param (ID/STRING).
    // If not (e.g., `with ...`), create ERROR containing `with` keyword.
    // The remaining tokens (e.g. `...`) stay unconsumed for the caller.
    if (
      this.peekAt(1).kind !== TokenKind.ID &&
      this.peekAt(1).kind !== TokenKind.STRING
    ) {
      const withTok = this.consume();
      const kwOffset = this.currentOffset();
      const withChild = new CSTNode(
        'with',
        this.source,
        kwOffset,
        kwOffset + 4,
        withTok.start,
        withTok.end,
        false
      );
      return makeErrorNode(
        this.source,
        [withChild],
        kwOffset,
        kwOffset + 4,
        withTok.start,
        withTok.end
      );
    }

    const node = this.startNode('with_statement');
    this.addAnonymousChild(node, this.consume()); // with

    // Parse param=value pairs
    this.parseWithParams(node);

    // Inline comment on the with line (e.g. `with city=x # comment`)
    if (this.peek().kind === TokenKind.COMMENT) {
      node.appendChild(this.consumeNamed('comment'));
    }

    if (this.peek().kind === TokenKind.NEWLINE) this.consume();

    this.finishNode(node, startTok);
    return node;
  }

  private parseWithParams(node: CSTNode): void {
    while (!this.isAtSyncPoint()) {
      // param
      if (
        this.peek().kind === TokenKind.ID ||
        this.peek().kind === TokenKind.STRING
      ) {
        if (this.peek().kind === TokenKind.STRING) {
          node.appendChild(parseString(this), 'param');
        } else {
          node.appendChild(this.consumeNamed('id'), 'param');
        }
      } else {
        // Not a valid param — wrap remaining tokens in ERROR inside with_statement
        const err = this.synchronize();
        if (err) node.appendChild(err);
        return;
      }

      // =
      if (this.peek().kind === TokenKind.EQ) {
        this.addAnonymousChild(node, this.consume());
      } else {
        // Missing = → insert MISSING
        node.appendChild(this.makeMissing('='));
      }

      // value
      const value = parseExpression(this, 0);
      if (value) node.appendChild(wrapExpression(this, value), 'value');

      // comma
      if (this.peek().kind === TokenKind.COMMA) {
        this.addAnonymousChild(node, this.consume());
      } else {
        break;
      }
    }
  }

  private parseAvailableWhenStatement(): CSTNode {
    const startTok = this.peek();
    const node = this.startNode('available_when_statement');

    this.addAnonymousChild(node, this.consume()); // available
    this.addAnonymousChild(node, this.consume()); // when

    const condition = parseExpression(this, 0);
    if (condition)
      node.appendChild(wrapExpression(this, condition), 'condition');

    if (this.peek().kind === TokenKind.NEWLINE) this.consume();

    this.finishNode(node, startTok);
    return node;
  }

  // --- Template ---

  /**
   * Parse a template starting with `|`.
   * Consumes tokens from the lexer stream, treating everything as template content
   * except `{!...}` breaks which are parsed as template expressions.
   */
  private parseTemplate(): CSTNode {
    const startTok = this.peek();
    const node = this.startNode('template');

    // Compute the indent level of the line containing `|`.
    // Tree-sitter uses *array_back(&scanner->indents) — the top of the indent
    // stack, which equals the line indent. We scan backward in the source to
    // measure the leading whitespace on this line.
    const pipeOffset = this.peekOffset();
    let lineStart = pipeOffset;
    while (
      lineStart > 0 &&
      this.source.charCodeAt(lineStart - 1) !== 10 /* \n */
    ) {
      lineStart--;
    }
    let templateOuterIndent = 0;
    for (let i = lineStart; i < pipeOffset; i++) {
      const ch = this.source.charCodeAt(i);
      if (ch === 32 /* space */) templateOuterIndent += 1;
      else if (ch === 9 /* tab */) templateOuterIndent += 3;
      else break;
    }

    // Consume the | token and track position right after it
    const pipeToken = this.consume();
    this.addAnonymousChild(node, pipeToken);

    // If there are tokens on the same line after |, pass afterPipeOffset
    // so whitespace between | and {! is captured as template_content.
    // If the line is empty after |, don't pass it (avoids phantom content).
    const hasContentOnSameLine =
      !this.isAtEnd() &&
      this.peek().kind !== TokenKind.NEWLINE &&
      this.peek().kind !== TokenKind.INDENT &&
      this.peek().kind !== TokenKind.DEDENT &&
      this.peek().kind !== TokenKind.EOF;

    if (hasContentOnSameLine) {
      const afterPipeOffset = pipeToken.startOffset + 1;
      this.gatherTemplateContentLine(node, afterPipeOffset);
    }

    // Consume NEWLINE if present
    if (this.peek().kind === TokenKind.NEWLINE) {
      this.consume();
    }

    // If there's an INDENT, the template continues on indented lines.
    // Templates consume ALL indented content until we fully return to the
    // base indent. We track indent depth: each INDENT increments, each
    // DEDENT decrements. When depth reaches 0, a final DEDENT exits.
    // Mid-template DEDENTs (under-indented continuation lines) are consumed
    // as content.
    if (this.peek().kind === TokenKind.INDENT) {
      this.consume(); // outer INDENT
      let indentDepth = 1;
      while (!this.isAtEnd()) {
        const tok = this.peek();
        if (tok.kind === TokenKind.DEDENT) {
          indentDepth--;
          this.consume();
          if (indentDepth <= 0) {
            // Check if template continues with under-indented content.
            // If the next meaningful token is content (not EOF/DEDENT),
            // the template has under-indented continuation lines.
            if (this.templateContinues(templateOuterIndent)) {
              // Re-enter: consume content at the new (lower) indent
              indentDepth = 0; // will re-increment on next INDENT
              continue;
            }
            break;
          }
        } else if (tok.kind === TokenKind.INDENT) {
          indentDepth++;
          this.consume();
        } else if (tok.kind === TokenKind.NEWLINE) {
          this.consume();
        } else {
          // When at the template's base indent depth, check if the next
          // token should continue the template (e.g. comments at the base
          // level should not be absorbed as template content).
          if (
            indentDepth <= 0 &&
            !this.templateContinues(templateOuterIndent)
          ) {
            break;
          }
          // For continuation lines, start the content from the end of the
          // last template child so that newlines + indentation between a
          // template_expression and the next template_content are preserved
          // in the source text.  (mergeTemplateContent handles this for
          // consecutive template_content nodes, but not across expressions.)
          const lastChild =
            node.children.length > 0
              ? node.children[node.children.length - 1]!
              : null;
          const gapOffset =
            lastChild && lastChild.endOffset < this.peekOffset()
              ? lastChild.endOffset
              : undefined;
          const gapPos =
            gapOffset !== undefined ? lastChild!.endPosition : undefined;
          this.gatherTemplateContentLine(node, gapOffset, gapPos);
        }
      }
    }

    // Merge consecutive template_content children into single nodes.
    // Tree-sitter produces one template_content per contiguous text span;
    // our line-by-line parsing creates one per line.
    this.mergeTemplateContent(node);

    this.finishNode(node, startTok);
    return node;
  }

  /**
   * Check if the template continues with under-indented content.
   * After a DEDENT brings us to depth 0, if the next meaningful token
   * is content (not EOF, not DEDENT, not a mapping key pattern), the
   * template has continuation lines.
   */

  private templateContinues(templateOuterIndent: number): boolean {
    let i = 0;
    while (this.peekAt(i).kind === TokenKind.NEWLINE) i++;
    const tok = this.peekAt(i);
    // If we see content (ID, etc.) that's NOT a mapping key pattern, continue
    if (tok.kind === TokenKind.EOF || tok.kind === TokenKind.DEDENT)
      return false;
    // Content deeper than the template's base indent is always template content,
    // regardless of keywords. Matches tree-sitter scanner behavior where
    // indent_length > out_of_template_indent_length keeps content in the template.
    if (tok.start.column > templateOuterIndent) return true;
    // Another pipe starts a new template — don't absorb it
    if (tok.kind === TokenKind.PIPE) return false;
    // If it looks like a mapping key (ID followed by COLON), template is done
    if (tok.kind === TokenKind.ID || tok.kind === TokenKind.STRING) {
      const after = this.peekAt(i + 1);
      if (after.kind === TokenKind.COLON) return false;
      // Two-word key check
      if (after.kind === TokenKind.ID) {
        const afterAfter = this.peekAt(i + 2);
        if (afterAfter.kind === TokenKind.COLON) return false;
      }
    }
    // Statement keywords terminate template continuation — they're
    // sibling statements, not template content
    if (tok.kind === TokenKind.ID) {
      switch (tok.text) {
        case 'if':
        case 'elif':
        case 'else':
        case 'run':
        case 'set':
        case 'transition':
          return false;
        case 'with':
          // "with" not followed by colon is a statement
          if (this.peekAt(i + 1).kind !== TokenKind.COLON) return false;
          break;
        case 'available':
          if (
            this.peekAt(i + 1).kind === TokenKind.ID &&
            this.peekAt(i + 1).text === 'when'
          )
            return false;
          break;
      }
    }
    // If it looks like a dash (sequence), template is done
    if (tok.kind === TokenKind.DASH_SPACE) return false;
    // Comments at the template's base indent level are not template content
    if (tok.kind === TokenKind.COMMENT) return false;
    // Otherwise, assume it's template continuation
    return true;
  }

  private parseTemplateAsColinear(): CSTNode {
    return this.parseTemplate();
  }

  /** Merge consecutive template_content children into single nodes. */
  private mergeTemplateContent(template: CSTNode): void {
    const merged: CSTNode[] = [];
    let i = 0;
    while (i < template.children.length) {
      const child = template.children[i]!;
      if (child.type === 'template_content') {
        // Find the run of consecutive template_content nodes
        let end = i + 1;
        while (
          end < template.children.length &&
          template.children[end]!.type === 'template_content'
        ) {
          end++;
        }
        if (end > i + 1) {
          // Merge into one node
          const first = template.children[i]!;
          const last = template.children[end - 1]!;
          const mergedNode = new CSTNode(
            'template_content',
            this.source,
            first.startOffset,
            last.endOffset,
            first.startPosition,
            last.endPosition
          );
          mergedNode.parent = template;
          merged.push(mergedNode);
          i = end;
        } else {
          merged.push(child);
          i++;
        }
      } else {
        merged.push(child);
        i++;
      }
    }
    template.children = merged;
  }

  /**
   * Gather tokens on the current line as template content.
   * Recognizes {! ... } as template expression breaks.
   * Everything else (including inter-token whitespace) becomes template_content.
   * Uses source-level offsets so whitespace between tokens is preserved.
   */
  private gatherTemplateContentLine(
    parent: CSTNode,
    initialOffset?: number,
    initialPos?: { row: number; column: number }
  ): void {
    // Track the source range of content before/after template expressions.
    // If initialOffset is provided, use it (captures whitespace after |).
    // Otherwise start from the current token position.
    let contentStartOffset = initialOffset ?? this.peekOffset();
    let contentStartPos = initialPos ?? this.peek().start;
    let lastConsumedEndOffset = contentStartOffset;
    let lastConsumedEndPos = contentStartPos;

    while (!this.isAtEnd()) {
      const tok = this.peek();
      if (
        tok.kind === TokenKind.NEWLINE ||
        tok.kind === TokenKind.DEDENT ||
        tok.kind === TokenKind.INDENT ||
        tok.kind === TokenKind.EOF
      ) {
        break;
      }

      // Template expression start
      if (tok.kind === TokenKind.TEMPLATE_EXPR_START) {
        // Flush accumulated content up to the {!
        const exprOffset = this.peekOffset();
        if (exprOffset > contentStartOffset) {
          parent.appendChild(
            new CSTNode(
              'template_content',
              this.source,
              contentStartOffset,
              exprOffset,
              contentStartPos,
              tok.start
            )
          );
        }

        // Parse template expression
        const exprNode = this.parseTemplateExpression();
        parent.appendChild(exprNode);

        // Content after } continues from the end of the expression node
        // (not from the next token — that would skip whitespace between } and next content)
        contentStartOffset = exprNode.endOffset;
        contentStartPos = exprNode.endPosition;
        lastConsumedEndOffset = exprNode.endOffset;
        lastConsumedEndPos = exprNode.endPosition;
        continue;
      }

      // Track end of this token for accurate content span
      const tokOffset = this.peekOffset();
      lastConsumedEndOffset = tokOffset + tok.text.length;
      lastConsumedEndPos = tok.end;
      this.consume();
    }

    // Flush remaining content — use end of last consumed token (not next token offset,
    // which would include blank lines between this content and the next line)
    if (lastConsumedEndOffset > contentStartOffset) {
      parent.appendChild(
        new CSTNode(
          'template_content',
          this.source,
          contentStartOffset,
          lastConsumedEndOffset,
          contentStartPos,
          lastConsumedEndPos
        )
      );
    }
  }

  private parseTemplateExpression(): CSTNode {
    const startTok = this.peek();
    const node = this.startNode('template_expression');

    this.addAnonymousChild(node, this.consume()); // {!

    const expr = parseExpression(this, 0);
    if (expr) {
      node.appendChild(wrapExpression(this, expr), 'expression');
    } else {
      // Empty template expression {!} → ERROR for missing expression
      node.appendChild(this.makeEmptyError());
    }

    // Consume any extra tokens before } (e.g., unclosed {!@var.name world)
    if (this.peek().kind !== TokenKind.RBRACE && !this.isAtSyncPoint()) {
      const err = this.synchronize();
      if (err) node.appendChild(err);
    }

    if (this.peek().kind === TokenKind.RBRACE) {
      this.addAnonymousChild(node, this.consume()); // }
    } else {
      // Unclosed template expression → MISSING }
      node.appendChild(this.makeMissing('}'));
    }

    this.finishNode(node, startTok);
    return node;
  }

  // --- With/To statement list ---

  private tryParseWithToStatementList(): CSTNode | null {
    const tok = this.peek();
    if (tok.kind !== TokenKind.ID) return null;
    if (tok.text !== 'with' && tok.text !== 'to') return null;

    const startTok = tok;
    const node = this.startNode('with_to_statement_list');

    while (!this.isAtSyncPoint()) {
      if (this.peek().kind === TokenKind.ID && this.peek().text === 'with') {
        node.appendChild(this.parseInlineWithStatement());
      } else if (
        this.peek().kind === TokenKind.ID &&
        this.peek().text === 'to'
      ) {
        node.appendChild(this.parseToStatement());
      } else {
        break;
      }
      if (this.peek().kind === TokenKind.COMMA) {
        this.addAnonymousChild(node, this.consume());
      } else {
        break;
      }
    }

    if (node.children.length === 0) return null;

    this.finishNode(node, startTok);
    return node;
  }

  private parseInlineWithStatement(): CSTNode {
    const startTok = this.peek();
    const node = this.startNode('with_statement');
    this.addAnonymousChild(node, this.consume()); // with
    this.parseWithParams(node);
    this.finishNode(node, startTok);
    return node;
  }

  private parseToStatement(): CSTNode {
    const startTok = this.peek();
    const node = this.startNode('to_statement');
    this.addAnonymousChild(node, this.consume()); // to

    const target = parseExpression(this, 0);
    if (target) {
      node.appendChild(wrapExpression(this, target), 'target');
    } else {
      // Missing target → ERROR
      node.appendChild(this.makeEmptyError());
    }

    this.finishNode(node, startTok);
    return node;
  }

  // --- Error recovery ---

  /**
   * Synchronize: skip tokens until NEWLINE, DEDENT, or EOF.
   * Returns an ERROR node wrapping the skipped content.
   */
  /** Create an empty ERROR node at the current position. */
  private makeEmptyError(): CSTNode {
    const offset = this.peekOffset();
    const pos = this.peek().start;
    return new CSTNode(
      'ERROR',
      this.source,
      offset,
      offset,
      pos,
      pos,
      true,
      true
    );
  }

  /** Insert a missing target: `target: (expression (atom (ERROR)))` */
  private addMissingTarget(node: CSTNode): void {
    const errAtom = this.makeEmptyError();
    const atom = new CSTNode(
      'atom',
      this.source,
      errAtom.startOffset,
      errAtom.endOffset,
      errAtom.startPosition,
      errAtom.endPosition
    );
    atom.appendChild(errAtom);
    const expr = new CSTNode(
      'expression',
      this.source,
      atom.startOffset,
      atom.endOffset,
      atom.startPosition,
      atom.endPosition
    );
    expr.appendChild(atom);
    node.appendChild(expr, 'target');
  }

  /** Create a MISSING node — an expected token/node that wasn't found in source. */
  private makeMissing(type: string): CSTNode {
    const offset = this.peekOffset();
    const pos = this.peek().start;
    return new CSTNode(
      type,
      this.source,
      offset,
      offset,
      pos,
      pos,
      true,
      false,
      true
    );
  }

  /**
   * Parse a standalone else/elif/for (without a preceding if, or unsupported).
   * Wraps the entire block in an ERROR node, preserving parsed statements inside.
   */
  private parseOrphanBlock(): CSTNode {
    const startOffset = this.peekOffset();
    const startPos = this.peek().start;
    const children: CSTNode[] = [];

    // Consume keyword and any tokens up to colon/newline.
    // Capture consumed tokens as children of the ERROR for dialect recovery.
    const keywordTok = this.consume();
    const kwOffset = this.currentOffset();
    children.push(
      new CSTNode(
        keywordTok.text,
        this.source,
        kwOffset,
        kwOffset + keywordTok.text.length,
        keywordTok.start,
        keywordTok.end,
        false
      )
    );

    while (
      !this.isAtSyncPoint() &&
      !this.isAtEnd() &&
      this.peek().kind !== TokenKind.COLON
    ) {
      this.consume(); // consume but don't add as named children — they're noise
    }
    // Consume colon if present
    if (this.peek().kind === TokenKind.COLON) this.consume();
    // Consume the body block
    if (this.peek().kind === TokenKind.INDENT) {
      this.consume();
      const proc = this.parseProcedure();
      if (proc) {
        for (const child of proc.namedChildren) {
          children.push(child);
        }
      }
      // Consume trailing comments left by parseProcedure's isTrailingCommentOnly guard
      while (
        this.peek().kind === TokenKind.COMMENT ||
        this.peek().kind === TokenKind.NEWLINE
      ) {
        if (this.peek().kind === TokenKind.COMMENT) {
          children.push(this.consumeNamed('comment'));
        } else {
          this.consume();
        }
      }
      if (this.peek().kind === TokenKind.DEDENT) this.consume();
    }
    if (this.peek().kind === TokenKind.NEWLINE) this.consume();

    const endOffset =
      children.length > 0
        ? children[children.length - 1]!.endOffset
        : this.peekOffset();
    const endPos =
      children.length > 0
        ? children[children.length - 1]!.endPosition
        : this.peek().start;

    return makeErrorNode(
      this.source,
      children,
      startOffset,
      endOffset,
      startPos,
      endPos
    );
  }

  /**
   * Consume any leftover tokens in an indented block (before DEDENT) as ERROR
   * nodes. Prevents cascading failures when parseBlockValue() only partially
   * consumes the block content (e.g., unquoted multi-word text).
   */
  private recoverToBlockEnd(parent: CSTNode): void {
    while (
      !this.isAtEnd() &&
      this.peek().kind !== TokenKind.DEDENT &&
      this.peek().kind !== TokenKind.EOF
    ) {
      if (this.peek().kind === TokenKind.NEWLINE) {
        this.consume();
        continue;
      }
      // Skip over nested indented blocks within the error zone
      if (this.peek().kind === TokenKind.INDENT) {
        this.consume();
        this.recoverToBlockEnd(parent);
        if (this.peek().kind === TokenKind.DEDENT) this.consume();
        continue;
      }
      const err = this.synchronize();
      if (err) {
        parent.appendChild(err);
      } else {
        break;
      }
    }
  }

  /**
   * Like synchronize(), but stops at row boundaries and INDENT tokens.
   * Used after colinear values to absorb broken same-line content (e.g.,
   * `go: @utils.transition tz @topic.A2` — captures `tz @topic.A2`)
   * without consuming indented content on the next line.
   */
  /**
   * Like synchronizeRow(), but also stops at COLON tokens.
   * Used after if/elif conditions to absorb extra tokens (e.g.,
   * `if abc == 1 xxx:` — captures `xxx`) without eating the colon
   * that delimits the condition from the consequence block.
   */
  private synchronizeRowUntilColon(row: number): CSTNode | null {
    if (this.isAtSyncPoint() || this.isAtEnd()) return null;
    if (this.peek().kind === TokenKind.INDENT) return null;
    if (this.peek().kind === TokenKind.COLON) return null;
    if (this.peek().start.row !== row) return null;

    const startOffset = this.peekOffset();
    const startPos = this.peek().start;
    const children: CSTNode[] = [];

    while (
      !this.isAtSyncPoint() &&
      !this.isAtEnd() &&
      this.peek().kind !== TokenKind.INDENT &&
      this.peek().kind !== TokenKind.COLON &&
      this.peek().start.row === row
    ) {
      const tok = this.consume();
      const offset = this.currentOffset();
      let nodeType = tok.text;
      let isNamed = false;
      switch (tok.kind) {
        case TokenKind.ID:
          nodeType = 'id';
          isNamed = true;
          break;
        case TokenKind.NUMBER:
          nodeType = 'number';
          isNamed = true;
          break;
        case TokenKind.STRING:
          nodeType = 'string';
          isNamed = true;
          break;
        case TokenKind.COMMENT:
          nodeType = 'comment';
          isNamed = true;
          break;
      }
      children.push(
        new CSTNode(
          nodeType,
          this.source,
          offset,
          offset + tok.text.length,
          tok.start,
          tok.end,
          isNamed
        )
      );
    }

    if (children.length === 0) return null;

    const last = children[children.length - 1]!;
    return makeErrorNode(
      this.source,
      children,
      startOffset,
      last.endOffset,
      startPos,
      last.endPosition
    );
  }

  private synchronizeRow(row: number): CSTNode | null {
    if (this.isAtSyncPoint() || this.isAtEnd()) return null;
    if (this.peek().kind === TokenKind.INDENT) return null;
    if (this.peek().start.row !== row) return null;

    const startOffset = this.peekOffset();
    const startPos = this.peek().start;
    const children: CSTNode[] = [];

    while (
      !this.isAtSyncPoint() &&
      !this.isAtEnd() &&
      this.peek().kind !== TokenKind.INDENT &&
      this.peek().start.row === row
    ) {
      const tok = this.consume();
      const offset = this.currentOffset();
      let nodeType = tok.text;
      let isNamed = false;
      switch (tok.kind) {
        case TokenKind.ID:
          nodeType = 'id';
          isNamed = true;
          break;
        case TokenKind.NUMBER:
          nodeType = 'number';
          isNamed = true;
          break;
        case TokenKind.STRING:
          nodeType = 'string';
          isNamed = true;
          break;
        case TokenKind.COMMENT:
          nodeType = 'comment';
          isNamed = true;
          break;
      }
      children.push(
        new CSTNode(
          nodeType,
          this.source,
          offset,
          offset + tok.text.length,
          tok.start,
          tok.end,
          isNamed
        )
      );
    }

    if (children.length === 0) return null;

    const last = children[children.length - 1]!;
    return makeErrorNode(
      this.source,
      children,
      startOffset,
      last.endOffset,
      startPos,
      last.endPosition
    );
  }

  private synchronize(): CSTNode | null {
    if (this.isAtSyncPoint() || this.isAtEnd()) return null;

    const startOffset = this.peekOffset();
    const startPos = this.peek().start;
    const children: CSTNode[] = [];

    while (!this.isAtSyncPoint() && !this.isAtEnd()) {
      const tok = this.consume();
      const offset = this.currentOffset();
      // Use proper node type based on token kind, not token text
      let nodeType = tok.text;
      let isNamed = false;
      switch (tok.kind) {
        case TokenKind.ID:
          nodeType = 'id';
          isNamed = true;
          break;
        case TokenKind.NUMBER:
          nodeType = 'number';
          isNamed = true;
          break;
        case TokenKind.STRING:
          nodeType = 'string';
          isNamed = true;
          break;
        case TokenKind.COMMENT:
          nodeType = 'comment';
          isNamed = true;
          break;
      }
      children.push(
        new CSTNode(
          nodeType,
          this.source,
          offset,
          offset + tok.text.length,
          tok.start,
          tok.end,
          isNamed
        )
      );
    }

    if (children.length === 0) return null;

    const last = children[children.length - 1]!;
    return makeErrorNode(
      this.source,
      children,
      startOffset,
      last.endOffset,
      startPos,
      last.endPosition
    );
  }

  // --- Utility ---

  private skipNewlines(): void {
    while (this.peek().kind === TokenKind.NEWLINE) {
      this.consume();
    }
  }

  /** Consume comment tokens (and intervening newlines) and attach to parent node. */
  private consumeLeadingComments(parent: CSTNode): void {
    while (true) {
      if (this.peek().kind === TokenKind.COMMENT) {
        parent.appendChild(this.consumeNamed('comment'));
        if (this.peek().kind === TokenKind.NEWLINE) this.consume();
      } else if (this.peek().kind === TokenKind.NEWLINE) {
        this.consume();
      } else {
        break;
      }
    }
  }

  /** Consume trailing comments (on next lines before DEDENT) and attach to parent node. */
  private consumeTrailingComments(parent: CSTNode): void {
    while (
      this.peek().kind === TokenKind.NEWLINE ||
      this.peek().kind === TokenKind.COMMENT
    ) {
      if (this.peek().kind === TokenKind.COMMENT) {
        parent.appendChild(this.consumeNamed('comment'));
      }
      if (this.peek().kind === TokenKind.NEWLINE) {
        this.consume();
      }
    }
  }

  private isAtEnd(): boolean {
    return this.peek().kind === TokenKind.EOF;
  }

  /** Check if from current position, there are only comments, newlines, and then EOF/DEDENT. */
  private isTrailingCommentOnly(): boolean {
    let i = 0;
    while (i < 50) {
      const tok = this.peekAt(i);
      if (tok.kind === TokenKind.EOF || tok.kind === TokenKind.DEDENT)
        return true;
      if (tok.kind === TokenKind.COMMENT || tok.kind === TokenKind.NEWLINE) {
        i++;
        continue;
      }
      return false;
    }
    return false; // Exceeded lookahead limit
  }

  private eofToken(): Token {
    if (!this._eof) {
      const lastToken = this.tokens[this.tokens.length - 1];
      const pos = lastToken ? lastToken.end : { row: 0, column: 0 };
      this._eof = {
        kind: TokenKind.EOF,
        text: '',
        start: pos,
        end: pos,
        startOffset: this.source.length,
      };
    }
    return this._eof;
  }
}
