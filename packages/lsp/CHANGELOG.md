# @agentscript/lsp

## 2.2.14

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.4.10
  - @agentscript/agentfabric-dialect@0.1.12
  - @agentscript/agentforce-dialect@2.7.13
  - @agentscript/agentscript-dialect@2.5.13

## 2.2.13

### Patch Changes

- Fix `@outputs` reference and completion resolution inside nested `run @actions.X` blocks so they resolve against the nested run target rather than the enclosing reasoning action binding. Add `integer` and `long` scalar-to-ParameterDataType mappings for action parameters. Fix template literal indentation handling in the JavaScript lexer.
- Updated dependencies
  - @agentscript/language@2.4.9
  - @agentscript/agentfabric-dialect@0.1.12
  - @agentscript/agentforce-dialect@2.7.12
  - @agentscript/agentscript-dialect@2.5.12
  - @agentscript/parser@3.0.6

## 2.2.12

### Patch Changes

- Updated dependencies
  - @agentscript/agentscript-dialect@2.5.11
  - @agentscript/agentfabric-dialect@0.1.12
  - @agentscript/agentforce-dialect@2.7.11

## 2.2.11

### Patch Changes

- Add unused-variable lint warning that flags declared variables never referenced in the document, with a quick-fix code action in the LSP to remove the declaration.
- Updated dependencies
  - @agentscript/language@2.4.7
  - @agentscript/agentscript-dialect@2.5.10
  - @agentscript/agentfabric-dialect@0.1.8
  - @agentscript/agentforce-dialect@2.7.10

## 2.2.10

### Patch Changes

- @agentscript/parser@3.0.5
- @agentscript/agentfabric-dialect@0.1.7
- @agentscript/agentforce-dialect@2.7.9
- @agentscript/agentscript-dialect@2.5.9
- @agentscript/language@2.4.6

## 2.2.9

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.4.6
  - @agentscript/agentfabric-dialect@0.1.6
  - @agentscript/agentforce-dialect@2.7.8
  - @agentscript/agentscript-dialect@2.5.8

## 2.2.8

### Patch Changes

- Lint for connected subagents, improve var linting, disallow LLM inputs in router nodes
- Updated dependencies
  - @agentscript/agentscript-dialect@2.5.7
  - @agentscript/agentforce-dialect@2.7.7
  - @agentscript/agentfabric-dialect@0.1.5
  - @agentscript/language@2.4.5
  - @agentscript/parser@3.0.4
  - @agentscript/types@0.2.1

## 2.2.7

### Patch Changes

- @agentscript/parser@3.0.3
- @agentscript/agentfabric-dialect@0.1.4
- @agentscript/agentforce-dialect@2.7.6
- @agentscript/agentscript-dialect@2.5.6
- @agentscript/language@2.4.4

## 2.2.6

### Patch Changes

- Updated dependencies
  - @agentscript/agentscript-dialect@2.5.5
  - @agentscript/agentfabric-dialect@0.1.3
  - @agentscript/agentforce-dialect@2.7.5

## 2.2.5

### Patch Changes

- Revert rename (`tool_definitions` back to `actions`, `tools` back to `actions` in reasoning blocks). Add support for discriminant-based polymorphic variants via `.discriminant()` on block factories. Refactor `block.ts` into focused modules (block-factory, named-block-factory, typed-map-factory, collection-block-factory, factory-utils). Fix variant type propagation through `InferFieldType` and collection factories. Improve comment attachment parity with tree-sitter parser.
- Updated dependencies
  - @agentscript/language@2.4.4
  - @agentscript/agentscript-dialect@2.5.4
  - @agentscript/agentforce-dialect@2.7.4
  - @agentscript/agentfabric-dialect@0.1.2
  - @agentscript/parser@3.0.2

## 2.2.4

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.4.3
  - @agentscript/agentscript-dialect@2.5.3
  - @agentscript/agentfabric-dialect@0.1.1
  - @agentscript/agentforce-dialect@2.7.3

## 2.2.3

### Patch Changes

- Updated dependencies
  - @agentscript/agentscript-dialect@2.5.2
  - @agentscript/agentforce-dialect@2.7.2
  - @agentscript/language@2.4.2

## 2.2.2

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.4.1
  - @agentscript/agentscript-dialect@2.5.1
  - @agentscript/agentforce-dialect@2.7.1
  - @agentscript/parser@3.0.1

## 2.2.1

### Patch Changes

- Updated dependencies
  - @agentscript/agentscript-dialect@2.5.0
  - @agentscript/agentforce-dialect@2.7.0

## 2.2.0

### Minor Changes

- New features (2026-03-31)

### Patch Changes

- Updated dependencies
  - @agentscript/agentforce-dialect@2.6.0
  - @agentscript/agentscript-dialect@2.4.0
  - @agentscript/language@2.4.0
  - @agentscript/parser@3.0.0
  - @agentscript/types@0.2.0

## 2.1.6

### Patch Changes

- Temporarily remove the deprecated notice from the `topic` block keyword while migration is in progress.
- Updated dependencies
  - @agentscript/agentforce-dialect@2.5.4

## 2.1.5

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.3.3
  - @agentscript/agentforce-dialect@2.5.3
  - @agentscript/agentscript-dialect@2.3.3

## 2.1.4

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.3.2
  - @agentscript/agentscript-dialect@2.3.2
  - @agentscript/agentforce-dialect@2.5.2

## 2.1.3

### Patch Changes

- Updated dependencies
  - @agentscript/agentforce-dialect@2.5.1

## 2.1.2

### Patch Changes

- Updated dependencies
  - @agentscript/agentforce-dialect@2.5.0

## 2.1.1

### Patch Changes

- Replace tree-sitter with a hand-written TypeScript parser (`@agentscript/parser-ts`) for parsing AgentScript files. This eliminates the native/WASM dependency on tree-sitter, enabling simpler builds, faster startup, and consistent behavior across Node.js and browser environments. Add `@agentscript/types` as a shared foundational types package. Update all downstream packages (language, compiler, dialects, LSP, Monaco, CLI, SDK) to consume the new parser-ts CST format. Add new lint passes for complex data types, config validation, and variable validation in the Agentforce dialect.
- Updated dependencies
  - @agentscript/parser-ts@0.1.1
  - @agentscript/types@0.1.1
  - @agentscript/language@2.3.1
  - @agentscript/agentscript-dialect@2.3.1
  - @agentscript/agentforce-dialect@2.4.1

## 2.1.0

### Minor Changes

- Add support for renamed blocks: topic => subagent, topic.actions => tool_definitions, topic.reasoning.actions => tools

### Patch Changes

- Updated dependencies
  - @agentscript/agentscript-dialect@2.3.0
  - @agentscript/agentforce-dialect@2.4.0
  - @agentscript/language@2.3.0

## 2.0.11

### Patch Changes

- Updated dependencies
  - @agentscript/agentforce-dialect@2.3.0

## 2.0.10

### Patch Changes

- Add config validation, variable validation, and complex data type warning lint rules to the Agentforce dialect for parity with core linting. Remove security lint rules (actionSecurityConfirmationRule, outputSecurityRule). Update schema with enum constraints for visibility and agent_type fields, and add new deprecated fields (agent_template, user_locale). Fix LSP diagnostic sort order to position-first so "View Problem" navigation finds the marker under the cursor.
- Updated dependencies
  - @agentscript/agentforce-dialect@2.2.13

## 2.0.9

### Patch Changes

- Remove security lint rules (actionSecurityConfirmationRule, outputSecurityRule) from the Agentforce dialect. Fix "View Problem" navigation in the LSP to sort diagnostics by position instead of severity, ensuring the marker under the cursor is found first.
- Updated dependencies
  - @agentscript/agentforce-dialect@2.2.12

## 2.0.8

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.2.11
  - @agentscript/agentscript-dialect@2.2.11
  - @agentscript/agentforce-dialect@2.2.11

## 2.0.7

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.2.10
  - @agentscript/agentforce-dialect@2.2.10
  - @agentscript/agentscript-dialect@2.2.10

## 2.0.6

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.2.9
  - @agentscript/agentforce-dialect@2.2.9
  - @agentscript/agentscript-dialect@2.2.9

## 2.0.5

### Patch Changes

- Add `nameRange` to reference occurrences for accurate rename symbol support, fix scope resolution to prioritize outer definitions over nested bindings, and switch lsp-browser to a self-contained esbuild bundle.
- Updated dependencies
  - @agentscript/language@2.2.8
  - @agentscript/agentscript-dialect@2.2.8
  - @agentscript/agentforce-dialect@2.2.8

## 2.0.4

### Patch Changes

- 86b39c2: Refactor LSP into a modular architecture with dialect registry, automatic dialect detection via annotations, and separated browser/node server packages. Add smart indentation on Enter, enhanced completions with dialect-aware suggestions, semantic token highlighting, code actions, and a new Monaco theme module. Fix various completions bugs including nested completions and colon highlighting.
- Updated dependencies [86b39c2]
  - @agentscript/language@2.2.7
  - @agentscript/agentscript-dialect@2.2.7
  - @agentscript/agentforce-dialect@2.2.7

## 2.0.3

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.2.6
  - @agentscript/agentforce@2.1.8

## 2.0.2

### Patch Changes

- Add LSP server package with hover, completion, definition, references, rename, code actions, semantic tokens, and document/workspace symbols support. Add snippet generation and enhanced completions to the language package. Add component-kind classification and semantic token support to the agentforce package. Remove inbound_model and outbound_model voice settings from the agentforce dialect and compiler.
- Updated dependencies
  - @agentscript/language@2.2.5
  - @agentscript/agentforce@2.1.7

## 2.0.1

### Patch Changes

- Add shared LSP package with hover, completion, definition, references, rename, code actions, semantic tokens, and document symbols providers. Enhance language package with snippet generation and improved completions. Add component-kind classification and semantic token support to agentforce package. Remove deprecated voice modality inbound_model and outbound_model fields.
- Updated dependencies
  - @agentscript/language@2.2.4
  - @agentscript/agentforce@2.1.6
