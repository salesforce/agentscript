# @agentscript/compiler

## 2.4.18

### Patch Changes

- Fix default value compilation for object and list state variables. Dict literal defaults now populate the `default` field with their actual entries instead of emitting an empty `{}`, list defaults preserve their elements, and dict keys parse as `StringLiteral` nodes instead of quoted `Identifier`s.
- Updated dependencies
  - @agentscript/language@2.4.10
  - @agentscript/agentforce-dialect@2.7.13

## 2.4.17

### Patch Changes

- Fix `@outputs` reference and completion resolution inside nested `run @actions.X` blocks so they resolve against the nested run target rather than the enclosing reasoning action binding. Add `integer` and `long` scalar-to-ParameterDataType mappings for action parameters. Fix template literal indentation handling in the JavaScript lexer.
- Updated dependencies
  - @agentscript/language@2.4.9
  - @agentscript/agentforce-dialect@2.7.12
  - @agentscript/parser@3.0.6

## 2.4.16

### Patch Changes

- @agentscript/agentforce-dialect@2.7.11

## 2.4.15

### Patch Changes

- Switch locale validation in the modality compiler to use the `supportedLocale` zod enum from the generated agent-dsl schema, replacing the hand-maintained `VALID_LOCALES` set and removing the `sync:locales` sync script.

## 2.4.14

### Patch Changes

- Disallow supervision tools with hyper-clf

## 2.4.13

### Patch Changes

- Support compiling system instructions like reasoning instructions

## 2.4.12

### Patch Changes

- Add security block compilation support for verified_customer_record_access with use_default_objects and additional_objects fields.

## 2.4.11

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.4.7
  - @agentscript/agentforce-dialect@2.7.10

## 2.4.10

### Patch Changes

- @agentscript/parser@3.0.5
- @agentscript/agentforce-dialect@2.7.9
- @agentscript/language@2.4.6

## 2.4.9

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.4.6
  - @agentscript/agentforce-dialect@2.7.8

## 2.4.8

### Patch Changes

- Lint for connected subagents, improve var linting, disallow LLM inputs in router nodes
- Updated dependencies
  - @agentscript/agentforce-dialect@2.7.7
  - @agentscript/language@2.4.5
  - @agentscript/parser@3.0.4
  - @agentscript/types@0.2.1

## 2.4.7

### Patch Changes

- Set default values from references during compilation

## 2.4.6

### Patch Changes

- @agentscript/parser@3.0.3
- @agentscript/agentforce-dialect@2.7.6
- @agentscript/language@2.4.4

## 2.4.5

### Patch Changes

- Router nodes can only include transitions
  - @agentscript/agentforce-dialect@2.7.5

## 2.4.4

### Patch Changes

- Revert rename (`tool_definitions` back to `actions`, `tools` back to `actions` in reasoning blocks). Add support for discriminant-based polymorphic variants via `.discriminant()` on block factories. Refactor `block.ts` into focused modules (block-factory, named-block-factory, typed-map-factory, collection-block-factory, factory-utils). Fix variant type propagation through `InferFieldType` and collection factories. Improve comment attachment parity with tree-sitter parser.
- Updated dependencies
  - @agentscript/language@2.4.4
  - @agentscript/agentforce-dialect@2.7.4
  - @agentscript/parser@3.0.2

## 2.4.3

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.4.3
  - @agentscript/agentforce-dialect@2.7.3

## 2.4.2

### Patch Changes

- Updated dependencies
  - @agentscript/agentforce-dialect@2.7.2
  - @agentscript/language@2.4.2

## 2.4.1

### Patch Changes

- Merge PR #178 generated schema updates: add ContextConfiguration and MemoryConfiguration types from OpenAPI schema, replace custom AgentContext types with generated equivalents, and use contextConfigurationSchema for validation. Context block compiles under agent_version instead of top-level output.
- Add wildcard `additional_parameter__*` support so arbitrary config fields matching the prefix are accepted without explicit schema entries. Introduce a dedicated `StartAgentBlock` type distinct from `SubagentBlock` for proper type discrimination. Simplify the parser-javascript lexer.
- Updated dependencies
  - @agentscript/language@2.4.1
  - @agentscript/agentforce-dialect@2.7.1
  - @agentscript/parser@3.0.1

## 2.4.0

### Minor Changes

- Add dedicated `StartAgentBlock` type distinct from `SubagentBlock` so that `start_agent` blocks produce a unique `__kind` for type discrimination. Refactor shared subagent fields into a common base and update the compiler's `ParsedTopicLike` union to include the new type.

### Patch Changes

- Updated dependencies
  - @agentscript/agentforce-dialect@2.7.0

## 2.3.0

### Minor Changes

- New features (2026-03-31)

### Patch Changes

- Updated dependencies
  - @agentscript/agentforce-dialect@2.6.0
  - @agentscript/language@2.4.0
  - @agentscript/parser@3.0.0
  - @agentscript/types@0.2.0

## 2.2.6

### Patch Changes

- Updated dependencies
  - @agentscript/agentforce-dialect@2.5.4

## 2.2.5

### Patch Changes

- Fix TemplateText indentation by moving dedent and blank-line normalization into parse-time `dedentTemplateParts()`, so the compiler and emit methods receive ready-to-use content without further stripping. Remove the now-unnecessary `dedentTemplate` utility from the compiler. Add `spaceAfterPipe` flag to preserve `| ` formatting during round-trips.
- Updated dependencies
  - @agentscript/language@2.3.3
  - @agentscript/agentforce-dialect@2.5.3

## 2.2.4

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.3.2
  - @agentscript/agentforce-dialect@2.5.2

## 2.2.3

### Patch Changes

- Add support for context block, compiles to context
- Updated dependencies
  - @agentscript/agentforce-dialect@2.5.1

## 2.2.2

### Patch Changes

- Updated dependencies
  - @agentscript/agentforce-dialect@2.5.0

## 2.2.1

### Patch Changes

- Replace tree-sitter with a hand-written TypeScript parser (`@agentscript/parser-ts`) for parsing AgentScript files. This eliminates the native/WASM dependency on tree-sitter, enabling simpler builds, faster startup, and consistent behavior across Node.js and browser environments. Add `@agentscript/types` as a shared foundational types package. Update all downstream packages (language, compiler, dialects, LSP, Monaco, CLI, SDK) to consume the new parser-ts CST format. Add new lint passes for complex data types, config validation, and variable validation in the Agentforce dialect.
- Updated dependencies
  - @agentscript/parser-ts@0.1.1
  - @agentscript/types@0.1.1
  - @agentscript/language@2.3.1
  - @agentscript/agentforce-dialect@2.4.1

## 2.2.0

### Minor Changes

- Add support for renamed blocks: topic => subagent, topic.actions => tool_definitions, topic.reasoning.actions => tools

### Patch Changes

- Updated dependencies
  - @agentscript/agentforce-dialect@2.4.0
  - @agentscript/language@2.3.0

## 2.1.0

### Minor Changes

- Add target property for connected agent blocks, compile to updated schema

### Patch Changes

- Updated dependencies
  - @agentscript/agentforce-dialect@2.3.0

## 2.0.17

### Patch Changes

- Updated dependencies
  - @agentscript/agentforce-dialect@2.2.13

## 2.0.16

### Patch Changes

- Updated dependencies
  - @agentscript/agentforce-dialect@2.2.12

## 2.0.15

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.2.11
  - @agentscript/agentforce-dialect@2.2.11

## 2.0.14

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.2.10
  - @agentscript/agentforce-dialect@2.2.10

## 2.0.13

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.2.9
  - @agentscript/agentforce-dialect@2.2.9

## 2.0.12

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.2.8
  - @agentscript/agentforce-dialect@2.2.8

## 2.0.11

### Patch Changes

- Updated dependencies [86b39c2]
  - @agentscript/language@2.2.7
  - @agentscript/agentforce-dialect@2.2.7

## 2.0.10

### Patch Changes

- Add connected agent block type with compilation, lint rules, and validation support. Connected agents can be invoked as tools with bound inputs, and include lint rules preventing invalid transitions and enforcing input validation. Also adds block capability declarations (invokable, transferable) and resolved type constraints to the language package.
- Updated dependencies
  - @agentscript/language@2.2.6
  - @agentscript/agentforce-dialect@2.2.6

## 2.0.9

### Patch Changes

- Add LSP server package with hover, completion, definition, references, rename, code actions, semantic tokens, and document/workspace symbols support. Add snippet generation and enhanced completions to the language package. Add component-kind classification and semantic token support to the agentforce package. Remove inbound_model and outbound_model voice settings from the agentforce dialect and compiler.
- Updated dependencies
  - @agentscript/language@2.2.5
  - @agentscript/agentforce-dialect@2.2.5

## 2.0.8

### Patch Changes

- Add shared LSP package with hover, completion, definition, references, rename, code actions, semantic tokens, and document symbols providers. Enhance language package with snippet generation and improved completions. Add component-kind classification and semantic token support to agentforce package. Remove deprecated voice modality inbound_model and outbound_model fields.
- Updated dependencies
  - @agentscript/language@2.2.4
  - @agentscript/agentforce-dialect@2.2.4

## 2.0.7

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.2.3
  - @agentscript/agentforce-dialect@2.2.3

## 2.0.6

### Patch Changes

- Refactor block system to introduce CollectionBlock as a first-class field type, replacing the dual NamedBlock/NamedFieldType pattern. NamedBlock is no longer a FieldType — it is now the entry type inside a CollectionBlock. Remove `NamedMapLike`, `NamedFieldType`, and `VariantNamedBlockFactory` exports from `@agentscript/language` in favor of `CollectionBlock`, `CollectionBlockFactory`, `CollectionBlockInstance`, and `isCollectionFieldType`. The `__fieldKind` discriminator value `'NamedBlock'` is replaced by `'Collection'`.
- Updated dependencies
  - @agentscript/language@2.2.2
  - @agentscript/agentforce-dialect@2.2.2

## 2.0.5

### Patch Changes

- Bundle agentforce package with new compile and parser modules, add lint passes for connection validation, hyperclassifier, and system message variables to the agentforce dialect, and port Python compiler tests to TypeScript with new modality compilation and action type resolution support.
- Updated dependencies
  - @agentscript/agentforce-dialect@2.2.1
  - @agentscript/language@2.2.1

## 2.0.4

### Patch Changes

- Fix compiler parity with Python: escalation available-when, voice surfaces, negative number defaults, None variable defaults, empty system messages, locale validation, hyperclassifier router nodes, and reset_to_initial_node override. Add connection validation, hyperclassifier constraints, and system message variable lint passes to agentforce dialect. Add VariableTypeInfo to agentscript dialect TypeMap. Port 600+ compiler tests from Python test suite.
- Updated dependencies
  - @agentscript/agentforce-dialect@2.2.0

## 2.0.3

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.2.1
  - @agentscript/agentforce-dialect@2.1.2

## 2.0.2

### Patch Changes

- Add browser bundling support (ESM and IIFE), `emitComponent()` API, `generateParser()` for WASM-based browser parsing, and nested `parseComponent()` paths (`topic.actions`, `topic.reasoning.actions`). Introduce `UnknownStatement` for preserving unrecognized syntax with diagnostics instead of silently dropping content, and improve ERROR node recovery by recursing into children.
- Updated dependencies
  - @agentscript/language@2.2.0
  - @agentscript/agentforce-dialect@2.1.1

## 2.0.1

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.1.0
  - @agentscript/agentforce-dialect@2.1.0
