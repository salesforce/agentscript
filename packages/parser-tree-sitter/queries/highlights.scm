; ============================================
; Highlights for AgentScript AWL
; Matches the grammar defined in grammar.js
;
; NOTE: In tree-sitter, later patterns take higher
; priority. Generic fallbacks go FIRST, specific
; overrides go LATER.
; ============================================

; ============================================
; COMMENTS
; ============================================
(comment) @comment

; ============================================
; KEYWORDS - Control flow
; ============================================
"if" @keyword
"elif" @keyword
"else" @keyword
"run" @keyword
"with" @keyword
"set" @keyword
"to" @keyword
"transition" @keyword
"available when" @keyword

; ============================================
; KEYWORDS - Logical operators
; ============================================
"and" @keyword
"or" @keyword

; ============================================
; VARIABLE MODIFIERS
; ============================================
"mutable" @keyword.modifier
"linked" @keyword.modifier

; ============================================
; CONSTANTS - Booleans, None, and Ellipsis
; ============================================
"True" @keyword
"False" @keyword
"None" @keyword
(ellipsis) @constant.builtin

; ============================================
; NUMBERS
; ============================================
(number) @number

; ============================================
; STRINGS
; ============================================
(string) @string
(string_content) @string
"\"" @string

; Escape sequences
(escape_sequence) @string.escape

; Template content (multiline)
(template_content) @string

; ============================================
; OPERATORS - Comparison
; ============================================
"==" @operator
"!=" @operator
"<" @operator
">" @operator
"<=" @operator
">=" @operator

; ============================================
; OPERATORS - Arithmetic
; ============================================
"+" @operator
"-" @operator
"*" @operator
"/" @operator

; ============================================
; OPERATORS - Assignment
; ============================================
"=" @operator

; ============================================
; PUNCTUATION - Delimiters
; ============================================
":" @punctuation.delimiter
"." @punctuation.delimiter
"," @punctuation.delimiter

; ============================================
; PUNCTUATION - Brackets
; ============================================
"[" @punctuation.bracket
"]" @punctuation.bracket
"{" @punctuation.bracket
"}" @punctuation.bracket

; ============================================
; PUNCTUATION - Template expression delimiters (yellow)
; ============================================
(template_expression
  "{!" @punctuation.template)
(template_expression
  "}" @punctuation.template)

; ============================================
; PUNCTUATION - Special
; ============================================
"|" @punctuation.special
"->" @punctuation.special
"-" @punctuation.special
" " @punctuation.special

; ============================================
; DECORATOR - @ prefix
; ============================================
"@" @decorator

; ============================================
; IDENTIFIERS - Generic fallback (lowest priority)
; ============================================
(id) @variable

; ============================================
; IDENTIFIERS - Contextual overrides (higher priority)
; ============================================

; The identifier after @ (scope reference)
(at_id
  (id) @module)

; Property access after dot in member expressions
(member_expression
  (id) @variable)

; Mapping keys are function-colored (action names, section headers)
(mapping_element
  key: (key
    (id) @key))

; With-statement parameter names use variable color
(with_statement
  param: (id) @variable)

; ============================================
; TOP-LEVEL BLOCK KEYWORDS (highest priority)
; ============================================

; Block keywords (system, config, topic, etc.) — first id in root-level keys
(source_file
  (mapping
    (mapping_element
      key: (key . (id) @keyword.block))))

; Block names for named collections (e.g., "greeting" in "topic greeting:")
(source_file
  (mapping
    (mapping_element
      key: (key (id) (id) @keyword.block.name))))
