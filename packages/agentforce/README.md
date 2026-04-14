# @agentscript/agentforce

Batteries-included AgentScript SDK for Agentforce — parse, mutate, emit, and lint `.agent` files with a single import.

Uses **parser-javascript** by default — a pure TypeScript parser with zero native dependencies. Tree-sitter is available as an optional backend for environments that need it.

## Installation

```bash
pnpm add @agentscript/agentforce
```

No additional dependencies are needed. The default parser (parser-javascript) is pure TypeScript and works in Node.js and browsers out of the box.

### Optional: Tree-sitter Backend

If you need tree-sitter as the parser backend (e.g., for compatibility or performance testing), use the tree-sitter build:

```bash
pnpm build:tree-sitter
```

This passes the `tree-sitter` exports condition to esbuild, which resolves `@agentscript/parser` to its native tree-sitter entry point.

**Node.js** — install native bindings:

```bash
pnpm add tree-sitter @agentscript/parser
```

**Browser** — install the WASM-based web-tree-sitter package:

```bash
pnpm add web-tree-sitter
```

## Quick Start

### Node.js

```typescript
import { parse } from '@agentscript/agentforce';

const doc = parse(`
system:
    instructions: "You are a helpful agent."

topic billing:
    description: "Handle billing inquiries"
`);

console.log(doc.hasErrors);   // false
console.log(doc.diagnostics); // []
console.log(doc.emit());      // formatted source
```

### Browser (Default — parser-javascript)

The default parser is pure TypeScript, so no WASM or native modules are needed in the browser. Just import and use:

```typescript
import { parse } from '@agentscript/agentforce';

const doc = parse(source);
console.log(doc.emit());
```

### Browser (Tree-sitter WASM)

When using tree-sitter in the browser, call `init()` to load WASM binaries before parsing:

```typescript
import { init, parse } from '@agentscript/agentforce';

await init();  // loads tree-sitter WASM — required before first parse
const doc = parse(source);
console.log(doc.emit());
```

## Build Modes

- **`pnpm build`** — default build using parser-javascript. Produces a simple Node.js ESM bundle with no native dependencies.
- **`pnpm build:tree-sitter`** — tree-sitter mode. Generates browser ESM, browser IIFE, and WASM constants bundles.

## Package Exports

| Export Path | Description |
|-------------|-------------|
| `@agentscript/agentforce` | Default entry point (parser-javascript) |
| `@agentscript/agentforce/browser` | Browser ESM bundle with web-tree-sitter support |
| `@agentscript/agentforce/browser.iife.js` | Self-contained IIFE bundle (includes web-tree-sitter) |
| `@agentscript/agentforce/wasm` | WASM constants (`TREE_SITTER_ENGINE_BASE64`, `TREE_SITTER_AGENTSCRIPT_BASE64`) |

## API Reference

### `parse(source): Document`

Parse a complete AgentScript source string into a `Document`.

```typescript
const doc = parse(source);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `source` | `string` | AgentScript source text |

Never throws — if parsing fails, returns a `Document` with an empty AST and a diagnostic describing the error.

Returns a `Document` with the parsed AST, diagnostics, and full mutation API.

---

### `parseComponent(source, kind, parser)`

Parse an isolated block, statement, or expression. The result is suitable for plugging into `Document.addEntry()` or `Document.setField()`.

```typescript
// Parse a block — return type is inferred from the kind
const topic = parseComponent(
  'topic billing:\n    description: "Handle billing"',
  'topic',
  parser,
);

// Parse statements
const stmts = parseComponent('run MyAction()', 'statement', parser);

// Parse an expression
const expr = parseComponent('"hello " + name', 'expression', parser);
```

**Block kinds** — any key from the Agentforce schema:

| Kind | Returns |
|------|---------|
| `'config'` | `ParsedConfig` |
| `'system'` | System block |
| `'topic'` | `ParsedTopic` |
| `'variables'` | Variables block |
| `'actions'` | Actions block |
| `'knowledge'` | `ParsedKnowledge` |
| `'connection'` | `ParsedConnection` |
| `'related_agent'` | `ParsedRelatedAgent` |
| `'language'` | Language block |
| `'model_config'` | Model config block |
| `'before_reasoning'` | Before reasoning block |
| `'reasoning'` | Reasoning block |
| `'after_reasoning'` | After reasoning block |
| `'security'` | Security block |
| `'modality'` | Modality block |

**Special kinds:**

| Kind | Returns |
|------|---------|
| `'statement'` | `Statement[]` |
| `'expression'` | `Expression \| undefined` |

---

### `emitComponent(component, options?): string`

Emit a standalone component (block, statement array, single statement, or expression) back to AgentScript source text.

`emitComponent` automatically syncs block properties before emitting, so directly assigned fields are always emitted correctly:

```typescript
import { parseComponent, emitComponent } from '@agentscript/agentforce';
import { StringLiteral } from '@agentscript/agentforce';

const topic = parseComponent(
  'topic billing:\n    description: "Handle billing"',
  'topic',
  parser,
);

// Assign fields directly — emitComponent auto-syncs
topic.description = new StringLiteral('Updated billing');
topic.source = new StringLiteral('billing_v2');       // new schema field
topic.custom_field = new StringLiteral('custom');      // non-schema field — also works

emitComponent(topic);      // all three fields are emitted correctly
emitComponent(topic, { tabSize: 2 }); // with custom indentation
```

Also works with statements and expressions:

```typescript
const stmts = parseComponent('run MyAction()', 'statement', parser);
emitComponent(stmts);           // 'run MyAction()'

const expr = parseComponent('"hello"', 'expression', parser);
emitComponent(expr);            // '"hello"'

emitComponent(undefined);       // ''
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `component` | `BlockCore \| Statement[] \| Statement \| Expression \| undefined` | Anything returned by `parseComponent()` |
| `options.tabSize` | `number` | Indentation width (default: 4) |

---

### `mutateComponent(block, fn): block`

For operations that can't be expressed as simple property assignment — **removing fields** and **NamedMap add/remove** — use `mutateComponent()`:

```typescript
import { parseComponent, emitComponent, mutateComponent } from '@agentscript/agentforce';

const topic = parseComponent(
  'topic billing:\n    description: "Handle billing"\n    source: "v1"',
  'topic',
  parser,
);

mutateComponent(topic!, (block, helpers) => {
  helpers.removeField('source');
  helpers.addEntry('actions', 'myAction', actionBlock);
  helpers.removeEntry('actions', 'oldAction');
});

emitComponent(topic);
```

| Method | Description |
|--------|-------------|
| `setField(key, value)` | Set a field value (new or existing). |
| `removeField(key)` | Remove a field and its accessor. |
| `addEntry(key, name, value)` | Add a named entry to a NamedMap field. |
| `removeEntry(key, name)` | Remove a named entry from a NamedMap field. |

Returns the same block instance for chaining.

---

### `Document`

The primary return type of `parse()`. Wraps the parsed AST with mutation helpers, undo/redo, and emission.

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `ast` | `ParsedAgentforce` | The parsed AST root |
| `diagnostics` | `readonly Diagnostic[]` | All parse, schema, and lint diagnostics |
| `hasErrors` | `boolean` | `true` if any diagnostic is Error severity |
| `errors` | `Diagnostic[]` | Error-severity diagnostics only |
| `warnings` | `Diagnostic[]` | Warning-severity diagnostics only |
| `isDirty` | `boolean` | `true` if mutations have been applied since parse |
| `canUndo` | `boolean` | `true` if undo history is available |
| `canRedo` | `boolean` | `true` if redo stack is available |
| `history` | `readonly HistoryEntry[]` | Array of mutation snapshots |
| `historyIndex` | `number` | Current position in history |

#### `emit(options?): string`

Emit the current AST back to AgentScript source code.

```typescript
const source = doc.emit();
const source = doc.emit({ tabSize: 2 });
```

#### `mutate(fn, label?): this`

Apply a mutation to the AST. Creates an undo point automatically.

```typescript
doc.mutate((ast, helpers) => {
  helpers.setField('system', newSystemBlock);
  helpers.addEntry('topic', 'billing', billingTopic);
}, 'add billing topic');
```

#### Convenience Mutations

```typescript
doc.setField('config', configBlock);         // Add/replace a singular block
doc.removeField('system');                   // Remove a singular block
doc.addEntry('topic', 'billing', topic);     // Add a named entry
doc.removeEntry('topic', 'billing');          // Remove a named entry
```

All return `this` for chaining.

#### `undo() / redo(): this`

Navigate mutation history.

```typescript
doc.undo();
doc.redo();
```

#### `getDiff(fromIndex?, toIndex?): { before, after }`

Get before/after source strings for diffing. Defaults to comparing the state before the last mutation to the current state.

```typescript
const { before, after } = doc.getDiff();
```

---

### `generateParser(engineBase64, languageBase64): Promise<TreeSitterParser>`

Generate a tree-sitter parser from base64-encoded WASM binaries. This is the simplest way to use tree-sitter in browser environments, as it bundles the WASM binaries directly into your JavaScript bundle.

```typescript
import { generateParser } from '@agentscript/agentforce';
import {
  TREE_SITTER_ENGINE_BASE64,
  TREE_SITTER_AGENTSCRIPT_BASE64
} from '@agentscript/agentforce/wasm';

const parser = await generateParser(
  TREE_SITTER_ENGINE_BASE64,
  TREE_SITTER_AGENTSCRIPT_BASE64
);
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `engineBase64` | `string` | Base64-encoded tree-sitter runtime WASM binary |
| `languageBase64` | `string` | Base64-encoded AgentScript language grammar WASM binary |

Returns a `Promise<TreeSitterParser>` that resolves to a parser compatible with `parse()`.

**Note:** The WASM constants are only available after building the package with `pnpm run build`.

---

### `adaptWebTreeSitterNode(node): SyntaxNode`

Converts a web-tree-sitter `Node` to the `SyntaxNode` interface expected by the parser. Uses lazy evaluation and a WeakMap cache internally. Only needed when using the tree-sitter backend with `web-tree-sitter` in custom browser setups.

---

### Expression Constructors

For programmatic AST construction without parsing from source:

```typescript
import {
  StringLiteral,
  NumberLiteral,
  BooleanLiteral,
  NoneLiteral,
  Identifier,
  AtIdentifier,
  MemberExpression,
  TemplateExpression,
  ListLiteral,
  DictLiteral,
} from '@agentscript/agentforce';
```

---

### Diagnostics

Diagnostics follow the LSP 3.17 specification:

```typescript
import { DiagnosticSeverity, DiagnosticTag } from '@agentscript/agentforce';
import type { Diagnostic, Range, Position } from '@agentscript/agentforce';

for (const d of doc.diagnostics) {
  console.log(d.severity);  // DiagnosticSeverity.Error | Warning | Information | Hint
  console.log(d.message);   // Human-readable message
  console.log(d.range);     // { start: { line, character }, end: { line, character } }
  console.log(d.code);      // "syntax-error", "undefined-reference", etc.
  console.log(d.source);    // "agentscript" | "agentscript-schema" | "agentscript-lint"
}
```

Three diagnostic sources:

| Source | Description |
|--------|-------------|
| `"agentscript"` | Syntax errors from tree-sitter parsing |
| `"agentscript-schema"` | Schema validation (unknown blocks, type mismatches, missing fields) |
| `"agentscript-lint"` | Linting (unused variables, undefined references, unreachable code) |

---

## What Changed from `@agentscript/sf-client-parsing`

### Architecture

| | Old (`sf-client-parsing`) | New (`agentforce`) |
|---|---|---|
| **Parser** | ANTLR (bundled internally) | Tree-sitter (consumer-provided) |
| **Module format** | UMD/ESM via Webpack | ESM only |
| **Bundle** | Single webpack bundle with Node polyfills | esbuild bundle, no polyfills needed |
| **Type safety** | Loose — component parse returns `any` | Fully typed with generics and overloads |
| **AST mutation** | Not supported — parse-only | Full mutation API with undo/redo |
| **Version** | 1.2.10 | 0.1.0 |

### New Capabilities

These features did not exist in the old package:

- **Document class** — wraps AST with lifecycle management (mutate → emit)
- **AST mutation** — `mutate()`, `setField()`, `addEntry()`, `removeEntry()` with automatic `__children` sync
- **Undo/Redo** — full history stack with labeled snapshots
- **Diffing** — `getDiff()` for before/after comparisons
- **Dirty tracking** — `isDirty` flag after mutations
- **Web tree-sitter adapter** — explicit `adaptWebTreeSitterNode()` for browser environments
- **Chaining** — all mutations return `this`

### New Block Types

Block types added in the new schema that were not in the old parser:

| Block | Description |
|-------|-------------|
| `related_agent` | Reference to related agents with protocol and target |
| `security` | Security and sharing policy settings |
| `modality` | Modality configuration (e.g., voice) |

### Removed Features

| Old Feature | Replacement |
|---|---|
| `detectIndentationForClient()` | Not included. Use `emit({ tabSize })` for consistent formatting. |
| `isScriptRecoverableForClient()` | Not included. Equivalent: `parse(source, parser).emit() === source` |
| UMD/CommonJS default export | ESM only. Use named imports. |
| `AgentScriptComponent` enum (70+ values) | Replaced by schema-derived component kinds (~16 block types + `statement` + `expression`) |
| Granular sub-component parsing (e.g., `actionParameter`, `actionInputs`) | Parse the parent block and traverse the AST |

### Complete `COMPONENT_TYPE` / `AgentScriptComponent` Migration Reference

The old package exposed 70+ component types via `COMPONENT_TYPE` (frozen object) and `AgentScriptComponent` (enum). The new package replaces these with ~16 schema-derived block kinds plus `'statement'` and `'expression'`.

Every old constant is listed below with its exact migration path.

#### Top-Level Blocks (Direct Mapping)

These map 1:1 to a new `parseComponent()` kind:

| Old Constant | Old Value | New `parseComponent()` Kind |
|---|---|---|
| `AGENT_SCRIPT` | `'agentScript'` | Use `parse()` directly |
| `SYSTEM_BLOCK` | `'systemBlock'` | `'system'` |
| `CONFIG_BLOCK` | `'configBlock'` | `'config'` |
| `VARIABLES_BLOCK` | `'variablesBlock'` | `'variables'` |
| `ACTIONS_BLOCK` | `'actionsBlock'` | `'actions'` |
| `FUNCTIONS_BLOCK` | `'functionsBlock'` | `'actions'` |
| `KNOWLEDGE_BLOCK` | `'knowledgeBlock'` | `'knowledge'` |
| `LANGUAGE_BLOCK` | `'languageBlock'` | `'language'` |
| `BLOCK` | `'block'` | `'topic'` |
| `BEFORE_REASONING_DIRECTIVES` | `'beforeReasoningDirectives'` | `'before_reasoning'` |
| `AFTER_REASONING_DIRECTIVES` | `'afterReasoningDirectives'` | `'after_reasoning'` |
| `PROCEDURE_BLOCK` | `'procedureBlock'` | No longer a top-level block — procedures are inline `ProcedureValue` fields (see below) |
| `STATEMENT` | `'statement'` | `'statement'` |
| `STATEMENT_LIST` | `'statementList'` | `'statement'` |
| `EXPRESSION` | `'expression'` | `'expression'` |

#### Action Components → Parse `'actions'` Block

These are no longer standalone parse targets. Parse the `'actions'` block and access the AST:

| Old Constant | Old Value | New Approach |
|---|---|---|
| `ACTION` | `'action'` | `parseComponent(src, 'actions', parser)` → iterate entries |
| `ACTION_DEFINITION` | `'actionDefinition'` | Same as `ACTION` |
| `ACTION_BODY` | `'actionBody'` | Access action entry's body/instructions |
| `ACTION_CALL` | `'actionCall'` | Parse as `'statement'` — `run` statements are action calls |
| `ACTION_DESCRIPTION` | `'actionDescription'` | Access action entry's `.description` |
| `ACTION_INPUTS` | `'actionInputs'` | Access action entry's `.inputs` |
| `ACTION_OUTPUTS` | `'actionOutputs'` | Access action entry's `.outputs` |
| `ACTION_PARAMETER` | `'actionParameter'` | Iterate `.inputs` or `.outputs` entries |
| `ACTION_TARGET` | `'actionTarget'` | Access action entry's `.target` |
| `REASONING_ACTIONS_DECLARATION` | `'reasoningActionsDeclaration'` | Parse `'topic'` block, access `.reasoning.actions` |

#### Variable Components → Parse `'variables'` Block

| Old Constant | Old Value | New Approach |
|---|---|---|
| `VARIABLE_DECLARATION` | `'variableDeclaration'` | `parseComponent(src, 'variables', parser)` → iterate entries |
| `VARIABLE_DECLARATION_LIST` | `'variableDeclarationList'` | Same — result contains all declarations |
| `VARIABLE_ASSIGNMENT` | `'variableAssignment'` | Parse as `'statement'` |
| `VARIABLES_BODY` | `'variablesBody'` | Access variables block's `__children` |

#### Config Components → Parse `'config'` Block

| Old Constant | Old Value | New Approach |
|---|---|---|
| `CONFIG_BODY` | `'configBody'` | `parseComponent(src, 'config', parser)` → access properties |
| `CONFIG_STATEMENT` | `'configStatement'` | Access config block's individual properties |
| `CONFIG_KEY_VALUE` | `'configKeyValue'` | Same as `CONFIG_STATEMENT` |
| `CONFIG_VALUE` | `'configValue'` | Access specific property value |
| `PREDEFINED_CONFIG_KEY` | `'predefinedConfigKey'` | Config property names are schema-defined |

#### System Components → Parse `'system'` Block

| Old Constant | Old Value | New Approach |
|---|---|---|
| `SYSTEM_BODY` | `'systemBody'` | `parseComponent(src, 'system', parser)` → access properties |
| `SYSTEM_STATEMENT` | `'systemStatement'` | Access system block's properties |
| `SYSTEM_MESSAGE` | `'systemMessage'` | Access `.messages` on system block |
| `SYSTEM_MESSAGES` | `'systemMessages'` | Same as `SYSTEM_MESSAGE` |
| `TOPIC_SYSTEM_BLOCK` | `'topicSystemBlock'` | Parse `'topic'` block, access `.system` |
| `TOPIC_SYSTEM_INSTRUCTIONS` | `'topicSystemInstructions'` | Parse `'topic'` block, access `.system.instructions` |

#### Block Sub-Components → Parse Parent Block

| Old Constant | Old Value | New Approach |
|---|---|---|
| `BLOCK_BODY` | `'blockBody'` | Parse `'topic'` block, access `__children` |
| `BLOCK_DESCRIPTION` | `'blockDescription'` | Parse parent block, access `.description` |
| `BLOCK_INSTRUCTIONS` | `'blockInstructions'` | Parse parent block, access `.instructions` |
| `INSTRUCTIONS` | `'instructions'` | Parse parent block, access `.instructions` |
| `REASONING_INSTRUCTIONS` | `'reasoningInstructions'` | Parse `'topic'` block, access `.reasoning.instructions` |
| `REASONING_BLOCK` | `'reasoningBlock'` | Parse `'topic'` block, access `.reasoning` — or use `'reasoning'` kind for standalone |

#### Statement Components → Parse as `'statement'`

| Old Constant | Old Value | New Approach |
|---|---|---|
| `CONDITIONAL_STATEMENT` | `'conditionalStatement'` | `parseComponent(src, 'statement', parser)` — returns `Statement[]` with `if` nodes |
| `TRANSITION_STATEMENT` | `'transitionStatement'` | Parse as `'statement'` — transitions are statements |
| `DIRECTIVE` | `'directive'` | Parse as `'statement'` |
| `DIRECTIVES` | `'directives'` | Parse as `'statement'` |
| `UTILS_TRANSITION_DECLARATION` | `'utilsTransitionDeclaration'` | Parse as `'statement'` |
| `UTILS_ESCALATION_DECLARATION` | `'utilsEscalationDeclaration'` | Parse as `'statement'` |

#### Expression / Literal Components → Parse as `'expression'`

| Old Constant | Old Value | New Approach |
|---|---|---|
| `LITERAL` | `'literal'` | `parseComponent(src, 'expression', parser)` |
| `ARRAY_LITERAL` | `'arrayLiteral'` | Parse as `'expression'` — returns `ListLiteral` |
| `OBJECT_LITERAL` | `'objectLiteral'` | Parse as `'expression'` — returns `DictLiteral` |
| `OBJECT_PROPERTY` | `'objectProperty'` | Parse as `'expression'`, access `DictLiteral` entries |
| `BOOL_VALUE` | `'boolValue'` | Parse as `'expression'` — returns `BooleanLiteral` |
| `PROMPT_TEXT` | `'promptText'` | Parse as `'expression'` — returns `TemplateExpression` or `StringLiteral` |
| `TEMPLATE` | `'Template'` | Parse as `'expression'` — returns `TemplateExpression` |

#### Parameter / Type Components → Access via Parent

| Old Constant | Old Value | New Approach |
|---|---|---|
| `PARAMETER` | `'parameter'` | Access via parent block's inputs/outputs entries |
| `PARAMETER_DEFINITION` | `'parameterDefinition'` | Same as `PARAMETER` |
| `PARAMETER_DEFINITION_LIST` | `'parameterDefinitionList'` | Access `.inputs` or `.outputs` on parent block |
| `PARAMETER_LIST` | `'parameterList'` | Same as `PARAMETER_DEFINITION_LIST` |
| `RETURN_DEFINITION` | `'returnDefinition'` | Access `.outputs` on action block |
| `RETURN_DEFINITION_LIST` | `'returnDefinitionList'` | Same as `RETURN_DEFINITION` |
| `TYPE` | `'type'` | Type info is on variable/parameter declarations |
| `DEFAULT_VALUE` | `'defaultValue'` | Access `.defaultValue` on variable declarations |

#### Language Components → Parse `'language'` Block

| Old Constant | Old Value | New Approach |
|---|---|---|
| `LANGUAGE_BODY` | `'languageBody'` | `parseComponent(src, 'language', parser)` → access properties |
| `LANGUAGE_STATEMENT` | `'languageStatement'` | Access language block's individual properties |

#### Other

| Old Constant | Old Value | New Approach |
|---|---|---|
| `AGENT_TASK` | `'agentTask'` | Not in Agentforce schema |
| `OVERRIDE` | `'override'` | Not in Agentforce schema |
| `KNOWLEDGE_ACTION` | `'knowledgeAction'` | Parse `'knowledge'` block, access entries |
| `CONNECTION` | `'connection'` | `parseComponent(src, 'connection', parser)` |
| `MODEL_CONFIG_BLOCK` | `'modelConfigBlock'` | `parseComponent(src, 'model_config', parser)` — or access `.model_config` on topic |

#### Procedures (`PROCEDURE_BLOCK`)

Procedures are **not removed** — the `->` arrow syntax is used extensively. What changed is that procedures are no longer a standalone top-level block. They are now inline `ProcedureValue` fields that appear inside other blocks:

| Location | Syntax | Description |
|---|---|---|
| `topic.reasoning.instructions` | `instructions: ->` | Reasoning loop procedure (with arrow) |
| `topic.before_reasoning` | `before_reasoning:` | Pre-reasoning procedure (arrow omitted) |
| `topic.after_reasoning` | `after_reasoning:` | Post-reasoning procedure (arrow omitted) |
| `connection.response_actions.body` | `body: ->` | Connection response procedure (with arrow) |

Procedures contain the same statement types as before (`if`, `run`, templates, transitions, etc.).

```diff
- // Old: parse a standalone procedure block
- const proc = parseAgentScriptComponentForClient(src, COMPONENT_TYPE.PROCEDURE_BLOCK);

+ // New: procedures are inline — access via parent block
+ const doc = parse(fullSource, parser);
+ // Access reasoning instructions (ProcedureValue with ->)
+ const instructions = doc.ast.topic?.get('myTopic')?.reasoning?.instructions;
+ // instructions.statements is Statement[]
+
+ // Or parse a topic and access its before/after reasoning
+ const topic = parseComponent(topicSource, 'topic', parser);
+ const beforeReasoning = topic?.before_reasoning; // ProcedureValue
+ const afterReasoning = topic?.after_reasoning;    // ProcedureValue
```

#### Summary Pattern

The migration follows one principle: **parse the nearest top-level block, then traverse**.

```typescript
// Old: parse any sub-component directly
const result = parseAgentScriptComponentForClient(src, COMPONENT_TYPE.ACTION_INPUTS);

// New: parse the parent block, access the property
const actions = parseComponent(actionsSource, 'actions', parser);
const inputs = actions?.inputs;
```

---

## Migration Guide

### 1. Update Imports

```diff
- import {
-   parseAgentScriptForClient,
-   safeParseAgentScriptForClient,
-   parseAgentScriptComponentForClient,
-   generateAgentScriptForClient,
-   AgentScriptComponent,
- } from '@agentscript/sf-client-parsing';
- import type { Diagnostic, DiagnosticSeverity } from '@agentscript/sf-client-parsing';
+ import { parse, parseComponent, Document } from '@agentscript/agentforce';
+ import type { Diagnostic } from '@agentscript/agentforce';
+ import { DiagnosticSeverity } from '@agentscript/agentforce';
```

### 2. Set Up the Parser

The new package does not bundle a parser. You provide one:

```typescript
// Node.js
import Parser from 'tree-sitter';
import AgentScript from '@agentscript/parser-tree-sitter';

const parser = new Parser();
parser.setLanguage(AgentScript);
```

Create the parser once and reuse it for all parse calls.

### 3. Migrate `parseAgentScriptForClient`

```diff
- const result = parseAgentScriptForClient(script);
+ const doc = parse(script, parser);
+ const result = doc.ast;
```

### 4. Migrate `safeParseAgentScriptForClient`

The new `parse()` never throws and always returns diagnostics — it is inherently "safe":

```diff
- const { result, diagnostics } = safeParseAgentScriptForClient(script);
- if (diagnostics.length > 0) { /* handle errors */ }
+ const doc = parse(script, parser);
+ const result = doc.ast;
+ const diagnostics = doc.diagnostics;
+ if (doc.hasErrors) { /* handle errors */ }
```

### 5. Migrate `generateAgentScriptForClient`

Code generation is now `doc.emit()`:

```diff
- const source = generateAgentScriptForClient(astJson);
+ const source = doc.emit();
```

If you need to generate from a modified AST:

```typescript
doc.mutate((ast) => {
  // modify ast...
});
const source = doc.emit();
```

### 6. Migrate `parseAgentScriptComponentForClient`

```diff
- import { AgentScriptComponent } from '@agentscript/sf-client-parsing';
-
- const topic = parseAgentScriptComponentForClient(script, AgentScriptComponent.block);
- const config = parseAgentScriptComponentForClient(script, AgentScriptComponent.configBlock);
- const expr = parseAgentScriptComponentForClient(script, AgentScriptComponent.expression);
+ const topic = parseComponent(topicSource, 'topic', parser);
+ const config = parseComponent(configSource, 'config', parser);
+ const expr = parseComponent(exprSource, 'expression', parser);
```

### 7. Migrate `generateAgentScriptComponentForClient`

Individual blocks can emit themselves via `__emit()`:

```diff
- const source = generateAgentScriptComponentForClient(parsedTopic, AgentScriptComponent.block);
+ const source = topic.__emit();
```

### 8. Migrate Sub-Component Parsing

For fine-grained components that no longer have their own parse kind, parse the parent block and traverse:

```diff
- // Old: parse individual action inputs
- const inputs = parseAgentScriptComponentForClient(script, AgentScriptComponent.actionInputs);
+ // New: parse the actions block, access inputs from the result
+ const actions = parseComponent(actionsSource, 'actions', parser);
+ const inputs = actions?.inputs;
```

```diff
- // Old: parse a variable declaration
- const decl = parseAgentScriptComponentForClient(script, AgentScriptComponent.variableDeclaration);
+ // New: parse the variables block, iterate entries
+ const doc = parse(fullSource, parser);
+ const variables = doc.ast.variables;
```

### 9. Migrate `detectIndentationForClient`

Use `emit()` with a `tabSize` option for consistent formatting instead:

```diff
- const { type, amount, indent } = detectIndentationForClient(content);
+ const formatted = doc.emit({ tabSize: 4 });
```

### 10. Migrate `isScriptRecoverableForClient`

```diff
- const recoverable = isScriptRecoverableForClient(script, AgentScriptComponent.block);
+ const recoverable = parse(script, parser).emit() === script;
```

### 11. Migrate Diagnostic Handling

The diagnostic format is largely the same (LSP 3.17), with minor differences:

```diff
  // Severity enum — same values, different import
- import { DiagnosticSeverityEnum } from '@agentscript/sf-client-parsing';
+ import { DiagnosticSeverity } from '@agentscript/agentforce';

  // Range format — same structure
  // { start: { line, character }, end: { line, character } }

  // New: diagnostics now include a `code` string and `source` field
  for (const d of doc.diagnostics) {
    console.log(d.code);    // e.g., "syntax-error", "undefined-reference"
    console.log(d.source);  // "agentscript", "agentscript-schema", or "agentscript-lint"
+   console.log(d.tags);    // DiagnosticTag[] — Unnecessary, Deprecated
  }

- // Old: isSemanticError flag
- if (d.isSemanticError) { ... }
+ // New: check source field
+ if (d.source === 'agentscript-schema' || d.source === 'agentscript-lint') { ... }

- // Old: data.rawContent, data.offendingContent, data.suggestion
+ // New: data.context, data.expected, data.found
```

### 12. Migrate UMD/CommonJS Consumers

The old package provided a UMD default export. The new package is ESM only:

```diff
- const AgentScript = require('@agentscript/sf-client-parsing');
- AgentScript.parseAgentScriptForClient(script);
+ // Must use ESM imports
+ import { parse } from '@agentscript/agentforce';
```

If your consumer requires CommonJS, use dynamic `import()`:

```javascript
const { parse } = await import('@agentscript/agentforce');
```