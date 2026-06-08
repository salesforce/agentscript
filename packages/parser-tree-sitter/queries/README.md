# AgentScript Syntax Highlighting

This directory contains Tree-sitter query files for syntax highlighting AgentScript files.

## Files

### `highlights.scm`

The main highlighting query file that defines how different syntax elements should be highlighted.

#### Capture Groups

The query uses standard Tree-sitter capture names that can be mapped to colors:

- **Keywords**: `@keyword` - Control flow (`if`, `elif`, `else`, `run`, `set`, `with`, `as`, `to`, `available`, `when`)
- **Keyword Modifiers**: `@keyword.modifier` - Variable modifiers (`mutable`, `linked`)
- **Types**: `@type.builtin` - Built-in types (`string`, `number`, `boolean`, `object`, `list`)
- **Block Types**: `@type` - Custom block types (e.g., `topic`, `config`)
- **Functions**: `@function` - Action references and function calls
  - `@function.builtin` - Built-in functions like `len()`
- **Namespace**: `@namespace` - **Only** the scope part in `@` references (e.g., `variable` in `@variable.counter`, `action` in `@action.Process`, `topic` in `@topic.next`)
- **Properties**: `@property` - Field names, keys in blocks, and properties after dots in references
- **Operators**: `@operator` - Arithmetic and comparison operators
- **Punctuation**:
  - `@punctuation.delimiter` - Structural punctuation (`:`, `.`, `()`, `[]`, `{}`)
  - `@punctuation.special` - Special syntax (`->`, `|`, `{{`, `}}`, `@`)
- **Strings**: `@string` - String literals and template text
  - `@string.escape` - Escape sequences
- **Numbers**: `@number` - Numeric literals
- **Booleans**: `@boolean` - `True`/`False`/`true`/`false`
- **Constants**: `@constant.builtin` - Built-in constants like `null`
- **Comments**: `@comment` - Single-line comments starting with `#`

## Usage

### Command Line

To highlight a file using the Tree-sitter CLI:

```bash
tree-sitter highlight path/to/file.agent
```

To check highlighting captures:

```bash
tree-sitter highlight path/to/file.agent --check
```

### In Applications

When using tree-sitter-highlight library (C or Rust), the highlight query is automatically loaded from this file. Map the capture names above to colors in your application's theme.

## Testing

Syntax highlighting tests are located in `../test/highlight/`. These files contain AgentScript code with special comment assertions that indicate expected highlighting.

Example test format:

```agentscript
topic main_topic:
# <- type
#     ^ namespace
    description: "test"
#   ^ property
#                ^ string
```

The test assertions use:

- `# <- capture_name` - Tests the capture at the start of the comment
- `# ^ capture_name` - Tests the capture at the indicated column

Run tests with:

```bash
tree-sitter highlight test/highlight/complete.agent --check
```

## Theme Configuration

The Tree-sitter CLI uses colors defined in `~/.config/tree-sitter/config.json`. Example theme:

```json
{
  "theme": {
    "keyword": 56,
    "type": 23,
    "type.builtin": { "bold": true, "color": 23 },
    "function": 26,
    "property": 124,
    "variable": 252,
    "operator": { "bold": true, "color": 239 },
    "punctuation": 239,
    "punctuation.special": 239,
    "string": 28,
    "number": { "bold": true, "color": 94 },
    "boolean": { "bold": true, "color": 94 },
    "comment": { "color": 245, "italic": true },
    "keyword.modifier": 56
  }
}
```

## Custom Captures

Some capture names are custom to AgentScript:

- `@keyword.modifier` - For `mutable` and `linked` modifiers
- `@namespace` - For block keys and reference scopes (the part after `@` before the first `.`)

These may show as "non-standard" in warnings but are fully functional.

## Visual Distinction

The highlighting system provides clear visual distinction for different parts of variable references:

```agentscript
@variable.counter
 ^       ^
 |       └─ property (red)
 └───────── namespace (bold orange)

@action.DoSomething
 ^      ^
 |      └─ property (red)
 └────────── namespace (bold orange)
```

This makes it easy to distinguish between the scope/namespace (`variable`, `action`, `topic`, etc.) and the actual properties or methods being accessed.
