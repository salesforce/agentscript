import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/lexer.js';
import { TokenKind } from '../src/token.js';
import { parse } from '../src/index.js';

function tokenize(source: string) {
  return new Lexer(source).tokenize();
}

function meaningfulKinds(source: string): TokenKind[] {
  return tokenize(source)
    .filter(
      t =>
        t.kind !== TokenKind.NEWLINE &&
        t.kind !== TokenKind.EOF &&
        t.kind !== TokenKind.INDENT &&
        t.kind !== TokenKind.DEDENT
    )
    .map(t => t.kind);
}

describe('line continuation', () => {
  it('backslash-newline is transparent to the token stream', () => {
    const withContinuation = meaningfulKinds('key: foo \\\n  + bar');
    const singleLine = meaningfulKinds('key: foo + bar');
    expect(withContinuation).toEqual(singleLine);
  });

  it('no extra NEWLINE or INDENT tokens from continuation', () => {
    const tokens = tokenize('key: foo \\\n  + bar');
    const kinds = tokens.map(t => t.kind);
    // Should be: ID COLON ID PLUS ID NEWLINE EOF (or similar flat sequence)
    // Should NOT contain INDENT between foo and +
    const idxFoo = kinds.indexOf(TokenKind.ID, kinds.indexOf(TokenKind.COLON));
    const idxPlus = kinds.indexOf(TokenKind.PLUS);
    const between = kinds.slice(idxFoo + 1, idxPlus);
    expect(between).not.toContain(TokenKind.INDENT);
    expect(between).not.toContain(TokenKind.NEWLINE);
  });

  it('continuation produces same parse tree as single line', () => {
    const continued = parse('key: foo \\\n  + bar');
    const single = parse('key: foo + bar');
    expect(continued.rootNode.toSExp()).toBe(single.rootNode.toSExp());
  });

  it('CRLF line ending after backslash works the same as LF', () => {
    const crlf = parse('key: foo \\\r\n  + bar');
    const lf = parse('key: foo \\\n  + bar');
    expect(crlf.rootNode.toSExp()).toBe(lf.rootNode.toSExp());
    expect(crlf.rootNode.hasError).toBe(false);
  });
});
