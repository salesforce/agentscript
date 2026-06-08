/**
 * Shared indentation rules for AgentScript.
 *
 * Exported as regex source strings so they can be consumed by both
 * Monaco (LanguageConfiguration) and VSCode (language-configuration.json).
 */

/**
 * Describes an action to take when Enter is pressed.
 */
export interface OnEnterRule {
  /** Regex source string matched against the line content before the cursor. */
  beforeText: string;
  /** Regex source string matched against the line content after the cursor. */
  afterText?: string;
  /** Regex source string matched against the line above. */
  previousLineText?: string;
  /** Indentation action: indent, outdent, or none (maintain). */
  action: 'indent' | 'outdent' | 'none';
  /** Text to append after the new line's indentation. */
  appendText?: string;
}

/**
 * Lines ending with `:` or `->` (with optional trailing whitespace/comment)
 * should increase indentation on the next line.
 *
 * Excludes comment-only lines (lines where `#` appears before `:` or `->`).
 */
export const increaseIndentPattern = '^[^#]*(?::|->)\\s*(?:#.*)?$';

/**
 * Never-match pattern — offside-rule languages don't decrease indent
 * based on content patterns (indentation is structural).
 */
export const decreaseIndentPattern = '^\\s*NEVERMATCH$';

/**
 * Rules that determine indentation behavior when Enter is pressed.
 *
 * Both Monaco and VSCode support these rules natively. Monaco accepts
 * RegExp objects; VSCode accepts regex source strings in JSON.
 */
export const onEnterRules: OnEnterRule[] = [
  {
    // After a line ending with `:` (mapping key, if/elif/else, etc.)
    // e.g. "agent:", "  actions:", "if x > 5:", "else:"
    beforeText: '^[^#]*:\\s*(?:#.*)?$',
    action: 'indent',
  },
  {
    // After a line ending with `->` (arrow/procedure syntax)
    // e.g. "instructions: ->"
    beforeText: '^[^#]*->\\s*(?:#.*)?$',
    action: 'indent',
  },
];
