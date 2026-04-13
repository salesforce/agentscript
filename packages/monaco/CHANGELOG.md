# @agentscript/monaco

## 2.2.9

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.4.7

## 2.2.8

### Patch Changes

- @agentscript/parser@3.0.5
- @agentscript/language@2.4.6

## 2.2.7

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.4.6

## 2.2.6

### Patch Changes

- Lint for connected subagents, improve var linting, disallow LLM inputs in router nodes
- Updated dependencies
  - @agentscript/language@2.4.5
  - @agentscript/parser@3.0.4

## 2.2.5

### Patch Changes

- @agentscript/parser@3.0.3
- @agentscript/language@2.4.4

## 2.2.4

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.4.4
  - @agentscript/parser@3.0.2

## 2.2.3

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.4.3

## 2.2.2

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.4.2

## 2.2.1

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.4.1
  - @agentscript/parser@3.0.1

## 2.2.0

### Minor Changes

- New features (2026-03-31)

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.4.0
  - @agentscript/parser@3.0.0

## 2.1.3

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.3.3

## 2.1.2

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.3.2

## 2.1.1

### Patch Changes

- Replace tree-sitter with a hand-written TypeScript parser (`@agentscript/parser-ts`) for parsing AgentScript files. This eliminates the native/WASM dependency on tree-sitter, enabling simpler builds, faster startup, and consistent behavior across Node.js and browser environments. Add `@agentscript/types` as a shared foundational types package. Update all downstream packages (language, compiler, dialects, LSP, Monaco, CLI, SDK) to consume the new parser-ts CST format. Add new lint passes for complex data types, config validation, and variable validation in the Agentforce dialect.
- Updated dependencies
  - @agentscript/parser-ts@0.1.1
  - @agentscript/language@2.3.1

## 2.1.0

### Minor Changes

- Add support for renamed blocks: topic => subagent, topic.actions => tool_definitions, topic.reasoning.actions => tools

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.3.0
  - @agentscript/parser@2.1.0

## 2.0.14

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.2.11

## 2.0.13

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.2.10

## 2.0.12

### Patch Changes

- Reclassify True, False, None, and "to" as keywords in syntax highlighting. Simplify child classes in language package by replacing private backing fields with public properties. Update light theme colors for improved contrast and consistency.
- Updated dependencies
  - @agentscript/language@2.2.9
  - @agentscript/parser@2.0.6

## 2.0.11

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.2.8

## 2.0.10

### Patch Changes

- 86b39c2: Refactor LSP into a modular architecture with dialect registry, automatic dialect detection via annotations, and separated browser/node server packages. Add smart indentation on Enter, enhanced completions with dialect-aware suggestions, semantic token highlighting, code actions, and a new Monaco theme module. Fix various completions bugs including nested completions and colon highlighting.
- Updated dependencies [86b39c2]
  - @agentscript/language@2.2.7
  - @agentscript/parser@2.0.5

## 2.0.9

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.2.6

## 2.0.8

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.2.5
  - @agentscript/parser@2.0.4

## 2.0.7

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.2.4
  - @agentscript/parser@2.0.3

## 2.0.6

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.2.3

## 2.0.5

### Patch Changes

- Refactor block system to introduce CollectionBlock as a first-class field type, replacing the dual NamedBlock/NamedFieldType pattern. NamedBlock is no longer a FieldType — it is now the entry type inside a CollectionBlock. Remove `NamedMapLike`, `NamedFieldType`, and `VariantNamedBlockFactory` exports from `@agentscript/language` in favor of `CollectionBlock`, `CollectionBlockFactory`, `CollectionBlockInstance`, and `isCollectionFieldType`. The `__fieldKind` discriminator value `'NamedBlock'` is replaced by `'Collection'`.
- Updated dependencies
  - @agentscript/language@2.2.2
  - @agentscript/parser@2.0.2

## 2.0.4

### Patch Changes

- Updated dependencies
  - @agentscript/parser@2.0.1
  - @agentscript/language@2.2.1

## 2.0.3

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.2.1

## 2.0.2

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.2.0

## 2.0.1

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.1.0
