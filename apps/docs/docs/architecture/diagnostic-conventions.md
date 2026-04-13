---
sidebar_position: 4
---

# Diagnostic Conventions

This page documents the conventions for creating and structuring diagnostics in the AgentScript toolchain. All diagnostics are [LSP-compliant](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#diagnostic) and can be consumed directly by language servers and editor extensions.

## Diagnostic Interface

Every diagnostic conforms to this interface:

```typescript
interface Diagnostic {
  range: Range;
  message: string;
  severity: DiagnosticSeverity;
  code?: string;
  source?: string;
  tags?: DiagnosticTag[];
  data?: { [key: string]: unknown };
}
```

## Severity Levels

Severity values match the LSP specification and **must not** be changed:

| Value | Name          | When to Use                                                |
|-------|---------------|------------------------------------------------------------|
| 1     | `Error`       | Invalid code that will fail at runtime or cannot be compiled |
| 2     | `Warning`     | Likely mistakes or deprecated usage that still compiles      |
| 3     | `Information` | Suggestions or system-level notices (e.g., skipped passes)   |
| 4     | `Hint`        | Style hints or minor improvements                            |

## Diagnostic Tags

| Value | Name          | When to Use                        |
|-------|---------------|------------------------------------|
| 1     | `Unnecessary` | Dead code or unreachable statements |
| 2     | `Deprecated`  | Usage of deprecated fields or APIs  |

Editors typically render `Unnecessary` as faded text and `Deprecated` as strikethrough.

## Code Format

Diagnostic codes use **kebab-case**: `syntax-error`, `undefined-reference`, `missing-required-field`.

Codes should be descriptive and scoped to the check they represent. Prefer specific codes over generic ones — `action-unknown-input` is better than `invalid-parameter`.

### Common Codes

| Code                     | Source              | Description                                  |
|--------------------------|---------------------|----------------------------------------------|
| `syntax-error`           | `parser`            | Tree-sitter parse error                      |
| `missing-token`          | `parser`            | Expected token not found                     |
| `type-mismatch`          | `agentscript-schema`| Value type doesn't match field schema        |
| `missing-required-field` | `agentscript-lint`  | Required field absent from block             |
| `duplicate-key`          | `agentscript-lint`  | Same key appears twice in a block            |
| `undefined-reference`    | `agentscript-lint`  | Reference to unknown variable/tool definition/subagent   |
| `deprecated-field`       | `agentscript`       | Field marked as deprecated in schema         |
| `unreachable-code`       | `agentscript-lint`  | Code after an unconditional transition        |

## Source Field

The `source` field identifies which pipeline stage produced the diagnostic. It determines how editors group and filter diagnostics.

| Source               | Phase              | Description                                |
|----------------------|--------------------|--------------------------------------------|
| `parser`             | Tree-sitter parse  | Syntax errors from CST construction        |
| `agentscript-schema` | Schema validation   | Type mismatches and structural errors       |
| `agentscript-lint`   | Lint engine         | Semantic validation rules                  |
| `agentscript`        | General             | Deprecation warnings and general notices    |

### Dialect-Specific Sources

Dialect extensions namespace their sources with a prefix:

- `agentforce/action-target` — Agentforce action URI validation
- `agentforce/connection` — Connection block validation

Use the `dialect/component` pattern when adding diagnostics from a dialect package.

## The `data` Field

The `data` field carries structured metadata for tooling (code actions, quick fixes, hover info). It is **not** displayed to users directly.

Common `data` fields:

| Field          | Type       | Purpose                                      |
|----------------|------------|----------------------------------------------|
| `suggestion`   | `string`   | "Did you mean?" candidate for quick fixes     |
| `expected`     | `string[]` | List of valid options                         |
| `found`        | `string`   | The actual invalid value                      |
| `expectedType` | `string`   | Expected type (for type mismatches)           |
| `actualType`   | `string`   | Actual type found (for type mismatches)       |
| `referenceName`| `string`   | Full reference like `@namespace.property`     |
| `context`      | `string`   | Additional context for the diagnostic         |

## Factory Functions

Use the provided factory functions rather than constructing diagnostic objects by hand.

### `createDiagnostic(rangeOrNode, message, severity?, code?, data?)`

General-purpose factory for schema validation diagnostics. Accepts a `Range`, `SyntaxNode`, or any AST node with `__cst`. Source defaults to `'agentscript-schema'`.

### `createParserDiagnostic(rangeOrNode, message, code)`

Parser-level errors only. Source is always `'parser'`. Code must be `'syntax-error'` or `'missing-token'`.

### `undefinedReferenceDiagnostic(range, message, referenceName, suggestion?, expected?)`

For undefined reference errors. Automatically appends "Did you mean?" hints via `formatSuggestionHint()`.

### `typeMismatchDiagnostic(range, message, expectedType, actualType, source?)`

For type checking errors. Populates `data.expectedType` and `data.actualType`.

### `lintDiagnostic(range, message, severity, code, options?)`

Standard lint diagnostic with source `'agentscript-lint'`. Accepts optional `suggestion` and `tags`.

### `attachDiagnostic(node, diagnostic)`

Attaches a diagnostic to an AST node's `__diagnostics` array. Always use this instead of pushing directly — it validates the node is a proper AST node.

## DiagnosticCollector

When parsing blocks that produce child parse results, use `DiagnosticCollector` to manage two-level tracking:

```typescript
const collector = new DiagnosticCollector();

// Diagnostic generated at this level → pushed to both own and all
collector.add(someDiagnostic);

// Child parse result → only pushed to all (avoids duplication)
collector.merge(childParseResult);

// Attach own diagnostics to the current node
node.__diagnostics = collector.own;

// Return all diagnostics in the parse result
return { value: node, diagnostics: collector.all };
```

This eliminates the error-prone pattern of manually pushing to both `own` and `all` arrays.

## Fuzzy Suggestions

When reporting undefined references, provide "Did you mean?" suggestions using the built-in fuzzy matching:

```typescript
import { findSuggestion, formatSuggestionHint } from '@agentscript/language';

const suggestion = findSuggestion(unknownName, validNames);
const message = formatSuggestionHint(
  `Unknown action '${unknownName}'`,
  suggestion
);
// → "Unknown action 'getWeaher'. Did you mean 'getWeather'?"
```

The default threshold is 40% of the longer string's length (Levenshtein distance). Only suggest if the match is plausible — don't suggest `"foo"` for `"authentication"`.

## Diagnostic Positioning

Place diagnostics on the most specific range possible:

- **Field-level errors**: Point to the field value, not the entire block
- **Missing fields**: Point to the block header (declaration line)
- **Expression errors**: Point to the specific sub-expression
- **Duplicate keys**: Point to the duplicate occurrence, not the first

Use `toRange(syntaxNode)` to convert CST nodes to LSP ranges. For block headers, navigate to the parent `mapping_element`'s key node.
