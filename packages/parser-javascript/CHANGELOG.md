# @agentscript/parser-ts

## 2.3.6

### Patch Changes

- Fix `@outputs` reference and completion resolution inside nested `run @actions.X` blocks so they resolve against the nested run target rather than the enclosing reasoning action binding. Add `integer` and `long` scalar-to-ParameterDataType mappings for action parameters. Fix template literal indentation handling in the JavaScript lexer.

## 2.3.5

### Patch Changes

- Fix parsing of block scalar templates (`|`): correctly compute indent level of the pipe line, track brace depth inside `{!...}` expressions so nested braces (e.g. JSON objects) don't prematurely close the expression, allow string tokenization inside template expressions, and treat `#` as a comment only outside the template content area.

## 2.3.4

### Patch Changes

- Lint for connected subagents, improve var linting, disallow LLM inputs in router nodes
- Updated dependencies
  - @agentscript/types@0.2.1

## 2.3.3

### Patch Changes

- Fix multiline template continuation lines starting with `#` being incorrectly tokenized as comments instead of template content. Any text indented beyond `|` is now correctly treated as part of the template.

## 2.3.2

### Patch Changes

- Revert rename (`tool_definitions` back to `actions`, `tools` back to `actions` in reasoning blocks). Add support for discriminant-based polymorphic variants via `.discriminant()` on block factories. Refactor `block.ts` into focused modules (block-factory, named-block-factory, typed-map-factory, collection-block-factory, factory-utils). Fix variant type propagation through `InferFieldType` and collection factories. Improve comment attachment parity with tree-sitter parser.

## 2.3.1

### Patch Changes

- Add wildcard `additional_parameter__*` support so arbitrary config fields matching the prefix are accepted without explicit schema entries. Introduce a dedicated `StartAgentBlock` type distinct from `SubagentBlock` for proper type discrimination. Simplify the parser-javascript lexer.

## 2.3.0

### Minor Changes

- New features (2026-03-31)

### Patch Changes

- Updated dependencies
  - @agentscript/types@0.2.0

## 0.1.1

### Patch Changes

- Replace tree-sitter with a hand-written TypeScript parser (`@agentscript/parser-ts`) for parsing AgentScript files. This eliminates the native/WASM dependency on tree-sitter, enabling simpler builds, faster startup, and consistent behavior across Node.js and browser environments. Add `@agentscript/types` as a shared foundational types package. Update all downstream packages (language, compiler, dialects, LSP, Monaco, CLI, SDK) to consume the new parser-ts CST format. Add new lint passes for complex data types, config validation, and variable validation in the Agentforce dialect.
- Updated dependencies
  - @agentscript/types@0.1.1
