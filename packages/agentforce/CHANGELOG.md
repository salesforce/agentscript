# @agentscript/agentforce

## 2.5.14

### Patch Changes

- Updated dependencies
  - @agentscript/compiler@2.4.13

## 2.5.13

### Patch Changes

- Updated dependencies
  - @agentscript/compiler@2.4.12

## 2.5.12

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.4.7
  - @agentscript/agentforce-dialect@2.7.10
  - @agentscript/compiler@2.4.11

## 2.5.11

### Patch Changes

- @agentscript/parser@3.0.5
- @agentscript/agentforce-dialect@2.7.9
- @agentscript/compiler@2.4.10
- @agentscript/language@2.4.6

## 2.5.10

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.4.6
  - @agentscript/agentforce-dialect@2.7.8
  - @agentscript/compiler@2.4.9

## 2.5.9

### Patch Changes

- Lint for connected subagents, improve var linting, disallow LLM inputs in router nodes
- Updated dependencies
  - @agentscript/agentforce-dialect@2.7.7
  - @agentscript/compiler@2.4.8
  - @agentscript/language@2.4.5
  - @agentscript/parser@3.0.4
  - @agentscript/types@0.2.1

## 2.5.8

### Patch Changes

- Set default values from references during compilation
- Updated dependencies
  - @agentscript/compiler@2.4.7

## 2.5.7

### Patch Changes

- @agentscript/parser@3.0.3
- @agentscript/agentforce-dialect@2.7.6
- @agentscript/compiler@2.4.6
- @agentscript/language@2.4.4

## 2.5.6

### Patch Changes

- Router nodes can only include transitions
- Updated dependencies
  - @agentscript/compiler@2.4.5
  - @agentscript/agentforce-dialect@2.7.5

## 2.5.5

### Patch Changes

- Revert rename (`tool_definitions` back to `actions`, `tools` back to `actions` in reasoning blocks). Add support for discriminant-based polymorphic variants via `.discriminant()` on block factories. Refactor `block.ts` into focused modules (block-factory, named-block-factory, typed-map-factory, collection-block-factory, factory-utils). Fix variant type propagation through `InferFieldType` and collection factories. Improve comment attachment parity with tree-sitter parser.
- Updated dependencies
  - @agentscript/language@2.4.4
  - @agentscript/agentforce-dialect@2.7.4
  - @agentscript/compiler@2.4.4
  - @agentscript/parser@3.0.2

## 2.5.4

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.4.3
  - @agentscript/agentforce-dialect@2.7.3
  - @agentscript/compiler@2.4.3

## 2.5.3

### Patch Changes

- SOMA multi-line string language support
- Updated dependencies
  - @agentscript/agentforce-dialect@2.7.2
  - @agentscript/language@2.4.2
  - @agentscript/compiler@2.4.2

## 2.5.2

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.4.1
  - @agentscript/compiler@2.4.1
  - @agentscript/agentforce-dialect@2.7.1
  - @agentscript/parser@3.0.1

## 2.5.1

### Patch Changes

- Updated dependencies
  - @agentscript/agentforce-dialect@2.7.0
  - @agentscript/compiler@2.4.1

## 2.5.0

### Minor Changes

- New features (2026-03-31)

### Patch Changes

- Updated dependencies
  - @agentscript/agentforce-dialect@2.6.0
  - @agentscript/compiler@2.3.0
  - @agentscript/language@2.4.0
  - @agentscript/parser@3.0.0
  - @agentscript/types@0.2.0

## 2.4.4

### Patch Changes

- Updated dependencies
  - @agentscript/agentforce-dialect@2.5.4
  - @agentscript/compiler@2.2.6

## 2.4.3

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.3.3
  - @agentscript/compiler@2.2.5
  - @agentscript/agentforce-dialect@2.5.3

## 2.4.2

### Patch Changes

- Add dedicated ActionBlock, ActionsBlock, ReasoningActionBlock, and ReasoningActionsBlock types for topic-style block definitions, preserving legacy \_\_kind values and 'action' scopeAlias separately from the subagent-style ToolDefinitionBlock/ToolBlock types.
- Updated dependencies
  - @agentscript/language@2.3.2
  - @agentscript/agentforce-dialect@2.5.2
  - @agentscript/compiler@2.2.4

## 2.4.1

### Patch Changes

- Updated dependencies
  - @agentscript/agentforce-dialect@2.5.1
  - @agentscript/compiler@2.2.3

## 2.4.0

### Minor Changes

- support for generatePromptResponse:// prefix in URI schema

### Patch Changes

- Updated dependencies
  - @agentscript/agentforce-dialect@2.5.0
  - @agentscript/compiler@2.2.2

## 2.3.1

### Patch Changes

- Replace tree-sitter with a hand-written TypeScript parser (`@agentscript/parser-ts`) for parsing AgentScript files. This eliminates the native/WASM dependency on tree-sitter, enabling simpler builds, faster startup, and consistent behavior across Node.js and browser environments. Add `@agentscript/types` as a shared foundational types package. Update all downstream packages (language, compiler, dialects, LSP, Monaco, CLI, SDK) to consume the new parser-ts CST format. Add new lint passes for complex data types, config validation, and variable validation in the Agentforce dialect.
- Updated dependencies
  - @agentscript/parser-ts@0.1.1
  - @agentscript/types@0.1.1
  - @agentscript/language@2.3.1
  - @agentscript/compiler@2.2.1
  - @agentscript/agentforce-dialect@2.4.1

## 2.3.0

### Minor Changes

- Add support for renamed blocks: topic => subagent, topic.actions => tool_definitions, topic.reasoning.actions => tools

### Patch Changes

- Updated dependencies
  - @agentscript/agentforce-dialect@2.4.0
  - @agentscript/compiler@2.2.0
  - @agentscript/language@2.3.0

## 2.2.0

### Minor Changes

- Add target property for connected agent blocks, compile to updated schema

### Patch Changes

- Updated dependencies
  - @agentscript/agentforce-dialect@2.3.0
  - @agentscript/compiler@2.1.0

## 2.1.16

### Patch Changes

- Updated dependencies
  - @agentscript/agentforce-dialect@2.2.13
  - @agentscript/compiler@2.0.17

## 2.1.15

### Patch Changes

- Updated dependencies
  - @agentscript/agentforce-dialect@2.2.12
  - @agentscript/compiler@2.0.16

## 2.1.14

### Patch Changes

- Fix emitComponent incorrectly prefixing ActionBlock kind to action entry names. Fix diagnostic deduplication by scoping `__diagnostics` on collection and typed-map nodes to own-level diagnostics only. Allow reserved words (e.g. `date`) when used as quoted keys.
- Updated dependencies
  - @agentscript/language@2.2.11
  - @agentscript/agentforce-dialect@2.2.11
  - @agentscript/compiler@2.0.15

## 2.1.13

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.2.10
  - @agentscript/agentforce-dialect@2.2.10
  - @agentscript/compiler@2.0.14

## 2.1.12

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.2.9
  - @agentscript/agentforce-dialect@2.2.9
  - @agentscript/compiler@2.0.13

## 2.1.11

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.2.8
  - @agentscript/agentforce-dialect@2.2.8
  - @agentscript/compiler@2.0.12

## 2.1.10

### Patch Changes

- Move WASM sourceMappingURL stripping from runtime to build time so the custom section is removed once during the build rather than on every initialization.

## 2.1.9

### Patch Changes

- 86b39c2: Refactor LSP into a modular architecture with dialect registry, automatic dialect detection via annotations, and separated browser/node server packages. Add smart indentation on Enter, enhanced completions with dialect-aware suggestions, semantic token highlighting, code actions, and a new Monaco theme module. Fix various completions bugs including nested completions and colon highlighting.
- Updated dependencies [86b39c2]
  - @agentscript/language@2.2.7
  - @agentscript/agentforce-dialect@2.2.7
  - @agentscript/compiler@2.0.11

## 2.1.8

### Patch Changes

- Add connected agent block type with compilation, lint rules, and validation support. Connected agents can be invoked as tools with bound inputs, and include lint rules preventing invalid transitions and enforcing input validation. Also adds block capability declarations (invokable, transferable) and resolved type constraints to the language package.
- Updated dependencies
  - @agentscript/language@2.2.6
  - @agentscript/agentforce-dialect@2.2.6
  - @agentscript/compiler@2.0.10

## 2.1.7

### Patch Changes

- Add LSP server package with hover, completion, definition, references, rename, code actions, semantic tokens, and document/workspace symbols support. Add snippet generation and enhanced completions to the language package. Add component-kind classification and semantic token support to the agentforce package. Remove inbound_model and outbound_model voice settings from the agentforce dialect and compiler.
- Updated dependencies
  - @agentscript/language@2.2.5
  - @agentscript/compiler@2.0.9
  - @agentscript/agentforce-dialect@2.2.5

## 2.1.6

### Patch Changes

- Add shared LSP package with hover, completion, definition, references, rename, code actions, semantic tokens, and document symbols providers. Enhance language package with snippet generation and improved completions. Add component-kind classification and semantic token support to agentforce package. Remove deprecated voice modality inbound_model and outbound_model fields.
- Updated dependencies
  - @agentscript/language@2.2.4
  - @agentscript/compiler@2.0.8
  - @agentscript/agentforce-dialect@2.2.4

## 2.1.5

### Patch Changes

- Add `parseComponentDebug` API and component kind registry to agentforce package, moving component parsing logic out of the UI. Enhance language dialect to parse colinear untyped fields as structured `FieldChild` nodes with expression values and improve document symbol extraction for field children.
- Updated dependencies
  - @agentscript/language@2.2.3
  - @agentscript/agentforce-dialect@2.2.3
  - @agentscript/compiler@2.0.7

## 2.1.4

### Patch Changes

- Refactor block system to introduce CollectionBlock as a first-class field type, replacing the dual NamedBlock/NamedFieldType pattern. NamedBlock is no longer a FieldType — it is now the entry type inside a CollectionBlock. Remove `NamedMapLike`, `NamedFieldType`, and `VariantNamedBlockFactory` exports from `@agentscript/language` in favor of `CollectionBlock`, `CollectionBlockFactory`, `CollectionBlockInstance`, and `isCollectionFieldType`. The `__fieldKind` discriminator value `'NamedBlock'` is replaced by `'Collection'`.
- Updated dependencies
  - @agentscript/language@2.2.2
  - @agentscript/compiler@2.0.6
  - @agentscript/agentforce-dialect@2.2.2

## 2.1.3

### Patch Changes

- Bundle agentforce package with new compile and parser modules, add lint passes for connection validation, hyperclassifier, and system message variables to the agentforce dialect, and port Python compiler tests to TypeScript with new modality compilation and action type resolution support.
- Updated dependencies
  - @agentscript/agentforce-dialect@2.2.1
  - @agentscript/compiler@2.0.5
  - @agentscript/language@2.2.1

## 2.1.2

### Patch Changes

- Updated dependencies
  - @agentscript/agentforce-dialect@2.2.0

## 2.1.1

### Patch Changes

- Add `mutateComponent()` for in-place block mutation with helpers for field removal and NamedMap add/remove operations. Add `validateStrictSchema()` for strict schema enforcement. `emitComponent()` now auto-syncs block children before emitting, so directly assigned fields are always emitted correctly. Rename `setBlock`/`removeBlock` to `setField`/`removeField` on Document and MutationHelpers for consistency. Extract `NamedMap.forCollection()` factory and `collectionLabel()` helper to deduplicate collection label logic.
- Updated dependencies
  - @agentscript/language@2.2.1
  - @agentscript/agentforce-dialect@2.1.2

## 2.1.0

### Minor Changes

- Add browser bundling support (ESM and IIFE), `emitComponent()` API, `generateParser()` for WASM-based browser parsing, and nested `parseComponent()` paths (`topic.actions`, `topic.reasoning.actions`). Introduce `UnknownStatement` for preserving unrecognized syntax with diagnostics instead of silently dropping content, and improve ERROR node recovery by recursing into children.

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.2.0
  - @agentscript/agentforce-dialect@2.1.1

## 2.0.1

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.1.0
  - @agentscript/agentforce-dialect@2.1.0
