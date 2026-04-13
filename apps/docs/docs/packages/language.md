---
sidebar_position: 2
---

# @agentscript/language

The core package providing language infrastructure for AgentScript. It defines the AST types, dialect parsing, lint engine, analysis APIs, and the stateful `LanguageService` consumed by editors.

## Schema Building

Define block schemas that describe the structure of an AgentScript document.

### Block Factories

- `Block(name, fields, opts)` -- Create a block type with named fields.
- `NamedBlock(name, fields, opts)` -- Block that takes a name (e.g., `subagent Order_Management:`).
- `CollectionBlock(blockFactory)` -- Collection of named blocks.
- `TypedMap(fields)` -- Map with typed fields.

### Field Types

- `StringValue` -- String field.
- `NumberValue` -- Numeric field.
- `BooleanValue` -- Boolean field.
- `ProcedureValue` -- Procedure (multi-line instruction body).
- `ExpressionValue` -- Inline expression.
- `ReferenceValue` -- Reference to another block or symbol.

### Builder Methods

Field types support chaining to add metadata and constraints:

- `.describe(text)` -- Add a description shown in hover/completions.
- `.required()` -- Mark the field as required (triggers lint if missing).
- `.accepts([values])` -- Restrict to a set of allowed values.
- `.example(text)` -- Provide an example value for documentation.
- `.pattern(regex)` -- Validate against a regular expression.
- `.omitArrow()` -- Suppress the `=>` arrow syntax for this field.

### Variants and Discriminants

Block and NamedBlock factories support polymorphic schemas via variants:

- `.variant(name, fields)` -- Add a variant schema that extends the base fields.
- `.discriminant(fieldName)` -- Use a field value (instead of the instance name) to select the variant.

See [Custom Dialects > Block Variants](../extending/custom-dialects.mdx#block-variants) for detailed examples.

## AST Types

### Core

- `AstRoot` -- Root of the parsed document.
- `AstNode` / `AstNodeLike` -- Base AST node types.
- `Parsed<T>` -- Parsed wrapper carrying CST metadata and diagnostics.

### Expression Types

`StringLiteral`, `NumberLiteral`, `BooleanLiteral`, `NoneLiteral`, `Identifier`, `AtIdentifier`, `MemberExpression`, `BinaryExpression`, `ComparisonExpression`, `TernaryExpression`, `CallExpression`, `ListLiteral`, `DictLiteral`, `Ellipsis`, `TemplateExpression`

### Statement Types

`Template`, `WithClause`, `SetClause`, `RunStatement`, `IfStatement`, `TransitionStatement`, `AvailableWhen`

## Dialect Parsing

- `Dialect` class -- Walks the CST and builds a typed AST from a schema.
- `parseAndLint(cstNode, dialectConfig)` -- One-shot parse + lint pipeline for CLI/CI use.

## Lint Engine

The lint engine runs a set of passes over the parsed AST to produce diagnostics. See [Lint System](/architecture/lint-system) for a detailed architecture guide.

### Core API

- `LintPass` interface -- Implement to define a lint rule.
- `LintEngine` class -- Orchestrates pass execution.
- `PassStore` / `storeKey<T>()` -- Typed storage shared between passes.
- `defineRule()` helper -- Convenience wrapper for creating rules.
- `each()` -- Declare iteration dependencies between passes.

### Built-in Passes

The following passes ship with the language package:

- `symbolTableAnalyzer` -- Builds symbol table for reference resolution.
- `duplicateKeyPass` -- Detects duplicate keys within a block.
- `requiredFieldPass` -- Flags missing required fields.
- `singularCollectionPass` -- Ensures singular blocks appear at most once.
- `constraintValidationPass` -- Validates field constraints (patterns, accepted values).
- `positionIndexPass` -- Verifies positional field ordering.
- `unreachableCodePass` -- Detects unreachable statements after transitions.
- `emptyBlockPass` -- Warns on empty blocks.
- `expressionValidationPass` -- Validates expression syntax and types.
- `undefinedReferencePass` -- Flags references to undefined symbols.

## Analysis

Analysis functions power editor features. They are consumed by `LanguageService` and the LSP.

- **Completions**: `getCompletionCandidates()`, `getFieldCompletions()`, `getAvailableNamespaces()`
- **References**: `findDefinitionAtPosition()`, `findReferencesAtPosition()`, `resolveReference()`
- **Symbols**: `getDocumentSymbols()`
- **Hover**: `resolveHover()`, `resolveSchemaField()`
- **Scope**: `createSchemaContext()`, `findEnclosingScope()`
- **Semantic tokens**: `generateSemanticTokens()`

## LanguageService

The `LanguageService` is a stateful API designed for editor integration. It holds the current AST and diagnostics, and exposes analysis methods at document positions.

```typescript
interface LanguageService {
  update(cstNode: SyntaxNode): void;
  readonly ast: AstRoot | null;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly store: PassStore | null;
  getSymbols(): DocumentSymbol[];
  getDefinition(line: number, char: number): DefinitionResult | null;
  getReferences(line: number, char: number): ReferenceOccurrence[];
  getCompletions(line: number, char: number, namespace: string): CompletionCandidate[];
  getNamespaceCompletions(line: number, char: number): CompletionCandidate[];
  getFieldCompletions(line: number, char: number): CompletionCandidate[];
  getEnclosingScope(line: number, char: number): ScopeContext;
}
```

Create an instance with:

```typescript
import { createLanguageService } from '@agentscript/language';

const service = createLanguageService({ dialect: dialectConfig });
```

Call `service.update(cstNode)` after each parse to refresh the AST and diagnostics, then query completions, definitions, references, and other features at specific document positions.
