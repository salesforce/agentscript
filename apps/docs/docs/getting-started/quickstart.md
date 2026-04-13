---
sidebar_position: 1
---

# Quickstart

Get up and running with the AgentScript monorepo in a few minutes.

## Prerequisites

- **Node.js** >= 18.0.0
- **pnpm** >= 8.0.0

## Clone and Install

```bash
git clone <repo-url>
cd agentscript
pnpm install
```

## Build All Packages

The monorepo uses Turborepo for build orchestration. Build everything with:

```bash
pnpm build
```

## Run Tests

```bash
pnpm test
```

## Common Workflows

### After Parser Changes

The parser package contains a tree-sitter grammar that must be regenerated and compiled to both native Node.js bindings and WASM whenever the grammar is modified:

```bash
cd packages/parser-tree-sitter && pnpm run build
```

### After Dialect Changes

Rebuild the dialect package after modifying schema definitions, block factories, or lint passes:

```bash
pnpm build --filter @agentscript/agentscript-dialect
```

### Format Code

The project uses Prettier for formatting. Run it before committing:

```bash
pnpm format
```

### Start the Documentation Server

The docs site is a Docusaurus application that runs on port 27000:

```bash
pnpm docs:dev
```

## Project Structure

```
packages/              Core language packages
  parser/              Tree-sitter grammar and parser
  language/            Language infrastructure, lint engine, analysis
  compiler/            AST to a Salesforce runtime specification compiler
  lsp/                 Language Server Protocol (core)
  lsp-server/          LSP transport for Node.js
  lsp-browser/         LSP transport for browser
  monaco/              Monaco editor integration
  vscode/              VS Code extension
  cli/                 Command-line interface
  agentforce/          Agentforce utilities
  salesforce/          Salesforce integration
dialect/               Language dialect implementations
  agentscript/         Base AgentScript dialect
  agentforce/          Agentforce dialect (extends base)
apps/                  Applications
  docs/                Documentation site (Docusaurus)
  ui/                  Web editor and visualizer
```

## Next Steps

- [Installation](/getting-started/installation) -- DevContainer and local setup details.
- [Language Guide](/language/syntax) -- Learn AgentScript syntax in depth.
- [Architecture](/architecture/overview) -- Understand how the toolchain fits together.
