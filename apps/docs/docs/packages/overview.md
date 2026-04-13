---
sidebar_position: 1
---

# Packages Overview

The AgentScript monorepo is organized into packages grouped by responsibility. This page lists every package and explains how they connect.

## Core

| Package | npm Name | Description |
|---------|----------|-------------|
| `packages/parser-tree-sitter` | `@agentscript/parser-tree-sitter` | Tree-sitter grammar, native Node.js bindings, and WASM build (optional backend) |
| `packages/parser-javascript` | `@agentscript/parser-javascript` | Hand-written TypeScript parser (default backend) |
| `packages/parser` | `@agentscript/parser` | Unified parser entry point — backend selected via exports conditions |
| `packages/language` | `@agentscript/language` | Language infrastructure: AST types, dialect parsing, lint engine, analysis (completions, hover, references, symbols), semantic tokens |
| `packages/compiler` | `@agentscript/compiler` | Compiles parsed AST to a Salesforce runtime specification  |

## Dialects

| Package | npm Name | Description |
|---------|----------|-------------|
| `dialect/agentscript` | `@agentscript/agentscript-dialect` | Base AgentScript dialect: schema definition, 15 lint passes |
| `dialect/agentforce` | `@agentscript/agentforce-dialect` | Agentforce dialect: extends base with Salesforce-specific blocks (knowledge, connections, security, modality, voice config) and additional lint rules |

## Editor Tooling

| Package | npm Name | Description |
|---------|----------|-------------|
| `packages/lsp` | `@agentscript/lsp` | Language Server Protocol core: providers for completions, hover, diagnostics, semantic tokens, references, rename, code actions |
| `packages/lsp-server` | `@agentscript/lsp-server` | LSP transport layer for Node.js (desktop editors) |
| `packages/lsp-browser` | `@agentscript/lsp-browser` | LSP transport layer for browser environments |
| `packages/monaco` | `@agentscript/monaco` | Monaco editor integration: syntax highlighting, diagnostic markers, hover provider |
| `packages/vscode` | `@agentscript/vscode` | VS Code extension with full language support |
| `packages/cli` | `@agentscript/cli` | Command-line interface |

## Platform

| Package | npm Name | Description |
|---------|----------|-------------|
| `packages/agentforce` | `@agentscript/agentforce` | Agentforce-specific utilities and types |
| `packages/salesforce` | `@agentscript/salesforce` | Salesforce platform integration |

## Applications

| Package | npm Name | Description |
|---------|----------|-------------|
| `apps/docs` | `@agentscript/docs` | Documentation site (Docusaurus v3, port 27000) |
| `apps/ui` | `@agentscript/ui` | Web-based editor and agent visualizer (React, Vite) |

## Testing

| Package | npm Name | Description |
|---------|----------|-------------|
| `packages/test-scripts` | `@agentscript/test-scripts` | Test utilities and example `.agent` scripts |

## How Packages Relate

The packages form a layered pipeline:

- **`parser`** delegates to either **`parser-javascript`** (default) or **`parser-tree-sitter`** (tree-sitter) based on the `tree-sitter` exports condition, producing a concrete syntax tree (CST) from `.agent` source text.
- **`language`** consumes the CST via the `SyntaxNode` interface from `@agentscript/types` and, using a Dialect's schema and lint rules, builds a typed AST with diagnostics. It also exposes analysis APIs (completions, hover, references, symbols) through `LanguageService`.
- **`compiler`** takes the parsed AST and produces Salesforce runtime specification.

Dialects (`agentscript-dialect`, `agentforce-dialect`) define the schemas and lint rules that `language` consumes. Each dialect is a self-contained configuration plugged into the language layer.

Editor tools (`lsp`, `monaco`, `vscode`) sit on top of `language`'s `LanguageService`, translating its analysis results into editor-specific protocols and APIs.
