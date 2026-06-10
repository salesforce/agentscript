# @agentscript/agentfabric-dialect

## 0.4.0

### Breaking Changes

- Redesigned the `echo` node around A2A v1 task-update events. The single `kind: "a2a:response"` variant is replaced by two event variants:

  - `a2a:status_update_event` — sets the task `state` (required; one of the A2A v1 `TASK_STATE_*` values) with an optional `message`.
  - `a2a:artifact_update_event` — emits an `artifact` (required) with optional `append` and `lastChunk` flags.

  The base `task` and `artifacts` fields and the `a2a.task` namespaced function have been removed. Flows using `kind: "a2a:response"`, `task:`, `artifacts:`, or `a2a.task(...)` must migrate to the new event variants.

### Minor Changes

- Added the `terminal-requires-status-update` lint rule: every terminal branch in a graph must reach an `a2a:status_update_event` echo that sets a terminal state (`TASK_STATE_COMPLETED`, `TASK_STATE_FAILED`, or `TASK_STATE_CANCELED`). The echo need not be the leaf node.
- Added the `echo-invalid-state` lint rule, which validates that an `a2a:status_update_event` echo's `state` is a known A2A v1 task state.
- Exported `A2A_TASK_STATES` and `A2A_TERMINAL_STATES` from the schema for shared use across the schema, compiler, and linter.
- Removed the `echo-task-or-message-required` rule, which no longer applies under the new event model.

## 0.1.24

### Patch Changes

- d01c76b: Fix publish: rewrite `@agentscript/*` → `@sf-agentscript/*` in `dist/` and `src/`, not just `package.json`.

  Previously, `scripts/publish.mjs` only rewrote `package.json` files at publish time. The compiled JavaScript in `dist/` and the shipped TypeScript in `src/` still contained `import ... from '@agentscript/*'`, so consumers installing `@sf-agentscript/*` packages from npm hit `ERR_MODULE_NOT_FOUND: Cannot find package '@agentscript/...'` at runtime.

  `scripts/publish.mjs` now also rewrites `.js`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.cts`, `.mts`, and `.map` files inside each package's `dist/` and `src/` directories, so published artifacts resolve cleanly under the `@sf-agentscript` scope.

- Updated dependencies [d01c76b]
  - @agentscript/agentscript-dialect@2.5.20
  - @agentscript/language@2.5.4

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
