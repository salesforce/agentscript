/**
 * Single source of truth for AgentScript string escape sequences.
 *
 * Maps the character after `\` to its interpreted value.
 * Every consumer that interprets or serializes string literals should
 * use the helpers exported from this module.
 *
 * Must stay in sync with:
 *   - tree-sitter grammar.js  `escape_sequence` regex
 *   - parser-javascript        VALID_ESCAPES set
 */
export const ESCAPE_TABLE: ReadonlyMap<string, string> = new Map([
  ['"', '"'],
  ['\\', '\\'],
  ['n', '\n'],
  ['t', '\t'],
  ['r', '\r'],
  ['0', '\0'],
]);

/**
 * Interpret a `\X` escape sequence.
 * @param char The character after the backslash (e.g. `n` for `\n`).
 * @returns The interpreted character, or `undefined` for unrecognized escapes.
 */
export function interpretEscape(char: string): string | undefined {
  return ESCAPE_TABLE.get(char);
}

/**
 * Reverse of ESCAPE_TABLE: maps interpreted characters back to their escape codes.
 * Built from ESCAPE_TABLE so the two stay in sync automatically.
 */
const REVERSE_ESCAPE_TABLE: ReadonlyMap<string, string> = new Map(
  [...ESCAPE_TABLE].map(([code, char]) => [char, `\\${code}`] as const)
  // backslash maps to itself in ESCAPE_TABLE ('\\' -> '\\'), so its
  // reverse entry is already correct ('\\' -> '\\\\' via the template).
);

/** Matches any character that needs escaping, derived from REVERSE_ESCAPE_TABLE. */
const ESCAPE_PATTERN = new RegExp(
  '[' +
    [...REVERSE_ESCAPE_TABLE.keys()]
      .map(c => '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0'))
      .join('') +
    ']',
  'g'
);

/**
 * Escape a string value for embedding in a double-quoted string literal.
 * Reverses the interpretation performed by the parser.
 */
export function escapeStringValue(value: string): string {
  return value.replace(ESCAPE_PATTERN, ch => REVERSE_ESCAPE_TABLE.get(ch)!);
}
