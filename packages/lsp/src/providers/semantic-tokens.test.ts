/**
 * Tests for semantic tokens provider
 */

import { describe, test, expect } from 'vitest';
import { TOKEN_TYPES, TOKEN_MODIFIERS } from './semantic-tokens.js';

describe('Semantic Tokens', () => {
  test('TOKEN_TYPES are defined', () => {
    expect(TOKEN_TYPES).toBeDefined();
    expect(TOKEN_TYPES.length).toBeGreaterThan(0);
  });

  test('TOKEN_MODIFIERS are defined', () => {
    expect(TOKEN_MODIFIERS).toBeDefined();
    expect(TOKEN_MODIFIERS.length).toBeGreaterThan(0);
  });
});
