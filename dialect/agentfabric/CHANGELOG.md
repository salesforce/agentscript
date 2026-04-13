# @agentscript/agentfabric-dialect

## 0.1.8

### Breaking Changes

- Renamed `fabric_headers` to `http_headers` on `action_definitions` entries and in reasoning `with` bindings (e.g. `with http_headers = {...}`). The old name is no longer accepted.

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.4.7
  - @agentscript/agentscript-dialect@2.5.10

## 0.1.7

### Patch Changes

- @agentscript/agentscript-dialect@2.5.9
- @agentscript/language@2.4.6

## 0.1.6

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.4.6
  - @agentscript/agentscript-dialect@2.5.8

## 0.1.5

### Patch Changes

- Lint for connected subagents, improve var linting, disallow LLM inputs in router nodes
- Updated dependencies
  - @agentscript/agentscript-dialect@2.5.7
  - @agentscript/language@2.4.5

## 0.1.4

### Patch Changes

- @agentscript/agentscript-dialect@2.5.6
- @agentscript/language@2.4.4

## 0.1.3

### Patch Changes

- Updated dependencies
  - @agentscript/agentscript-dialect@2.5.5

## 0.1.2

### Patch Changes

- Revert rename (`tool_definitions` back to `actions`, `tools` back to `actions` in reasoning blocks). Add support for discriminant-based polymorphic variants via `.discriminant()` on block factories. Refactor `block.ts` into focused modules (block-factory, named-block-factory, typed-map-factory, collection-block-factory, factory-utils). Fix variant type propagation through `InferFieldType` and collection factories. Improve comment attachment parity with tree-sitter parser.
- Updated dependencies
  - @agentscript/language@2.4.4
  - @agentscript/agentscript-dialect@2.5.4

## 0.1.1

### Patch Changes

- Updated dependencies
  - @agentscript/language@2.4.3
  - @agentscript/agentscript-dialect@2.5.3
