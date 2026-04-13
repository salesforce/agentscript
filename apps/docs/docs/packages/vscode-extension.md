---
sidebar_position: 6
---

# VS Code Extension

The VS Code extension (`@agentscript/vscode`) provides a full-featured editing experience for `.agent` files, powered by the AgentScript language server and tree-sitter parser.

## Features

### Syntax Highlighting

Semantic token-based highlighting with tree-sitter. The extension provides accurate, context-aware coloring for all AgentScript constructs.

### Completions

Auto-complete for `@` references, field names, and schema keys. Suggestions are context-aware and driven by the active dialect schema.

### Hover

Inline documentation for fields, keywords, and references. Hover over any symbol to see its type, description, and usage information.

### Diagnostics

Real-time error and warning display from the lint engine. Issues are surfaced as you type, with squiggly underlines and entries in the Problems panel.

### Go to Definition

Navigate to variable, tool definition, and subagent declarations. Use `Ctrl+Click` or `F12` to jump to where a symbol is defined.

### Find References

Find all usages of a symbol across the document. Use `Shift+F12` to see every location where a symbol is referenced.

### Rename

Rename symbols with all references updated automatically. Use `F2` to rename a variable, tool definition, or subagent and have every reference updated in one operation.

### Code Actions

Quick fixes for common issues:

- **Typo suggestions** for invalid modifiers and unknown types
- **Dialect name suggestions** for unknown dialect annotations
- **Version suggestions** for invalid version constraints

## Configuration

### `agentscript.dialect`

Controls which dialect schema and lint rules are used.

| Value | Description |
|---|---|
| `"agentforce"` (default) | Use the Agentforce dialect |
| `"agentscript"` | Use the AgentScript dialect |

This setting can also be overridden per-file using a dialect annotation comment:

```
# @dialect: agentforce=2.2
```

When the setting changes, the language server restarts automatically.

## Language Configuration

- **Auto-closing pairs** for `"`, `(`, `[`, `{`
- **Indentation rules** -- automatically increases indent after `:` and `->`
- **Bracket pair colorization** is disabled for AgentScript
- **Word pattern** includes `@` and `.` for proper symbol selection

## Theme Support

The extension provides semantic token color customizations for:

- **Default Dark+** -- Dark theme colors
- **Default Light+** -- Light theme colors
- **Default Light Modern** -- Light Modern theme colors
- **Default High Contrast Light** -- High contrast light colors

Token types with custom colors: keywords, modifiers, types, functions, variables, built-in constants, strings, numbers, operators, comments, namespaces, properties, and decorators.

## File Association

| Property | Value |
|---|---|
| File extension | `.agent` |
| Language ID | `agentscript` |
| First-line detection | Files starting with `# @dialect:` are auto-detected |
