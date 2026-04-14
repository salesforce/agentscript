# AgentScript for VS Code

Language support for AgentScript (`.agent` files) in Visual Studio Code.

## Installation

Install from the VS Code marketplace by searching for **AgentScript**, or build from source:

```bash
pnpm build --filter @agentscript/vscode
```

To create a `.vsix` package first run pre-checks, clean, build, then stage all files. Finally, build the package :

```bash
cd packages/vscode
pnpm prepackage
pnpm package
```

To build a pre-release package (existing installs do not auto-update to this version) do:

```bash
cd packages/vscode
pnpm prepackage
pnpm package:prerelease
```

Then install via `code --install-extension agentscript-*.vsix`.

## Architecture

The extension spawns `@agentscript/lsp-server` as a child process via IPC. The server is bundled into `dist/server.mjs` at build time using esbuild (with `highlights.scm` inlined as a string constant).

```
VS Code
  └─ extension.ts (LanguageClient)
       └─ IPC ─→ dist/server.mjs (@agentscript/lsp-server)
                   └─ @agentscript/lsp (core providers)
```

Changing the `agentscript.dialect` setting automatically restarts the language server.

## Development

```bash
pnpm build --filter @agentscript/vscode   # Build extension + server
pnpm dev --filter @agentscript/vscode     # Watch mode
pnpm typecheck --filter @agentscript/vscode
pnpm prepackage # run pre-checks and stage all files for packaging
pnpm package # Build a vsix file for install or publish from the staging directory
```

To test in VS Code, press **F5** to launch the Extension Development Host (requires the extension folder open in VS Code).
