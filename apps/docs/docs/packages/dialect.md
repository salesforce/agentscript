---
sidebar_position: 3
---

# Dialects

A dialect defines the schema (block types and fields), validation rules (lint passes), and metadata for a specific variant of the AgentScript language.

## DialectConfig

Every dialect exports a `DialectConfig` that plugs into the language layer:

```typescript
interface DialectConfig {
  readonly name: string;
  readonly displayName: string;
  readonly description: string;
  readonly version: string;
  readonly schemaInfo: SchemaInfo;
  readonly createRules: () => LintPass[];
  readonly source?: string;
}
```

The `schemaInfo` field carries the full block schema, aliases, and global scope definitions. The `createRules` factory produces the lint passes that run during `parseAndLint`.

## AgentScript Dialect

**Package**: `@agentscript/agentscript-dialect` (`dialect/agentscript`)

The base dialect defining core AgentScript blocks. All other dialects build on top of this foundation.

### Schema Exports

The following block definitions are exported individually:

`SystemBlock`, `ConfigBlock`, `LanguageBlock`, `TopicBlock`, `ConnectedSubagentBlock`, `ReasoningBlock`, `ReasoningActionBlock`, `VariablesBlock`, `ActionsBlock`, `InputsBlock`, `OutputsBlock`

### Composite Exports

- `AgentScriptSchema` -- Complete schema record containing all block definitions.
- `AgentScriptSchemaInfo` -- Schema metadata including aliases and global scopes (`@utils`, `@system_variables`).
- `agentscriptDialect` -- Pre-built `DialectConfig` instance ready to pass to `createLanguageService`.

### Lint Rules

- `createLintEngine()` -- Creates a `LintEngine` pre-loaded with all 15 default rules.
- `defaultRules()` -- Returns the 15 lint passes as an array.

### Parsed Types

Typed wrappers for parsed document structures:

`ParsedDocument`, `ParsedTopic`, `ParsedAction`, `ParsedReasoning`, and corresponding types for each block in the schema.

## Agentforce Dialect

**Package**: `@agentscript/agentforce-dialect` (`dialect/agentforce`)

Extends the base AgentScript dialect with Salesforce-specific blocks and additional lint rules for Agentforce platform requirements.

### Additional Blocks

- **Knowledge**: `KnowledgeBlock`
- **Connections**: `ConnectionBlock`, `ConnectionsBlock`
- **Security**: `SecurityBlock`
- **Related Agents**: `RelatedAgentBlock`, `RelatedAgentsBlock`
- **Modality**: `ModalityBlock`
- **Voice Configuration**: `AdditionalConfigsBlock`, `SpeakUpConfigBlock`, `EndpointingConfigBlock`, `BeepBoopConfigBlock`
- **Keywords and Pronunciation**: `InboundKeywordsBlock`, `PronunciationDictEntryBlock`

### Usage

```typescript
import { agentforceDialect } from '@agentscript/agentforce-dialect';
import { createLanguageService } from '@agentscript/language';

const service = createLanguageService({ dialect: agentforceDialect });
```

## Creating a Custom Dialect

To create a custom dialect:

1. Define your block schemas using `Block`, `NamedBlock`, and `CollectionBlock` from `@agentscript/language`.
2. Assemble a `SchemaInfo` with block definitions, aliases, and global scopes.
3. Write lint passes implementing the `LintPass` interface.
4. Export a `DialectConfig` object combining the schema and rules.

The base AgentScript dialect (`dialect/agentscript`) serves as the reference implementation.
