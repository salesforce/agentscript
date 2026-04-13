# @agentscript/agentforce-dialect

## 2.7.10

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.4.7
  - @agentscript/agentscript-dialect@2.5.10

## 2.7.9

### Patch Changes

- @agentscript/agentscript-dialect@2.5.9
- @agentscript/language@2.4.6

## 2.7.8

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.4.6
  - @agentscript/agentscript-dialect@2.5.8

## 2.7.7

### Patch Changes

- Lint for connected subagents, improve var linting, disallow LLM inputs in router nodes
- Updated dependencies
  - @agentscript/agentscript-dialect@2.5.7
  - @agentscript/language@2.4.5
  - @agentscript/types@0.2.1

## 2.7.6

### Patch Changes

- @agentscript/agentscript-dialect@2.5.6
- @agentscript/language@2.4.4

## 2.7.5

### Patch Changes

- Updated dependencies
  - @agentscript/agentscript-dialect@2.5.5

## 2.7.4

### Patch Changes

- Revert rename (`tool_definitions` back to `actions`, `tools` back to `actions` in reasoning blocks). Add support for discriminant-based polymorphic variants via `.discriminant()` on block factories. Refactor `block.ts` into focused modules (block-factory, named-block-factory, typed-map-factory, collection-block-factory, factory-utils). Fix variant type propagation through `InferFieldType` and collection factories. Improve comment attachment parity with tree-sitter parser.
- Updated dependencies
  - @agentscript/language@2.4.4
  - @agentscript/agentscript-dialect@2.5.4

## 2.7.3

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.4.3
  - @agentscript/agentscript-dialect@2.5.3

## 2.7.2

### Patch Changes

- SOMA multi-line string language support
- Updated dependencies
  - @agentscript/agentscript-dialect@2.5.2
  - @agentscript/language@2.4.2

## 2.7.1

### Patch Changes

- Add wildcard `additional_parameter__*` support so arbitrary config fields matching the prefix are accepted without explicit schema entries. Introduce a dedicated `StartAgentBlock` type distinct from `SubagentBlock` for proper type discrimination. Simplify the parser-javascript lexer.
- Updated dependencies
  - @agentscript/language@2.4.1
  - @agentscript/agentscript-dialect@2.5.1

## 2.7.0

### Minor Changes

- Add dedicated `StartAgentBlock` type distinct from `SubagentBlock` so that `start_agent` blocks produce a unique `__kind` for type discrimination. Refactor shared subagent fields into a common base and update the compiler's `ParsedTopicLike` union to include the new type.

### Patch Changes

- Updated dependencies
  - @agentscript/agentscript-dialect@2.5.0

## 2.6.0

### Minor Changes

- New features (2026-03-31)

### Patch Changes

- Updated dependencies
  - @agentscript/agentscript-dialect@2.4.0
  - @agentscript/language@2.4.0
  - @agentscript/types@0.2.0

## 2.5.4

### Patch Changes

- Temporarily remove the deprecated notice from the `topic` block keyword while migration is in progress.

## 2.5.3

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.3.3
  - @agentscript/agentscript-dialect@2.3.3

## 2.5.2

### Patch Changes

- Add dedicated ActionBlock, ActionsBlock, ReasoningActionBlock, and ReasoningActionsBlock types for topic-style block definitions, preserving legacy \_\_kind values and 'action' scopeAlias separately from the subagent-style ToolDefinitionBlock/ToolBlock types.
- Updated dependencies
  - @agentscript/language@2.3.2
  - @agentscript/agentscript-dialect@2.3.2

## 2.5.1

### Patch Changes

- Add support for context block in AFScript, compile to context. context block supports memory block

## 2.5.0

### Minor Changes

- support for generatePromptResponse:// prefix in URI schema

## 2.4.1

### Patch Changes

- Replace tree-sitter with a hand-written TypeScript parser (`@agentscript/parser-ts`) for parsing AgentScript files. This eliminates the native/WASM dependency on tree-sitter, enabling simpler builds, faster startup, and consistent behavior across Node.js and browser environments. Add `@agentscript/types` as a shared foundational types package. Update all downstream packages (language, compiler, dialects, LSP, Monaco, CLI, SDK) to consume the new parser-ts CST format. Add new lint passes for complex data types, config validation, and variable validation in the Agentforce dialect.
- Updated dependencies
  - @agentscript/types@0.1.1
  - @agentscript/language@2.3.1
  - @agentscript/agentscript-dialect@2.3.1

## 2.4.0

### Minor Changes

- Add support for renamed blocks: topic => subagent, topic.actions => tool_definitions, topic.reasoning.actions => tools

### Patch Changes

- Updated dependencies
  - @agentscript/agentscript-dialect@2.3.0
  - @agentscript/language@2.3.0

## 2.3.0

### Minor Changes

- Add target property for connected agent blocks, compile to updated schema

## 2.2.13

### Patch Changes

- Add config validation, variable validation, and complex data type warning lint rules to the Agentforce dialect for parity with core linting. Remove security lint rules (actionSecurityConfirmationRule, outputSecurityRule). Update schema with enum constraints for visibility and agent_type fields, and add new deprecated fields (agent_template, user_locale). Fix LSP diagnostic sort order to position-first so "View Problem" navigation finds the marker under the cursor.

## 2.2.12

### Patch Changes

- Remove security lint rules (actionSecurityConfirmationRule, outputSecurityRule) from the Agentforce dialect. Fix "View Problem" navigation in the LSP to sort diagnostics by position instead of severity, ensuring the marker under the cursor is found first.

## 2.2.11

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.2.11
  - @agentscript/agentscript-dialect@2.2.11

## 2.2.10

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.2.10
  - @agentscript/agentscript-dialect@2.2.10

## 2.2.9

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.2.9
  - @agentscript/agentscript-dialect@2.2.9

## 2.2.8

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.2.8
  - @agentscript/agentscript-dialect@2.2.8

## 2.2.7

### Patch Changes

- 86b39c2: Refactor LSP into a modular architecture with dialect registry, automatic dialect detection via annotations, and separated browser/node server packages. Add smart indentation on Enter, enhanced completions with dialect-aware suggestions, semantic token highlighting, code actions, and a new Monaco theme module. Fix various completions bugs including nested completions and colon highlighting.
- Updated dependencies [86b39c2]
  - @agentscript/language@2.2.7
  - @agentscript/agentscript-dialect@2.2.7

## 2.2.6

### Patch Changes

- Add connected agent block type with compilation, lint rules, and validation support. Connected agents can be invoked as tools with bound inputs, and include lint rules preventing invalid transitions and enforcing input validation. Also adds block capability declarations (invokable, transferable) and resolved type constraints to the language package.
- Updated dependencies
  - @agentscript/language@2.2.6
  - @agentscript/agentscript-dialect@2.2.6

## 2.2.5

### Patch Changes

- Add LSP server package with hover, completion, definition, references, rename, code actions, semantic tokens, and document/workspace symbols support. Add snippet generation and enhanced completions to the language package. Add component-kind classification and semantic token support to the agentforce package. Remove inbound_model and outbound_model voice settings from the agentforce dialect and compiler.
- Updated dependencies
  - @agentscript/language@2.2.5
  - @agentscript/agentscript-dialect@2.2.5

## 2.2.4

### Patch Changes

- Add shared LSP package with hover, completion, definition, references, rename, code actions, semantic tokens, and document symbols providers. Enhance language package with snippet generation and improved completions. Add component-kind classification and semantic token support to agentforce package. Remove deprecated voice modality inbound_model and outbound_model fields.
- Updated dependencies
  - @agentscript/language@2.2.4
  - @agentscript/agentscript-dialect@2.2.4

## 2.2.3

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.2.3
  - @agentscript/agentscript-dialect@2.2.3

## 2.2.2

### Patch Changes

- Refactor block system to introduce CollectionBlock as a first-class field type, replacing the dual NamedBlock/NamedFieldType pattern. NamedBlock is no longer a FieldType — it is now the entry type inside a CollectionBlock. Remove `NamedMapLike`, `NamedFieldType`, and `VariantNamedBlockFactory` exports from `@agentscript/language` in favor of `CollectionBlock`, `CollectionBlockFactory`, `CollectionBlockInstance`, and `isCollectionFieldType`. The `__fieldKind` discriminator value `'NamedBlock'` is replaced by `'Collection'`.
- Updated dependencies
  - @agentscript/language@2.2.2
  - @agentscript/agentscript-dialect@2.2.2

## 2.2.1

### Patch Changes

- Bundle agentforce package with new compile and parser modules, add lint passes for connection validation, hyperclassifier, and system message variables to the agentforce dialect, and port Python compiler tests to TypeScript with new modality compilation and action type resolution support.
- Updated dependencies
  - @agentscript/agentscript-dialect@2.2.1
  - @agentscript/language@2.2.1

## 2.2.0

### Minor Changes

- Fix compiler parity with Python: escalation available-when, voice surfaces, negative number defaults, None variable defaults, empty system messages, locale validation, hyperclassifier router nodes, and reset_to_initial_node override. Add connection validation, hyperclassifier constraints, and system message variable lint passes to agentforce dialect. Add VariableTypeInfo to agentscript dialect TypeMap. Port 600+ compiler tests from Python test suite.

### Patch Changes

- Updated dependencies
  - @agentscript/agentscript-dialect@2.2.0

## 2.1.2

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.2.1
  - @agentscript/agentscript-dialect@2.1.2

## 2.1.1

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.2.0
  - @agentscript/agentscript-dialect@2.1.1

## 2.1.0

### Minor Changes

- Add expression validation lint pass for function calls and operators, export `expressionValidationPass` and `BUILTIN_FUNCTIONS` from language package. Support `standardInvocableAction://` scheme in agentforce action targets. Add `append` option to `example()` builder method.

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.1.0
  - @agentscript/agentscript-dialect@2.1.0
