/**
 * Linting infrastructure for AgentScript.
 *
 * Execution order:
 *   1. init() on all passes
 *   2. Single AST walk dispatching visitor hooks
 *   3. finalize(store, root) in topological order (data extraction)
 *   4. run(store, root) with requires check (validation)
 */

import type { Diagnostic } from '../diagnostics.js';
import { DiagnosticSeverity } from '../diagnostics.js';
import type { AstRoot, AstNodeLike } from '../types.js';
import type { NamedMap } from '../block.js';
import { isNamedMap, isAstNodeLike } from '../types.js';
import type { ScopeContext, SchemaContext } from './scope.js';
import { collectDiagnostics, dispatchAstChildren } from './ast-walkers.js';

/** A branded string that carries value type `T` at the type level. */
export type StoreKey<T> = string & { readonly __type: T };

/** Create a typed store key. */
export function storeKey<T = never>(name: string): StoreKey<T> {
  // SAFETY: phantom brand — StoreKey<T> is string with type-level __type
  return name as StoreKey<T>;
}

/**
 * Key-value store for sharing data between lint passes.
 * Each key can only be set once -- attempting to overwrite throws.
 */
export class PassStore {
  private data = new Map<string, unknown>();

  set<T>(key: StoreKey<T>, value: T): void {
    if (this.data.has(key)) {
      throw new Error(`PassStore key '${key}' already set — cannot overwrite`);
    }
    this.data.set(key, value);
  }

  get<T>(key: StoreKey<T>): T | undefined {
    // SAFETY: PassStore.set<T> stores by branded StoreKey<T>, ensuring type correspondence
    return this.data.get(key) as T | undefined;
  }

  has(key: StoreKey<unknown>): boolean {
    return this.data.has(key);
  }

  update<T>(key: StoreKey<T>, fn: (current: T) => T): void {
    const current = this.get(key);
    if (current === undefined) {
      throw new Error(`PassStore key '${key}' not set — cannot update`);
    }
    this.data.set(key, fn(current));
  }
}

/**
 * A lint pass that can participate in AST walking, data extraction, and validation.
 * All hooks are optional -- implement only what your pass needs.
 */
export interface LintPass {
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

/**
 * Marker for an iteration dependency in defineRule.
 * Wraps a store key so that the rule iterates the result per element.
 */
export interface EachDep<T> {
  readonly __each: true;
  readonly key: StoreKey<unknown>;
  readonly selector?: (source: never) => T[];
}

/**
 * Mark a dependency for per-item iteration in defineRule.
 *
 * With a selector, the stored value is transformed into an array first.
 * At most one each() dep is allowed per rule.
 */
export function each<T>(key: StoreKey<T[]>): EachDep<T>;
export function each<S, T>(
  key: StoreKey<S>,
  selector: (source: S) => T[]
): EachDep<T>;
export function each(
  key: StoreKey<unknown>,
  selector?: (source: unknown) => unknown[]
): EachDep<unknown> {
  return { __each: true as const, key, ...(selector ? { selector } : {}) };
}

/** A dependency is either a direct StoreKey or an each-wrapped StoreKey. */
export type Dep = StoreKey<unknown> | EachDep<unknown>;

/** Resolve a single dep: StoreKey<T> -> T, EachDep<T> -> T (element). */
type ResolveDep<D> =
  D extends EachDep<infer T> ? T : D extends StoreKey<infer V> ? V : never;

/** Map a deps record to its resolved types. */
export type ResolveDeps<TDeps extends Record<string, Dep>> = {
  [K in keyof TDeps]: ResolveDep<TDeps[K]>;
};

function isEachDep(dep: Dep): dep is EachDep<unknown> {
  return typeof dep === 'object' && dep !== null && '__each' in dep;
}

/**
 * Create a LintPass with strongly-typed, named dependencies.
 *
 * Declare deps as a record; the factory resolves them from PassStore and
 * passes them as a typed object to your `run` callback. Use `each(key)`
 * for array-valued deps that should be iterated per element.
 *
 * At most one `each()` dep is allowed per rule. For multiple iterable
 * deps, implement `LintPass` directly.
 */
export function defineRule<const TDeps extends Record<string, Dep>>(config: {
  id: string;
  description: string;
  deps: TDeps;
  run(deps: ResolveDeps<TDeps>): void;
}): LintPass {
  const requires: StoreKey<unknown>[] = [];
  let eachName: string | undefined;
  let eachStoreKey: StoreKey<unknown> | undefined;
  let eachSelector: ((source: unknown) => unknown[]) | undefined;

  for (const [name, dep] of Object.entries(config.deps)) {
    if (isEachDep(dep)) {
      if (eachName !== undefined) {
        throw new Error(
          `defineRule('${config.id}'): only one each() dep allowed, ` +
            `found '${eachName}' and '${name}'`
        );
      }
      eachName = name;
      eachStoreKey = dep.key;
      // SAFETY: widening never→unknown is safe; we only call with store-retrieved values
      eachSelector = dep.selector as
        | ((source: unknown) => unknown[])
        | undefined;
      requires.push(dep.key);
    } else {
      requires.push(dep);
    }
  }

  return {
    id: storeKey(config.id),
    description: config.description,
    requires,

    run(store: PassStore, _root: AstRoot): void {
      const resolved: Record<string, unknown> = {};
      for (const [name, dep] of Object.entries(config.deps)) {
        if (!isEachDep(dep)) {
          resolved[name] = store.get(dep);
        }
      }

      if (eachName && eachStoreKey) {
        const raw = store.get(eachStoreKey);
        if (raw == null) return;
        const items = eachSelector
          ? eachSelector(raw)
          : Array.isArray(raw)
            ? raw
            : [];
        for (const item of items) {
          // SAFETY: resolved constructed from config.deps, matching ResolveDeps shape
          config.run({ ...resolved, [eachName]: item } as ResolveDeps<TDeps>);
        }
      } else {
        // SAFETY: resolved constructed from config.deps, matching ResolveDeps shape
        config.run(resolved as ResolveDeps<TDeps>);
      }
    },
  };
}

/** Thrown when pass finalize dependencies cannot be resolved. */
export class DependencyResolutionError extends Error {
  constructor(
    message: string,
    public readonly missingDependencies?: string[],
    public readonly cyclicDependencies?: string[]
  ) {
    super(message);
    this.name = 'DependencyResolutionError';
  }
}

interface PassSets {
  visitVariables: LintPass[];
  visitExpression: LintPass[];
  enterNode: LintPass[];
  exitNode: LintPass[];
}

function partitionPasses(passes: LintPass[]): PassSets {
  return {
    visitVariables: passes.filter(p => p.visitVariables),
    visitExpression: passes.filter(p => p.visitExpression),
    enterNode: passes.filter(p => p.enterNode),
    exitNode: passes.filter(p => p.exitNode),
  };
}

/** Store key for the SchemaContext passed into the engine run. */
export const schemaContextKey = storeKey<SchemaContext>('schema-context');

/**
 * Lint engine that orchestrates all passes against an AST.
 *
 * Performs a single recursive AST walk dispatching to all pass visitor hooks,
 * then runs finalize (toposorted) and run (requires-gated) phases.
 */
export class LintEngine {
  private readonly passes = new Map<string, LintPass>();
  private readonly disabled = new Set<string>();
  private readonly source: string;

  constructor(options?: { passes?: readonly LintPass[]; source?: string }) {
    this.source = options?.source ?? 'lint';
    for (const p of options?.passes ?? []) this.addPass(p);
  }

  /** Register a pass. Throws on duplicate id. */
  addPass(pass: LintPass): this {
    if (this.passes.has(pass.id)) {
      throw new Error(`Duplicate lint id: '${pass.id}'`);
    }
    this.passes.set(pass.id, pass);
    return this;
  }

  /** Disable a pass by id. */
  disable(id: string): this {
    if (!this.passes.has(id)) {
      throw new Error(`Cannot disable unknown lint id: '${id}'`);
    }
    this.disabled.add(id);
    return this;
  }

  /** Re-enable a previously disabled pass. */
  enable(id: string): this {
    if (!this.passes.has(id)) {
      throw new Error(`Cannot enable unknown lint id: '${id}'`);
    }
    this.disabled.delete(id);
    return this;
  }

  /**
   * Run all enabled passes against the AST.
   *
   * Mutates the AST by clearing diagnostics with this engine's source tag
   * during the walk phase, ensuring re-runs produce fresh results.
   */
  run(
    root: AstRoot,
    ctx: SchemaContext
  ): { diagnostics: Diagnostic[]; store: PassStore } {
    const store = new PassStore();
    store.set(schemaContextKey, ctx);
    const systemDiagnostics: Diagnostic[] = [];
    const failed = new Set<string>();

    const enabled = [...this.passes.values()].filter(
      p => !this.disabled.has(p.id)
    );

    // Phase 1: Init
    for (const pass of enabled) {
      if (pass.init) {
        try {
          pass.init();
        } catch (error: unknown) {
          failed.add(pass.id);
          systemDiagnostics.push(
            this.systemDiagnostic(
              `Pass '${pass.id}' init failed: ${error instanceof Error ? error.message : String(error)}`,
              'lint-pass-error'
            )
          );
        }
      }
    }

    // Phase 2: Walk
    const active = enabled.filter(p => !failed.has(p.id));
    const sets = partitionPasses(active);

    this.dispatchTargetedHooks(root, sets, failed, systemDiagnostics);

    this.walkNode(
      root,
      sets,
      {},
      '',
      undefined,
      new Set(),
      failed,
      systemDiagnostics
    );

    // Phase 3: Finalize (toposorted)
    const finalizePasses = active.filter(p => p.finalize);
    const finalizeOrder = this.sortFinalize(finalizePasses, failed);
    for (const pass of finalizeOrder) {
      if (failed.has(pass.id)) continue;

      const missingDep = pass.finalizeAfter?.find(dep => !store.has(dep));
      if (missingDep) {
        failed.add(pass.id);
        systemDiagnostics.push(
          this.systemDiagnostic(
            `Pass '${pass.id}' skipped: required data '${missingDep}' not available`,
            'lint-pass-skipped'
          )
        );
        continue;
      }

      try {
        pass.finalize!(store, root);
      } catch (error: unknown) {
        failed.add(pass.id);
        systemDiagnostics.push(
          this.systemDiagnostic(
            `Pass '${pass.id}' finalize failed: ${error instanceof Error ? error.message : String(error)}`,
            'lint-pass-error'
          )
        );
      }
    }

    // Phase 4: Run (requires-gated)
    const runPasses = active.filter(p => p.run);
    for (const pass of runPasses) {
      if (failed.has(pass.id)) continue;

      const missingKey = pass.requires?.find(key => !store.has(key));
      if (missingKey) {
        systemDiagnostics.push(
          this.systemDiagnostic(
            `Pass '${pass.id}' skipped: required data '${missingKey}' not available`,
            'lint-pass-skipped'
          )
        );
        continue;
      }

      try {
        pass.run!(store, root);
      } catch (error: unknown) {
        systemDiagnostics.push(
          this.systemDiagnostic(
            `Pass '${pass.id}' run failed: ${error instanceof Error ? error.message : String(error)}`,
            'lint-pass-error'
          )
        );
      }
    }

    const nodeDiagnostics = collectDiagnostics(root);
    return {
      diagnostics: [...nodeDiagnostics, ...systemDiagnostics],
      store,
    };
  }

  /**
   * Dispatch targeted hooks (visitVariables) at root level.
   * Gives passes access to specific AST regions without enterNode/exitNode.
   */
  private dispatchTargetedHooks(
    root: AstRoot,
    sets: PassSets,
    failed: Set<string>,
    systemDiagnostics: Diagnostic[]
  ): void {
    if (sets.visitVariables.length > 0) {
      const varsMap = root.variables;
      if (isNamedMap(varsMap)) {
        for (const p of sets.visitVariables) {
          if (failed.has(p.id)) continue;
          try {
            p.visitVariables!(varsMap);
          } catch (error: unknown) {
            failed.add(p.id);
            systemDiagnostics.push(
              this.systemDiagnostic(
                `Pass '${p.id}' visitVariables failed: ${error instanceof Error ? error.message : String(error)}`,
                'lint-pass-error'
              )
            );
          }
        }
      }
    }
  }

  /**
   * Recursive walk dispatching to all pass visitors.
   * Also clears lint diagnostics from previous runs.
   */
  private walkNode(
    value: unknown,
    sets: PassSets,
    ctx: ScopeContext,
    key: string,
    parent: unknown,
    visited: Set<unknown>,
    failed: Set<string>,
    systemDiagnostics: Diagnostic[]
  ): void {
    if (!value || typeof value !== 'object') return;
    if (visited.has(value)) return;
    visited.add(value);

    // Arrays (e.g. statements) are not AstNodeLike but may contain AST children.
    if (Array.isArray(value)) {
      for (const item of value) {
        this.walkNode(
          item,
          sets,
          ctx,
          '',
          value,
          visited,
          failed,
          systemDiagnostics
        );
      }
      return;
    }

    if (!isAstNodeLike(value)) return;

    // Clear lint diagnostics from previous run
    const diags = value.__diagnostics;
    if (Array.isArray(diags)) {
      value.__diagnostics = diags.filter(
        (d: Diagnostic) => d.source !== this.source
      );
    }

    for (const p of sets.enterNode) {
      if (failed.has(p.id)) continue;
      try {
        p.enterNode!(key, value, parent);
      } catch (error: unknown) {
        failed.add(p.id);
        systemDiagnostics.push(
          this.systemDiagnostic(
            `Pass '${p.id}' enterNode failed: ${error instanceof Error ? error.message : String(error)}`,
            'lint-pass-error'
          )
        );
      }
    }

    dispatchAstChildren(
      value,
      ctx,
      (exprObj, exprCtx) => {
        for (const p of sets.visitExpression) {
          if (failed.has(p.id)) continue;
          try {
            p.visitExpression!(exprObj, exprCtx);
          } catch (error: unknown) {
            failed.add(p.id);
            systemDiagnostics.push(
              this.systemDiagnostic(
                `Pass '${p.id}' visitExpression failed: ${error instanceof Error ? error.message : String(error)}`,
                'lint-pass-error'
              )
            );
          }
        }
      },
      (child, childCtx, childKey, childParent) => {
        this.walkNode(
          child,
          sets,
          childCtx,
          childKey,
          childParent,
          visited,
          failed,
          systemDiagnostics
        );
      }
    );

    for (const p of sets.exitNode) {
      if (failed.has(p.id)) continue;
      try {
        p.exitNode!(key, value, parent);
      } catch (error: unknown) {
        failed.add(p.id);
        systemDiagnostics.push(
          this.systemDiagnostic(
            `Pass '${p.id}' exitNode failed: ${error instanceof Error ? error.message : String(error)}`,
            'lint-pass-error'
          )
        );
      }
    }
  }

  /** Topologically sort passes for finalize() ordering using Kahn's algorithm. */
  private sortFinalize(passes: LintPass[], failed: Set<string>): LintPass[] {
    const active = passes.filter(p => !failed.has(p.id));
    if (active.length === 0) return [];

    const byId = new Map<string, LintPass>();
    for (const p of active) byId.set(p.id, p);

    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, Set<string>>();
    for (const p of active) {
      inDegree.set(p.id, 0);
      adjacency.set(p.id, new Set());
    }

    for (const p of active) {
      for (const depKey of p.finalizeAfter ?? []) {
        if (byId.has(depKey)) {
          adjacency.get(depKey)!.add(p.id);
          inDegree.set(p.id, (inDegree.get(p.id) ?? 0) + 1);
        }
      }
    }

    const queue: string[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) queue.push(id);
    }

    const sorted: LintPass[] = [];
    let head = 0;
    while (head < queue.length) {
      const id = queue[head++];
      sorted.push(byId.get(id)!);

      for (const dependent of adjacency.get(id) ?? []) {
        const newDegree = (inDegree.get(dependent) ?? 1) - 1;
        inDegree.set(dependent, newDegree);
        if (newDegree === 0) queue.push(dependent);
      }
    }

    if (sorted.length !== active.length) {
      const unsorted = active
        .filter(p => !sorted.some(s => s.id === p.id))
        .map(p => p.id);
      throw new DependencyResolutionError(
        `Cyclic finalize dependencies among: ${unsorted.join(', ')}`,
        undefined,
        unsorted
      );
    }

    return sorted;
  }

  private systemDiagnostic(message: string, code: string): Diagnostic {
    return {
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      },
      message,
      severity: DiagnosticSeverity.Information,
      code,
      source: this.source,
    };
  }
}
