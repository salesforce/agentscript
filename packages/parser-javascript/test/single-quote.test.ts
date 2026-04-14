/**
 * Tests for single-quote handling in the lexer.
 *
 * Single-quoted strings are NOT supported (tree-sitter parity).
 * Single quotes are treated as unknown characters and produce ERROR_TOKEN.
 * Apostrophes in text (e.g. contractions) also produce ERROR_TOKEN but
 * the parser recovers gracefully.
 */

import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/lexer.js';
import { TokenKind } from '../src/token.js';
import { parse } from '../src/index.js';

function tokenize(source: string) {
  const lexer = new Lexer(source);
  return lexer.tokenize();
}

function tokenKinds(source: string): TokenKind[] {
  return tokenize(source)
    .filter(t => t.kind !== TokenKind.NEWLINE && t.kind !== TokenKind.EOF)
    .map(t => t.kind);
}

describe('single-quote handling (no single-quote string support)', () => {
  it('single quotes produce ERROR_TOKEN, not STRING', () => {
    const kinds = tokenKinds("'hello'");
    expect(kinds).not.toContain(TokenKind.STRING);
    expect(kinds).toContain(TokenKind.ERROR_TOKEN);
  });

  it('single-quoted value produces error in CST', () => {
    const result = parse("key: 'hello'");
    expect(result.rootNode.hasError).toBe(true);
  });

  it('parser does not crash on single quotes', () => {
    const result = parse("key: 'hello world'");
    expect(result.rootNode).toBeDefined();
    expect(result.rootNode.type).toBe('source_file');
  });

  it('apostrophe in contraction produces ERROR_TOKEN', () => {
    const kinds = tokenKinds("Here's");
    expect(kinds).toContain(TokenKind.ERROR_TOKEN);
  });

  it('parser handles contraction without crashing', () => {
    const result = parse("description: Here's how it works");
    expect(result.rootNode).toBeDefined();
    expect(result.rootNode.type).toBe('source_file');
  });
});
