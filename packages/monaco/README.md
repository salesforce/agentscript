# @agentscript/monaco

Monaco Editor integration for AgentScript with tree-sitter syntax highlighting.

## Features

- Tree-sitter-based syntax highlighting via web worker
- Monaco language configuration (brackets, auto-closing, indentation)
- Theme support (light/dark)
- Hover provider integration
- Schema resolver for keyword and field documentation
- Parser API for errors and highlights

## Installation

```bash
npm install @agentscript/monaco
```

## Usage

### Basic Syntax Highlighting

```typescript
import * as monaco from 'monaco-editor';
import { registerAgentScriptLanguage, lightTheme } from '@agentscript/monaco';

// Register the language with Monaco
registerAgentScriptLanguage(monaco);

// Define the theme
monaco.editor.defineTheme('agentscript-light', lightTheme);

// Create an editor instance
const editor = monaco.editor.create(document.getElementById('container'), {
  value: '# @dialect:agentforce\n\nfn main() {\n  print("Hello World")\n}',
  language: 'agentscript',
  theme: 'agentscript-light'
});
```

## LSP Extension for VSCode API Compatibility Layers

If you're using a Monaco editor with a VSCode API compatibility layer (like `monaco-vscode-api`), you can get full LSP support including autocomplete, hover, diagnostics, go-to-definition, and more.

### Installation

The LSP extension requires the `@agentscript/lsp-browser` server bundle to be available.

### Usage

```typescript
import { createLspExtension } from '@agentscript/monaco';

// Create the LSP extension
const extension = createLspExtension({
  // URL to the LSP server worker bundle
  serverUrl: '/path/to/lsp-browser-server.js',
  
  // Extension version (optional)
  version: '2.2.41',
  
  // Document patterns to match (optional, defaults shown)
  documentPatterns: ['**/*.agent', '**/*.afscript'],
  
  // Dialect configuration function (optional, defaults to 'agentforce')
  dialectConfig: () => 'agentforce'
});

// In your editor initialization with VSCode API wrapper:
const result = await extension.activate(vscodeWrapper);

// Use result.languageClientConfig with your language client
// Example with vscode-languageclient:
const languageClient = new LanguageClient(
  result.languageClientConfig.languageId,
  result.languageClientConfig.clientOptions,
  result.languageClientConfig.connection
);

await languageClient.start();
```

### Configuration

The LSP extension supports the following VSCode settings:

- `agentscript.dialect`: Select the AgentScript dialect (`'agentforce'` or `'agentscript'`)
- `agentscript.trace.server`: Trace LSP communication (`'off'`, `'messages'`, or `'verbose'`)

### Requirements

The LSP extension requires:
1. A Monaco editor with VSCode API compatibility layer that provides:
   - `vscodeApi.VSCodeLanguageClientBrowser.BrowserMessageReader`
   - `vscodeApi.VSCodeLanguageClientBrowser.BrowserMessageWriter`
2. The `@agentscript/lsp-browser` server bundle deployed and accessible

### Example: Salesforce Core Integration

```typescript
import { createLspExtension } from '@agentscript/monaco';
import { AGENTSCRIPT_LSP_VERSION } from './agentScriptVersions';

const extension = createLspExtension({
  serverUrl: `/projRes/extensions/agentscript-extension/${AGENTSCRIPT_LSP_VERSION}/server/server.browser.js`,
  version: AGENTSCRIPT_LSP_VERSION,
  documentPatterns: ['**/*.agent', '**/*.afscript'],
  dialectConfig: () => 'agentforce'
});

// Later in editor initialization:
const { languageClientConfig } = await extension.activate(vscodeWrapper);
```

## API

See the TypeScript definitions for full API documentation.

### Main Exports

- `registerAgentScriptLanguage(monaco)` - Register AgentScript language with Monaco
- `languageConfiguration` - Language configuration for brackets, auto-closing, etc.
- `lightTheme`, `darkTheme` - Pre-defined themes
- `createHoverProvider(schemaInfo)` - Create hover provider for Monaco
- `initializeParser()` - Initialize tree-sitter parser
- `parseAgentScript(code)` - Parse AgentScript code
- `createLspExtension(config)` - Create LSP extension for VSCode API compat layers

## License

Apache-2.0
