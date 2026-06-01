# @agentscript/parser

## 4.0.1

### Patch Changes

- d01c76b: Fix publish: rewrite `@agentscript/*` → `@sf-agentscript/*` in `dist/` and `src/`, not just `package.json`.

  Previously, `scripts/publish.mjs` only rewrote `package.json` files at publish time. The compiled JavaScript in `dist/` and the shipped TypeScript in `src/` still contained `import ... from '@agentscript/*'`, so consumers installing `@sf-agentscript/*` packages from npm hit `ERR_MODULE_NOT_FOUND: Cannot find package '@agentscript/...'` at runtime.

  `scripts/publish.mjs` now also rewrites `.js`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.cts`, `.mts`, and `.map` files inside each package's `dist/` and `src/` directories, so published artifacts resolve cleanly under the `@sf-agentscript` scope.

- Updated dependencies [d01c76b]
  - @agentscript/parser-javascript@2.4.1
  - @agentscript/parser-tree-sitter@2.4.1
  - @agentscript/types@0.2.2

## 3.0.6

### Patch Changes

- Updated dependencies
  - @agentscript/parser-javascript@2.3.6

## 3.0.5

### Patch Changes

- Updated dependencies
  - @agentscript/parser-javascript@2.3.5

## 3.0.4

### Patch Changes

- Lint for connected subagents, improve var linting, disallow LLM inputs in router nodes
- Updated dependencies
  - @agentscript/parser-javascript@2.3.4
  - @agentscript/parser-tree-sitter@2.3.2
  - @agentscript/types@0.2.1

## 3.0.3

### Patch Changes

- Updated dependencies
  - @agentscript/parser-javascript@2.3.3

## 3.0.2

### Patch Changes

- Updated dependencies
  - @agentscript/parser-javascript@2.3.2
  - @agentscript/parser-tree-sitter@2.3.1

## 3.0.1

### Patch Changes

- Updated dependencies
  - @agentscript/parser-javascript@2.3.1

## 3.0.0

### Minor Changes

- New features (2026-03-31)

### Patch Changes

- Updated dependencies
  - @agentscript/parser-javascript@2.3.0
  - @agentscript/parser-tree-sitter@2.3.0
  - @agentscript/types@0.2.0
