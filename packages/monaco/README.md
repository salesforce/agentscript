# @agentscript/monaco

Monaco Editor integration for AgentScript. Registers the AgentScript language, provides syntax highlighting, hover information, and schema resolution for use in browser-based editors.

## Overview

This package wires up AgentScript language support for the [Monaco Editor](https://microsoft.github.io/monaco-editor/). It runs the parser in a Web Worker and provides real-time syntax highlighting, hover tooltips, and theme configuration.

## Installation

```bash
pnpm add @agentscript/monaco monaco-editor
```

`monaco-editor` is a peer dependency.

## Usage

```typescript
import { registerAgentScriptLanguage } from '@agentscript/monaco';

// Register the language with your Monaco editor instance
registerAgentScriptLanguage(monaco);
```

## Features

- Language registration for `.agent` files
- Syntax highlighting via tree-sitter queries
- Hover provider with type information
- Dark and light theme support
- Parser runs in a Web Worker (non-blocking)
- Schema-aware completions

## Scripts

```bash
pnpm build        # Build (via Vite)
pnpm typecheck    # Type-check
```

## License

MIT
