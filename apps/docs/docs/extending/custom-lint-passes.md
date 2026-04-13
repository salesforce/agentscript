---
sidebar_position: 1
---

# Custom Lint Passes

The AgentScript lint engine is extensible -- you can add custom validation rules alongside the 15 built-in passes. There are two approaches: the `defineRule` helper for straightforward validation rules, and the full `LintPass` interface for complex passes that need AST walking or data extraction.

## Using defineRule

The `defineRule` helper is the simplest way to create a validation rule. It resolves typed dependencies from the `PassStore` and invokes your `run` callback with them:

```typescript
import {
  defineRule,
  each,
  storeKey,
  symbolTableKey,
  attachDiagnostic,
  DiagnosticSeverity,
} from '@agentscript/language';
import {
  typeMapKey,
  reasoningActionsKey,
} from '@agentscript/agentscript-dialect';
import type { ReasoningActionEntry } from '@agentscript/agentscript-dialect';

const myRule = defineRule({
  id: 'my-custom/check-action-descriptions',
  description: 'Ensure reasoning actions have descriptions',
  deps: {
    action: each(reasoningActionsKey),
  },
  run({ action }) {
    // action is a single ReasoningActionEntry (iterated per element)
    if (!action.description && action.node.__cst) {
      attachDiagnostic(action.node, {
        message: 'Reasoning action should have a description',
        severity: DiagnosticSeverity.Warning,
        code: 'my-custom/missing-action-description',
      });
    }
  },
});
```

Dependencies declared with `each(key)` cause the `run` callback to be invoked once per element in the array-valued store entry. At most one `each()` dependency is allowed per rule. Plain store key dependencies resolve to the full value.

The `defineRule` function signature:

```typescript
function defineRule<const TDeps extends Record<string, Dep>>(config: {
  id: string;
  description: string;
  deps: TDeps;
  run(deps: ResolveDeps<TDeps>): void;
}): LintPass;
```

All dependencies are resolved from the `PassStore` and type-checked at compile time via `ResolveDeps<TDeps>`.

## Implementing LintPass Directly

For passes that need to walk the AST, extract data into the store, or perform multi-phase analysis, implement the `LintPass` interface directly:

```typescript
interface LintPass {
  readonly id: StoreKey<unknown>;
  readonly description: string;
  readonly finalizeAfter?: readonly StoreKey<unknown>[];
  readonly requires?: readonly StoreKey<unknown>[];
  init?(): void;
  visitVariables?(variables: NamedMap<unknown>): void;
  visitExpression?(expr: AstNodeLike, ctx: ScopeContext): void;
  enterNode?(key: string, value: unknown, parent: unknown): void;
  exitNode?(key: string, value: unknown, parent: unknown): void;
  finalize?(store: PassStore, root: AstRoot): void;
  run?(store: PassStore, root: AstRoot): void;
}
```

All hooks are optional. A pass implements only what it needs:

- **Analyzer passes** use visitor hooks (`enterNode`, `exitNode`, `visitExpression`, `visitVariables`) to walk the AST, then write extracted data to the `PassStore` in `finalize()`.
- **Validation passes** use `run()` to read data from the store and attach diagnostics.

Here is a skeleton for a pass that collects data during AST walking and validates it afterward:

```typescript
import { storeKey, attachDiagnostic, DiagnosticSeverity } from '@agentscript/language';
import type { LintPass, PassStore, AstRoot, AstNodeLike, ScopeContext } from '@agentscript/language';

interface CollectedData {
  expressionCount: number;
}

const collectedDataKey = storeKey<CollectedData>('my-custom/collected-data');

const myAnalyzerPass: LintPass = {
  id: collectedDataKey,
  description: 'Collect and validate expression usage',

  // No finalizeAfter needed -- this pass has no store dependencies for finalize
  // No requires needed -- this pass does not consume other store entries in run()

  _count: 0,

  init() {
    this._count = 0;
  },

  visitExpression(expr: AstNodeLike, ctx: ScopeContext) {
    this._count++;
  },

  finalize(store: PassStore, root: AstRoot) {
    store.set(collectedDataKey, { expressionCount: this._count });
  },

  run(store: PassStore, root: AstRoot) {
    const data = store.get(collectedDataKey);
    if (data && data.expressionCount === 0) {
      attachDiagnostic(root, {
        message: 'Document contains no expressions',
        severity: DiagnosticSeverity.Information,
        code: 'my-custom/no-expressions',
      });
    }
  },
} as LintPass;
```

## Adding Passes to the Engine

Add your custom pass to the pre-loaded engine created by `createLintEngine`:

```typescript
import { createLintEngine } from '@agentscript/agentscript-dialect';

const engine = createLintEngine(); // pre-loaded with 15 default rules
engine.addPass(myRule);            // add custom rule
```

Or build an engine from scratch with full control over which passes are included:

```typescript
import { LintEngine } from '@agentscript/language';
import { defaultRules } from '@agentscript/agentscript-dialect';

const engine = new LintEngine({
  passes: [...defaultRules(), myRule],
  source: 'my-lint',
});
```

You can also selectively disable built-in rules:

```typescript
const engine = createLintEngine();
engine.disable(someBuiltinPassId); // disable by StoreKey id
engine.addPass(myReplacementRule);
```

Use `engine.enable(id)` to re-enable a previously disabled pass.

## Key Concepts

### Store Keys

`storeKey<T>(name)` creates a typed key for sharing data between passes via the `PassStore`. Each key can only be set once per engine run -- attempting to overwrite throws an error.

```typescript
const myDataKey = storeKey<MyData>('my-custom/data');

// In finalize():
store.set(myDataKey, extractedData);

// In another pass's run():
const data = store.get(myDataKey); // Returns MyData | undefined
```

### Known Store Keys

Several store keys are exported for use in custom rules:

- `symbolTableKey` from `@agentscript/language` -- the resolved symbol table
- `typeMapKey` from `@agentscript/agentscript-dialect` -- type information for variables, actions, inputs, and outputs
- `reasoningActionsKey` from `@agentscript/agentscript-dialect` -- collected reasoning action entries

### Dependency Ordering

- **`finalizeAfter`** -- declares store keys that must be populated before this pass's `finalize()` runs. The engine topologically sorts finalize calls based on these declarations.
- **`requires`** -- declares store keys that must exist in the `PassStore` before `run()` executes. If a required key is absent, the pass is skipped with an informational diagnostic rather than failing the pipeline.

### Iteration with each()

When using `defineRule`, wrap a store key with `each(key)` to iterate over its array elements. The `run` callback is invoked once per element. At most one `each()` dependency is allowed per rule:

```typescript
const rule = defineRule({
  id: 'my-rule',
  description: 'Check each action',
  deps: {
    symbols: symbolTableKey,        // resolved once as full value
    action: each(reasoningActionsKey), // iterated per element
  },
  run({ symbols, action }) {
    // symbols: SymbolTable (full value)
    // action: single ReasoningActionEntry
  },
});
```

## Available Store Keys

These exported store keys can be used as dependencies in custom lint passes:

**From `@agentscript/language`:**

| Key | Type | Description |
| --- | --- | --- |
| `symbolTableKey` | Symbol table data | Scoped symbol declarations built from the AST |
| `constraintValidationKey` | Constraint results | Results from field constraint validation |
| `positionIndexKey` | `PositionIndex` | Position-to-node index for cursor-based lookups |

**From `@agentscript/agentscript-dialect`:**

| Key | Type | Description |
| --- | --- | --- |
| `typeMapKey` | `TypeMap` | Type information for variables, actions, inputs, and outputs |
| `reasoningActionsKey` | `ReasoningActionEntry[]` | Collected reasoning action binding entries |

Import example:

```typescript
import { symbolTableKey, positionIndexKey } from '@agentscript/language';
import { typeMapKey, reasoningActionsKey } from '@agentscript/agentscript-dialect';
```
