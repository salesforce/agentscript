# @agentscript/parser

## 2.3.2

### Patch Changes

- Lint for connected subagents, improve var linting, disallow LLM inputs in router nodes

## 2.3.1

### Patch Changes

- Revert rename (`tool_definitions` back to `actions`, `tools` back to `actions` in reasoning blocks). Add support for discriminant-based polymorphic variants via `.discriminant()` on block factories. Refactor `block.ts` into focused modules (block-factory, named-block-factory, typed-map-factory, collection-block-factory, factory-utils). Fix variant type propagation through `InferFieldType` and collection factories. Improve comment attachment parity with tree-sitter parser.

## 2.3.0

### Minor Changes

- New features (2026-03-31)

## 2.1.1

### Patch Changes

- Replace tree-sitter with a hand-written TypeScript parser (`@agentscript/parser-ts`) for parsing AgentScript files. This eliminates the native/WASM dependency on tree-sitter, enabling simpler builds, faster startup, and consistent behavior across Node.js and browser environments. Add `@agentscript/types` as a shared foundational types package. Update all downstream packages (language, compiler, dialects, LSP, Monaco, CLI, SDK) to consume the new parser-ts CST format. Add new lint passes for complex data types, config validation, and variable validation in the Agentforce dialect.

## 2.1.0

### Minor Changes

- Add support for renamed blocks: topic => subagent, topic.actions => tool_definitions, topic.reasoning.actions => tools

## 2.0.6

### Patch Changes

- Reclassify True, False, None, and "to" as keywords in syntax highlighting. Simplify child classes in language package by replacing private backing fields with public properties. Update light theme colors for improved contrast and consistency.

## 2.0.5

### Patch Changes

- 86b39c2: Refactor LSP into a modular architecture with dialect registry, automatic dialect detection via annotations, and separated browser/node server packages. Add smart indentation on Enter, enhanced completions with dialect-aware suggestions, semantic token highlighting, code actions, and a new Monaco theme module. Fix various completions bugs including nested completions and colon highlighting.

## 2.0.4

### Patch Changes

- Add LSP server package with hover, completion, definition, references, rename, code actions, semantic tokens, and document/workspace symbols support. Add snippet generation and enhanced completions to the language package. Add component-kind classification and semantic token support to the agentforce package. Remove inbound_model and outbound_model voice settings from the agentforce dialect and compiler.

## 2.0.3

### Patch Changes

- Add shared LSP package with hover, completion, definition, references, rename, code actions, semantic tokens, and document symbols providers. Enhance language package with snippet generation and improved completions. Add component-kind classification and semantic token support to agentforce package. Remove deprecated voice modality inbound_model and outbound_model fields.

## 2.0.2

### Patch Changes

- Refactor block system to introduce CollectionBlock as a first-class field type, replacing the dual NamedBlock/NamedFieldType pattern. NamedBlock is no longer a FieldType — it is now the entry type inside a CollectionBlock. Remove `NamedMapLike`, `NamedFieldType`, and `VariantNamedBlockFactory` exports from `@agentscript/language` in favor of `CollectionBlock`, `CollectionBlockFactory`, `CollectionBlockInstance`, and `isCollectionFieldType`. The `__fieldKind` discriminator value `'NamedBlock'` is replaced by `'Collection'`.

## 2.0.1

### Patch Changes

- Bundle agentforce package with new compile and parser modules, add lint passes for connection validation, hyperclassifier, and system message variables to the agentforce dialect, and port Python compiler tests to TypeScript with new modality compilation and action type resolution support.
