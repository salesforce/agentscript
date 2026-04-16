# @agentscript/lsp-browser

## 2.2.19

### Patch Changes

- @agentscript/agentforce@2.5.19
- @agentscript/lsp@2.2.14

## 2.2.18

### Patch Changes

- Updated dependencies
  - @agentscript/lsp@2.2.13
  - @agentscript/agentforce@2.5.18

## 2.2.17

### Patch Changes

- @agentscript/lsp@2.2.12
- @agentscript/agentforce@2.5.17

## 2.2.16

### Patch Changes

- @agentscript/agentforce@2.5.16

## 2.2.15

### Patch Changes

- Updated dependencies
  - @agentscript/agentforce@2.5.15

## 2.2.14

### Patch Changes

- @agentscript/agentforce@2.5.14

## 2.2.13

### Patch Changes

- @agentscript/agentforce@2.5.13

## 2.2.12

### Patch Changes

- Updated dependencies
  - @agentscript/lsp@2.2.11
  - @agentscript/agentforce@2.5.12

## 2.2.11

### Patch Changes

- @agentscript/agentforce@2.5.11
- @agentscript/lsp@2.2.10

## 2.2.10

### Patch Changes

- @agentscript/agentforce@2.5.10
- @agentscript/lsp@2.2.9

## 2.2.9

### Patch Changes

- Lint for connected subagents, improve var linting, disallow LLM inputs in router nodes
- Updated dependencies
  - @agentscript/agentforce@2.5.9
  - @agentscript/lsp@2.2.8
  - @agentscript/types@0.2.1

## 2.2.8

### Patch Changes

- Updated dependencies
  - @agentscript/agentforce@2.5.8

## 2.2.7

### Patch Changes

- @agentscript/agentforce@2.5.7
- @agentscript/lsp@2.2.7

## 2.2.6

### Patch Changes

- Updated dependencies
  - @agentscript/agentforce@2.5.6
  - @agentscript/lsp@2.2.6

## 2.2.5

### Patch Changes

- Updated dependencies
  - @agentscript/agentforce@2.5.5
  - @agentscript/lsp@2.2.5

## 2.2.4

### Patch Changes

- @agentscript/agentforce@2.5.4
- @agentscript/lsp@2.2.4

## 2.2.3

### Patch Changes

- Updated dependencies
  - @agentscript/agentforce@2.5.3
  - @agentscript/lsp@2.2.3

## 2.2.2

### Patch Changes

- @agentscript/agentforce@2.5.2
- @agentscript/lsp@2.2.2

## 2.2.1

### Patch Changes

- @agentscript/lsp@2.2.1
- @agentscript/agentforce@2.5.1

## 2.2.0

### Minor Changes

- New features (2026-03-31)

### Patch Changes

- Updated dependencies
  - @agentscript/agentforce@2.5.0
  - @agentscript/lsp@2.2.0
  - @agentscript/types@0.2.0

## 2.1.6

### Patch Changes

- Updated dependencies
  - @agentscript/lsp@2.1.6
  - @agentscript/agentforce@2.4.4

## 2.1.5

### Patch Changes

- @agentscript/agentforce@2.4.3
- @agentscript/lsp@2.1.5

## 2.1.4

### Patch Changes

- Updated dependencies
  - @agentscript/agentforce@2.4.2
  - @agentscript/lsp@2.1.4

## 2.1.3

### Patch Changes

- @agentscript/agentforce@2.4.1
- @agentscript/lsp@2.1.3

## 2.1.2

### Patch Changes

- Updated dependencies
  - @agentscript/agentforce@2.4.0
  - @agentscript/lsp@2.1.2

## 2.1.1

### Patch Changes

- Replace tree-sitter with a hand-written TypeScript parser (`@agentscript/parser-ts`) for parsing AgentScript files. This eliminates the native/WASM dependency on tree-sitter, enabling simpler builds, faster startup, and consistent behavior across Node.js and browser environments. Add `@agentscript/types` as a shared foundational types package. Update all downstream packages (language, compiler, dialects, LSP, Monaco, CLI, SDK) to consume the new parser-ts CST format. Add new lint passes for complex data types, config validation, and variable validation in the Agentforce dialect.
- Updated dependencies
  - @agentscript/types@0.1.1
  - @agentscript/agentforce@2.3.1
  - @agentscript/lsp@2.1.1

## 2.1.0

### Minor Changes

- Add support for renamed blocks: topic => subagent, topic.actions => tool_definitions, topic.reasoning.actions => tools

### Patch Changes

- Updated dependencies
  - @agentscript/agentforce@2.3.0
  - @agentscript/lsp@2.1.0

## 2.0.12

### Patch Changes

- Updated dependencies
  - @agentscript/agentforce@2.2.0
  - @agentscript/lsp@2.0.11

## 2.0.11

### Patch Changes

- Updated dependencies
  - @agentscript/lsp@2.0.10
  - @agentscript/agentforce@2.1.16

## 2.0.10

### Patch Changes

- Updated dependencies
  - @agentscript/lsp@2.0.9
  - @agentscript/agentforce@2.1.15

## 2.0.9

### Patch Changes

- Updated dependencies
  - @agentscript/agentforce@2.1.14
  - @agentscript/lsp@2.0.8

## 2.0.8

### Patch Changes

- @agentscript/agentforce@2.1.13
- @agentscript/lsp@2.0.7

## 2.0.7

### Patch Changes

- @agentscript/agentforce@2.1.12
- @agentscript/lsp@2.0.6

## 2.0.6

### Patch Changes

- Add `nameRange` to reference occurrences for accurate rename symbol support, fix scope resolution to prioritize outer definitions over nested bindings, and switch lsp-browser to a self-contained esbuild bundle.
- Updated dependencies
  - @agentscript/lsp@2.0.5
  - @agentscript/agentforce@2.1.11

## 2.0.5

### Patch Changes

- Updated dependencies
  - @agentscript/agentforce@2.1.10

## 2.0.4

### Patch Changes

- Updated dependencies [86b39c2]
  - @agentscript/lsp@2.0.4
  - @agentscript/language@2.2.7
  - @agentscript/agentforce@2.1.9
  - @agentscript/agentscript-dialect@2.2.7
  - @agentscript/agentforce-dialect@2.2.7
