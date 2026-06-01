# @agentscript/types

## 0.2.2

### Patch Changes

- d01c76b: Fix publish: rewrite `@agentscript/*` → `@sf-agentscript/*` in `dist/` and `src/`, not just `package.json`.

  Previously, `scripts/publish.mjs` only rewrote `package.json` files at publish time. The compiled JavaScript in `dist/` and the shipped TypeScript in `src/` still contained `import ... from '@agentscript/*'`, so consumers installing `@sf-agentscript/*` packages from npm hit `ERR_MODULE_NOT_FOUND: Cannot find package '@agentscript/...'` at runtime.

  `scripts/publish.mjs` now also rewrites `.js`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.cts`, `.mts`, and `.map` files inside each package's `dist/` and `src/` directories, so published artifacts resolve cleanly under the `@sf-agentscript` scope.

## 0.2.1

### Patch Changes

- Lint for connected subagents, improve var linting, disallow LLM inputs in router nodes

## 0.2.0

### Minor Changes

- New features (2026-03-31)

## 0.1.1

### Patch Changes

- Replace tree-sitter with a hand-written TypeScript parser (`@agentscript/parser-ts`) for parsing AgentScript files. This eliminates the native/WASM dependency on tree-sitter, enabling simpler builds, faster startup, and consistent behavior across Node.js and browser environments. Add `@agentscript/types` as a shared foundational types package. Update all downstream packages (language, compiler, dialects, LSP, Monaco, CLI, SDK) to consume the new parser-ts CST format. Add new lint passes for complex data types, config validation, and variable validation in the Agentforce dialect.
