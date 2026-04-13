---
sidebar_position: 3
---

# Language Service

The `LanguageService` is a stateful API designed for editor integration. It holds the current AST, diagnostics, and `PassStore`, and exposes language intelligence methods at document positions. LSP servers, the Monaco integration, and the VS Code extension all consume this interface.

## Creating a LanguageService

```typescript
import { createLanguageService } from '@agentscript/language';
import { agentscriptDialect } from '@agentscript/agentscript-dialect';

const service = createLanguageService({ dialect: agentscriptDialect });
```

You can pass any `DialectConfig` -- the built-in `agentscriptDialect`, the `agentforceDialect`, or a [custom dialect](./custom-dialects.mdx).

## Updating Content

Call `service.update(cstNode)` with a tree-sitter CST `SyntaxNode` whenever the document changes. This triggers the full parsing and linting pipeline. Afterward, access the results through read-only properties:

- `service.ast` -- the parsed `AstRoot`, or `null` if no update has been performed.
- `service.diagnostics` -- a `ReadonlyArray<Diagnostic>` with all validation results.
- `service.store` -- the `PassStore` populated by analyzer passes, or `null` before the first update.

The service also exposes the configuration it was created with:

- `service.schemaContext` -- the resolved `SchemaContext` from the dialect.
- `service.dialectConfig` -- the `DialectConfig` passed at creation.

## Language Intelligence

The `LanguageService` interface provides position-based queries for editor features. All line and character parameters are zero-based.

### Document Symbols

```typescript
const symbols = service.getSymbols();
```

Returns a `DocumentSymbol[]` representing the document outline -- blocks, subagents (formerly topics), tool definitions, and other named elements. Editors use this for the outline view and breadcrumb navigation.

### Go to Definition

```typescript
const result = service.getDefinition(line, char);
```

Returns a `DefinitionResult` pointing to the declaration site of the symbol at the given position, or `null` if no definition is found. Works for variable references, tool definition references, and subagent transitions.

### Find References

```typescript
const refs = service.getReferences(line, char, includeDeclaration);
```

Returns all `ReferenceOccurrence` entries for the symbol at the given position. The optional `includeDeclaration` parameter (default `false`) controls whether the declaration site itself is included in the results.

### Completions

The service provides three completion methods for different contexts:

```typescript
// Namespace member completions (e.g., after typing "@variables.")
const members = service.getCompletions(line, char, namespace);

// Top-level namespace completions (e.g., after typing "@")
const namespaces = service.getNamespaceCompletions(line, char);

// Schema field completions (e.g., inside a block)
const fields = service.getFieldCompletions(line, char);
```

Each returns a `CompletionCandidate[]` with label, kind, and documentation metadata.

### Scope Context

```typescript
const scope = service.getEnclosingScope(line, char);
```

Returns the `ScopeContext` at the given position -- the enclosing block, topic, or other scope boundary. This is useful for determining what symbols are visible at a given location.

## Full Interface

```typescript
interface LanguageService {
  update(cstNode: SyntaxNode): void;
  readonly ast: AstRoot | null;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly store: PassStore | null;
  getSymbols(): DocumentSymbol[];
  getDefinition(line: number, char: number): DefinitionResult | null;
  getReferences(line: number, char: number, includeDeclaration?: boolean): ReferenceOccurrence[];
  getCompletions(line: number, char: number, namespace: string): CompletionCandidate[];
  getNamespaceCompletions(line: number, char: number): CompletionCandidate[];
  getFieldCompletions(line: number, char: number): CompletionCandidate[];
  getEnclosingScope(line: number, char: number): ScopeContext;
  readonly schemaContext: SchemaContext;
  readonly dialectConfig: DialectConfig;
}
```

## Stateless Alternative: parseAndLint

For CLI tools, CI pipelines, or batch processing where you do not need incremental updates, use `parseAndLint` instead:

```typescript
import { parseAndLint } from '@agentscript/language';
import { agentscriptDialect } from '@agentscript/agentscript-dialect';

const { ast, diagnostics, store } = parseAndLint(cstNode, agentscriptDialect);
```

This runs the same parsing and linting pipeline as `LanguageService.update()` but returns results directly without maintaining state. It accepts an optional third `options` parameter for configuration.

## Additional LSP Features

Beyond the core LanguageService, the LSP providers offer:

### Code Actions (Quick Fixes)

The LSP provides automatic fix suggestions for common issues:

- **Invalid modifier**: Suggests correct modifier when a typo is detected (e.g., `mutabel` → `mutable`)
- **Unknown type**: Suggests valid types when an unknown type is used
- **Unknown dialect**: Suggests valid dialect names in `# @dialect:` annotations
- **Invalid version**: Suggests valid version formats

### Rename

Rename a symbol and all its references across the document:

```typescript
provideRename(state, line, char, newName): WorkspaceEdit
```

### Workspace Symbols

Search for symbols across the document by name pattern, useful for quick navigation.

## How Editor Integrations Use the Service

The `LanguageService` is the common foundation for all editor support:

- **LSP server** -- wraps `LanguageService` methods into LSP protocol responses (`textDocument/completion`, `textDocument/definition`, `textDocument/references`, etc.). The LSP server calls `service.update()` on each `textDocument/didChange` notification.
- **Monaco package** -- uses the service to produce diagnostic markers, provide completions, and resolve hover information in the browser-based editor.
- **VS Code extension** -- connects to the LSP server, which in turn delegates to `LanguageService`.

This layered design means custom dialects automatically get full editor support -- create a `DialectConfig`, pass it to `createLanguageService`, and all language intelligence features work without additional wiring.
