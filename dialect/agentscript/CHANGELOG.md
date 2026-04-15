# @agentscript/agentscript-dialect

## 2.5.13

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.4.10

## 2.5.12

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.4.9
  - @agentscript/parser@3.0.6

## 2.5.11

### Patch Changes

- Fix `action-missing-input` lint rule to respect the `is_required: False` property on action inputs. Previously, inputs marked as explicitly optional were still flagged as missing when omitted from a reasoning action's `with` clauses.

## 2.5.10

### Patch Changes

- Add unused-variable lint warning that flags declared variables never referenced in the document, with a quick-fix code action in the LSP to remove the declaration.
- Updated dependencies
  - @agentscript/language@2.4.7

## 2.5.9

### Patch Changes

- @agentscript/parser@3.0.5
- @agentscript/language@2.4.6

## 2.5.8

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.4.6

## 2.5.7

### Patch Changes

- Lint for connected subagents, improve var linting, disallow LLM inputs in router nodes
- Updated dependencies
  - @agentscript/language@2.4.5
  - @agentscript/parser@3.0.4
  - @agentscript/types@0.2.1

## 2.5.6

### Patch Changes

- @agentscript/parser@3.0.3
- @agentscript/language@2.4.4

## 2.5.5

### Patch Changes

- Router nodes can only include transitions

## 2.5.4

### Patch Changes

- Revert rename (`tool_definitions` back to `actions`, `tools` back to `actions` in reasoning blocks). Add support for discriminant-based polymorphic variants via `.discriminant()` on block factories. Refactor `block.ts` into focused modules (block-factory, named-block-factory, typed-map-factory, collection-block-factory, factory-utils). Fix variant type propagation through `InferFieldType` and collection factories. Improve comment attachment parity with tree-sitter parser.
- Updated dependencies
  - @agentscript/language@2.4.4
  - @agentscript/parser@3.0.2

## 2.5.3

### Patch Changes

- Fix ellipsis emission in `WithClause` so programmatically constructed nodes correctly emit `= ...` instead of omitting the value. Remove unnecessary `StringLiteral`-only restriction from `ConnectedSubagentBlock` string fields to support multi-line strings.
- Updated dependencies
  - @agentscript/language@2.4.3

## 2.5.2

### Patch Changes

- SOMA multi-line string language support
- Updated dependencies
  - @agentscript/language@2.4.2

## 2.5.1

### Patch Changes

- Add wildcard `additional_parameter__*` support so arbitrary config fields matching the prefix are accepted without explicit schema entries. Introduce a dedicated `StartAgentBlock` type distinct from `SubagentBlock` for proper type discrimination. Simplify the parser-javascript lexer.
- Updated dependencies
  - @agentscript/language@2.4.1
  - @agentscript/parser@3.0.1

## 2.5.0

### Minor Changes

- Add dedicated `StartAgentBlock` type distinct from `SubagentBlock` so that `start_agent` blocks produce a unique `__kind` for type discrimination. Refactor shared subagent fields into a common base and update the compiler's `ParsedTopicLike` union to include the new type.

## 2.4.0

### Minor Changes

- New features (2026-03-31)

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.4.0
  - @agentscript/parser@3.0.0
  - @agentscript/types@0.2.0

## 2.3.3

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.3.3

## 2.3.2

### Patch Changes

- Add dedicated ActionBlock, ActionsBlock, ReasoningActionBlock, and ReasoningActionsBlock types for topic-style block definitions, preserving legacy \_\_kind values and 'action' scopeAlias separately from the subagent-style ToolDefinitionBlock/ToolBlock types.
- Updated dependencies
  - @agentscript/language@2.3.2

## 2.3.1

### Patch Changes

- Replace tree-sitter with a hand-written TypeScript parser (`@agentscript/parser-ts`) for parsing AgentScript files. This eliminates the native/WASM dependency on tree-sitter, enabling simpler builds, faster startup, and consistent behavior across Node.js and browser environments. Add `@agentscript/types` as a shared foundational types package. Update all downstream packages (language, compiler, dialects, LSP, Monaco, CLI, SDK) to consume the new parser-ts CST format. Add new lint passes for complex data types, config validation, and variable validation in the Agentforce dialect.
- Updated dependencies
  - @agentscript/parser-ts@0.1.1
  - @agentscript/types@0.1.1
  - @agentscript/language@2.3.1

## 2.3.0

### Minor Changes

- Add support for renamed blocks: topic => subagent, topic.actions => tool_definitions, topic.reasoning.actions => tools

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.3.0

## 2.2.11

### Patch Changes

- Fix emitComponent incorrectly prefixing ActionBlock kind to action entry names. Fix diagnostic deduplication by scoping `__diagnostics` on collection and typed-map nodes to own-level diagnostics only. Allow reserved words (e.g. `date`) when used as quoted keys.
- Updated dependencies
  - @agentscript/language@2.2.11

## 2.2.10

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.2.10

## 2.2.9

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.2.9

## 2.2.8

### Patch Changes

- Add `nameRange` to reference occurrences for accurate rename symbol support, fix scope resolution to prioritize outer definitions over nested bindings, and switch lsp-browser to a self-contained esbuild bundle.
- Updated dependencies
  - @agentscript/language@2.2.8

## 2.2.7

### Patch Changes

- 86b39c2: Refactor LSP into a modular architecture with dialect registry, automatic dialect detection via annotations, and separated browser/node server packages. Add smart indentation on Enter, enhanced completions with dialect-aware suggestions, semantic token highlighting, code actions, and a new Monaco theme module. Fix various completions bugs including nested completions and colon highlighting.
- Updated dependencies [86b39c2]
  - @agentscript/language@2.2.7

## 2.2.6

### Patch Changes

- Add connected agent block type with compilation, lint rules, and validation support. Connected agents can be invoked as tools with bound inputs, and include lint rules preventing invalid transitions and enforcing input validation. Also adds block capability declarations (invokable, transferable) and resolved type constraints to the language package.
- Updated dependencies
  - @agentscript/language@2.2.6

## 2.2.5

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.2.5

## 2.2.4

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.2.4

## 2.2.3

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.2.3

## 2.2.2

### Patch Changes

- Refactor block system to introduce CollectionBlock as a first-class field type, replacing the dual NamedBlock/NamedFieldType pattern. NamedBlock is no longer a FieldType — it is now the entry type inside a CollectionBlock. Remove `NamedMapLike`, `NamedFieldType`, and `VariantNamedBlockFactory` exports from `@agentscript/language` in favor of `CollectionBlock`, `CollectionBlockFactory`, `CollectionBlockInstance`, and `isCollectionFieldType`. The `__fieldKind` discriminator value `'NamedBlock'` is replaced by `'Collection'`.
- Updated dependencies
  - @agentscript/language@2.2.2

## 2.2.1

### Patch Changes

- Bundle agentforce package with new compile and parser modules, add lint passes for connection validation, hyperclassifier, and system message variables to the agentforce dialect, and port Python compiler tests to TypeScript with new modality compilation and action type resolution support.
  - @agentscript/language@2.2.1

## 2.2.0

### Minor Changes

- Fix compiler parity with Python: escalation available-when, voice surfaces, negative number defaults, None variable defaults, empty system messages, locale validation, hyperclassifier router nodes, and reset_to_initial_node override. Add connection validation, hyperclassifier constraints, and system message variable lint passes to agentforce dialect. Add VariableTypeInfo to agentscript dialect TypeMap. Port 600+ compiler tests from Python test suite.

## 2.1.2

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.2.1

## 2.1.1

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.2.0

## 2.1.0

### Minor Changes

- Add expression validation lint pass for function calls and operators, export `expressionValidationPass` and `BUILTIN_FUNCTIONS` from language package. Support `standardInvocableAction://` scheme in agentforce action targets. Add `append` option to `example()` builder method.

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.1.0
