# @agentscript/language

## 2.4.7

### Patch Changes

- Add unused-variable lint warning that flags declared variables never referenced in the document, with a quick-fix code action in the LSP to remove the declaration.

## 2.4.6

### Patch Changes

- Detect self-referencing reasoning actions in undefined-reference validation. Entries like `CloseCase: @actions.CloseCase` inside `reasoning.actions` no longer incorrectly resolve against themselves; they are now validated against the parent topic's action definitions.

## 2.4.5

### Patch Changes

- Lint for connected subagents, improve var linting, disallow LLM inputs in router nodes
- Updated dependencies
  - @agentscript/types@0.2.1

## 2.4.4

### Patch Changes

- Revert rename (`tool_definitions` back to `actions`, `tools` back to `actions` in reasoning blocks). Add support for discriminant-based polymorphic variants via `.discriminant()` on block factories. Refactor `block.ts` into focused modules (block-factory, named-block-factory, typed-map-factory, collection-block-factory, factory-utils). Fix variant type propagation through `InferFieldType` and collection factories. Improve comment attachment parity with tree-sitter parser.

## 2.4.3

### Patch Changes

- Fix ellipsis emission in `WithClause` so programmatically constructed nodes correctly emit `= ...` instead of omitting the value. Remove unnecessary `StringLiteral`-only restriction from `ConnectedSubagentBlock` string fields to support multi-line strings.

## 2.4.2

### Patch Changes

- SOMA multi-line string language support

## 2.4.1

### Patch Changes

- Add wildcard `additional_parameter__*` support so arbitrary config fields matching the prefix are accepted without explicit schema entries. Introduce a dedicated `StartAgentBlock` type distinct from `SubagentBlock` for proper type discrimination. Simplify the parser-javascript lexer.

## 2.4.0

### Minor Changes

- New features (2026-03-31)

### Patch Changes

- Updated dependencies
  - @agentscript/types@0.2.0

## 2.3.3

### Patch Changes

- Fix TemplateText indentation by moving dedent and blank-line normalization into parse-time `dedentTemplateParts()`, so the compiler and emit methods receive ready-to-use content without further stripping. Remove the now-unnecessary `dedentTemplate` utility from the compiler. Add `spaceAfterPipe` flag to preserve `| ` formatting during round-trips.

## 2.3.2

### Patch Changes

- Add dedicated ActionBlock, ActionsBlock, ReasoningActionBlock, and ReasoningActionsBlock types for topic-style block definitions, preserving legacy \_\_kind values and 'action' scopeAlias separately from the subagent-style ToolDefinitionBlock/ToolBlock types.

## 2.3.1

### Patch Changes

- Replace tree-sitter with a hand-written TypeScript parser (`@agentscript/parser-ts`) for parsing AgentScript files. This eliminates the native/WASM dependency on tree-sitter, enabling simpler builds, faster startup, and consistent behavior across Node.js and browser environments. Add `@agentscript/types` as a shared foundational types package. Update all downstream packages (language, compiler, dialects, LSP, Monaco, CLI, SDK) to consume the new parser-ts CST format. Add new lint passes for complex data types, config validation, and variable validation in the Agentforce dialect.
- Updated dependencies
  - @agentscript/types@0.1.1

## 2.3.0

### Minor Changes

- Add support for renamed blocks: topic => subagent, topic.actions => tool_definitions, topic.reasoning.actions => tools

## 2.2.11

### Patch Changes

- Fix emitComponent incorrectly prefixing ActionBlock kind to action entry names. Fix diagnostic deduplication by scoping `__diagnostics` on collection and typed-map nodes to own-level diagnostics only. Allow reserved words (e.g. `date`) when used as quoted keys.

## 2.2.10

### Patch Changes

- Allow reserved words (e.g. `date`) as field names when quoted and fix duplicate diagnostics in `collectDiagnostics` tree walk by storing only own-level diagnostics on each AST node.

## 2.2.9

### Patch Changes

- Reclassify True, False, None, and "to" as keywords in syntax highlighting. Simplify child classes in language package by replacing private backing fields with public properties. Update light theme colors for improved contrast and consistency.

## 2.2.8

### Patch Changes

- Add `nameRange` to reference occurrences for accurate rename symbol support, fix scope resolution to prioritize outer definitions over nested bindings, and switch lsp-browser to a self-contained esbuild bundle.

## 2.2.7

### Patch Changes

- 86b39c2: Refactor LSP into a modular architecture with dialect registry, automatic dialect detection via annotations, and separated browser/node server packages. Add smart indentation on Enter, enhanced completions with dialect-aware suggestions, semantic token highlighting, code actions, and a new Monaco theme module. Fix various completions bugs including nested completions and colon highlighting.

## 2.2.6

### Patch Changes

- Add connected agent block type with compilation, lint rules, and validation support. Connected agents can be invoked as tools with bound inputs, and include lint rules preventing invalid transitions and enforcing input validation. Also adds block capability declarations (invokable, transferable) and resolved type constraints to the language package.

## 2.2.5

### Patch Changes

- Add LSP server package with hover, completion, definition, references, rename, code actions, semantic tokens, and document/workspace symbols support. Add snippet generation and enhanced completions to the language package. Add component-kind classification and semantic token support to the agentforce package. Remove inbound_model and outbound_model voice settings from the agentforce dialect and compiler.

## 2.2.4

### Patch Changes

- Add shared LSP package with hover, completion, definition, references, rename, code actions, semantic tokens, and document symbols providers. Enhance language package with snippet generation and improved completions. Add component-kind classification and semantic token support to agentforce package. Remove deprecated voice modality inbound_model and outbound_model fields.

## 2.2.3

### Patch Changes

- Add `parseComponentDebug` API and component kind registry to agentforce package, moving component parsing logic out of the UI. Enhance language dialect to parse colinear untyped fields as structured `FieldChild` nodes with expression values and improve document symbol extraction for field children.

## 2.2.2

### Patch Changes

- Refactor block system to introduce CollectionBlock as a first-class field type, replacing the dual NamedBlock/NamedFieldType pattern. NamedBlock is no longer a FieldType — it is now the entry type inside a CollectionBlock. Remove `NamedMapLike`, `NamedFieldType`, and `VariantNamedBlockFactory` exports from `@agentscript/language` in favor of `CollectionBlock`, `CollectionBlockFactory`, `CollectionBlockInstance`, and `isCollectionFieldType`. The `__fieldKind` discriminator value `'NamedBlock'` is replaced by `'Collection'`.

## 2.2.1

### Patch Changes

- Add `mutateComponent()` for in-place block mutation with helpers for field removal and NamedMap add/remove operations. Add `validateStrictSchema()` for strict schema enforcement. `emitComponent()` now auto-syncs block children before emitting, so directly assigned fields are always emitted correctly. Rename `setBlock`/`removeBlock` to `setField`/`removeField` on Document and MutationHelpers for consistency. Extract `NamedMap.forCollection()` factory and `collectionLabel()` helper to deduplicate collection label logic.

## 2.2.0

### Minor Changes

- Add browser bundling support (ESM and IIFE), `emitComponent()` API, `generateParser()` for WASM-based browser parsing, and nested `parseComponent()` paths (`topic.actions`, `topic.reasoning.actions`). Introduce `UnknownStatement` for preserving unrecognized syntax with diagnostics instead of silently dropping content, and improve ERROR node recovery by recursing into children.

## 2.1.0

### Minor Changes

- Add expression validation lint pass for function calls and operators, export `expressionValidationPass` and `BUILTIN_FUNCTIONS` from language package. Support `standardInvocableAction://` scheme in agentforce action targets. Add `append` option to `example()` builder method.
