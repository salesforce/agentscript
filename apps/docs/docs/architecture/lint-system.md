---
sidebar_position: 3
---

# Lint System

The lint system in `@agentscript/language` provides a multi-phase validation pipeline with typed data sharing between passes.

## LintPass Interface

Every lint pass implements the `LintPass` interface:

```typescript
interface LintPass {
  readonly id: StoreKey<unknown>;
  readonly description: string;

  /** StoreKeys that must be populated before finalize() runs. */
  readonly finalizeAfter?: readonly StoreKey<unknown>[];

  /** StoreKeys required in PassStore before run(). Missing keys skip run(). */
  readonly requires?: readonly StoreKey<unknown>[];

  init?(): void;
  visitVariables?(variables: NamedMap<unknown>): void;
  visitExpression?(expr: AstNodeLike, ctx: ScopeContext): void;
  enterNode?(key: string, value: unknown, parent: unknown): void;
  exitNode?(key: string, value: unknown, parent: unknown): void;

  /** Store extracted data after the walk. Toposorted by finalizeAfter. */
  finalize?(store: PassStore, root: AstRoot): void;

  /** Validate and attach diagnostics. Runs after all finalizes. */
  run?(store: PassStore, root: AstRoot): void;
}
```

All hooks are optional. A pass implements only what it needs: analyzer passes typically use visitor hooks and `finalize()` to extract data, while validation passes use `run()` to check invariants.

## PassStore

`PassStore` is a typed key-value store for sharing data between passes:

```typescript
// Create a typed key
const symbolTableKey = storeKey<SymbolTable>('symbol-table');

// In an analyzer's finalize():
store.set(symbolTableKey, builtTable);    // Type-safe, can only set once

// In a validation pass's run():
const symbols = store.get(symbolTableKey); // Returns SymbolTable | undefined
```

Each key can only be set once -- attempting to overwrite throws an error. This ensures passes produce deterministic results regardless of execution order within a phase.

## LintEngine

The `LintEngine` orchestrates pass execution:

```typescript
const engine = new LintEngine({
  passes: dialect.createRules(),
  source: 'agentscript-lint',
});

const { diagnostics, store } = engine.run(astRoot, schemaContext);
```

The engine supports runtime pass management:

- `engine.addPass(pass)` -- register a pass (throws on duplicate `id`)
- `engine.disable(id)` -- disable a pass by its `id`
- `engine.enable(id)` -- re-enable a previously disabled pass

When `run()` executes, it filters out disabled passes, then proceeds through the four phases. Failed passes are tracked and excluded from subsequent phases. If a `finalize()` pass's `finalizeAfter` dependency is missing from the store, or a `run()` pass's `requires` key is absent, the pass is skipped with an informational diagnostic rather than failing the entire pipeline.

## defineRule Helper

The `defineRule` function provides a convenience wrapper for validation-only rules that depend on data from analyzer passes:

```typescript
const myRule = defineRule({
  id: 'my-rule',
  description: 'Check something',
  deps: {
    symbols: symbolTableKey,
    actions: each(reasoningActionsKey),
  },
  run({ symbols, actions }) {
    // `symbols` is the full SymbolTable value
    // `actions` is a single ReasoningActionEntry (iterated per element)
  },
});
```

Dependencies declared with `each(key)` cause the `run` callback to be invoked once per element in the array-valued store entry. At most one `each()` dependency is allowed per rule. All dependencies are resolved from the `PassStore` and type-checked at compile time via `ResolveDeps<TDeps>`.

## Built-in Lint Passes

The AgentScript dialect registers 15 lint passes via `defaultRules()`, listed here in their engine execution order.

### Base Passes (from `@agentscript/language`)

| # | Pass | Purpose |
|---|------|---------|
| 1 | `symbolTableAnalyzer` | Builds the symbol table from AST scope declarations |
| 2 | `duplicateKeyPass` | Detects duplicate keys within a block |
| 3 | `requiredFieldPass` | Ensures required fields are present |
| 4 | `singularCollectionPass` | Validates singular collections have exactly one entry |
| 5 | `constraintValidationPass` | Validates field constraints (patterns, accepted types) |
| 6 | `positionIndexPass` | Builds a position-to-node index for editor features |
| 7 | `unreachableCodePass` | Detects unreachable code after transitions |
| 8 | `emptyBlockPass` | Warns about empty blocks |
| 9 | `expressionValidationPass` | Validates expression types and function calls |

### AgentScript Analyzers (from `@agentscript/agentscript-dialect`)

| # | Pass | Purpose |
|---|------|---------|
| 10 | `typeMapAnalyzer` | Builds type information map for variables, actions, inputs, and outputs |
| 11 | `reasoningActionsAnalyzer` | Collects reasoning action binding entries |

### Validation Rules (from `@agentscript/agentscript-dialect`)

| # | Pass | Purpose |
|---|------|---------|
| 12 | `undefinedReferencePass` | Detects references to undefined variables, tool definitions, or subagents |
| 13 | `actionIoRule` | Validates action input/output parameter usage (with/set clauses) |
| 14 | `actionTypeCheckRule` | Type-checks action parameter assignments |
| 15 | `connectedAgentTargetPass` | Validates connected agent target URIs |

Note: `undefinedReferencePass` is defined in `@agentscript/language` but is listed under validation rules because it runs in the `run()` phase, depending on the symbol table built by `symbolTableAnalyzer`.

Passes 1-9 use visitor hooks and/or `finalize()` to extract data. Passes 10-11 are analyzers that also finalize into the `PassStore`. Passes 12-15 are pure validation rules that consume store data via `requires` and attach diagnostics to AST nodes.
