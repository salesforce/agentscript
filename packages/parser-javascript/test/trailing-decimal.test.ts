import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/lexer.js';
import { TokenKind } from '../src/token.js';

function tokenize(source: string) {
  return new Lexer(source).tokenize();
}

describe('trailing decimal number', () => {
  it('tokenizes "123." as a single NUMBER token', () => {
    const tokens = tokenize('123.');
    const meaningful = tokens.filter(
      t => t.kind !== TokenKind.NEWLINE && t.kind !== TokenKind.EOF
    );
    expect(meaningful).toHaveLength(1);
    expect(meaningful[0].kind).toBe(TokenKind.NUMBER);
    expect(meaningful[0].text).toBe('123.');
  });
});
