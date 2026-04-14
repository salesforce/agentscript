/**
 * Recursive descent parser for AgentScript.
 *
 * Core invariant: NEWLINE and DEDENT are unconditional synchronization points.
 * Every parse function that encounters an unexpected token calls synchronize()
 * which skips to the next NEWLINE/DEDENT/EOF.
 */

import { isTokenKind, TokenKind, type Token } from './token.js';
import { Lexer } from './lexer.js';
import { CSTNode } from './cst-node.js';
import { isSyncPoint } from './errors.js';
import {
  synchronize,
  skipNewlines,
  consumeCommentsAndSkipNewlines,
  isAtEnd,
} from './recovery.js';
import { parseMappingOrExpression } from './parse-mapping.js';
import { parseSequence } from './parse-sequence.js';
import invariant from 'tiny-invariant';

/**
 * Token consumption — peek, advance, and query the token stream.
 */
export interface TokenStream {
  source: string;
  peek(): Token;
  peekAt(offset: number): Token;
  peekAtIndex(idx: number): Token;
  peekKind(): TokenKind;
  consume(): Token;
  consumeKind<K extends TokenKind>(kind: K): Token<K>;
  currentOffset(): number;
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
    return this.peekAt(0);
  }

  peekAt(offset: number): Token {
    // n.b. (Allen): Because this is called so frequently, these invariants cause significant runtime overhead.
    // invariant(this.pos + offset >= 0, 'peekAt too small');
    // invariant(this.pos + offset <= this.tokens.length, 'peekAt too large');
    return this.peekAtIndex(this.pos + offset);
  }

  peekAtIndex(idx: number): Token {
    return this.tokens[idx] ?? this.eofToken();
  }

  peekKind(): TokenKind {
    return this.peek().kind;
  }

  consume(): Token {
    const tok = this.peek();
    this.pos++;
    return tok;
  }

  consumeKind<K extends TokenKind>(kind: K): Token<K> {
    const tok = this.peek();
    invariant(
      isTokenKind(tok, kind),
      `Expected token kind ${kind} but got ${tok.kind}`
    );
    this.pos++;
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
    return this.peekAtIndex(idx).startOffset;
  }

  peekOffset(): number {
    return this.peek().startOffset;
  }

  isAtSyncPoint(): boolean {
    return isSyncPoint(this.peekKind());
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
    const node = this.startNode('source_file');

    // Skip leading newlines and indentation (handles template literals with leading whitespace)
    skipNewlines(this);
    if (this.peekKind() === TokenKind.INDENT) {
      this.consume();
    }

    // Consume leading comments at source_file level (tree-sitter treats them as extras)
    consumeCommentsAndSkipNewlines(this, node);

    // Determine what kind of source file this is
    if (this.peekKind() === TokenKind.DASH_SPACE) {
      // Sequence
      node.appendChild(parseSequence(this));
    } else {
      // Mapping or expression
      // n.b. (Allen): Originally we didn't permit expressions at the top level, but
      // we did that to make testing easier in tree-sitter so I suppose
      // we can just make this a feature of the language.
      const content = parseMappingOrExpression(this, _ctx =>
        parseSequence(_ctx)
      );
      if (content) node.appendChild(content);
    }

    // Consume trailing comments at source_file level
    consumeCommentsAndSkipNewlines(this, node);

    // Catch-all: if there are unconsumed tokens, wrap them in ERROR nodes.
    // This ensures every byte of source is represented in the CST.
    while (!isAtEnd(this)) {
      if (
        this.peekKind() === TokenKind.NEWLINE ||
        this.peekKind() === TokenKind.DEDENT
      ) {
        this.consume();
        continue;
      }
      if (this.peekKind() === TokenKind.COMMENT) {
        node.appendChild(this.consumeNamed('comment'));
        continue;
      }
      const err = synchronize(this);
      if (err) {
        node.appendChild(err);
      } else {
        // Consume one token to guarantee progress
        this.consume();
      }
    }

    // Root node must span entire source (matches tree-sitter invariant)
    node.startOffset = 0;
    node.startPosition = { row: 0, column: 0 };
    node.endOffset = this.source.length;
    node.endPosition = this.eofToken().end;

    return node;
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
