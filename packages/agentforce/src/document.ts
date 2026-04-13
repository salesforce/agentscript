/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Document class — the primary return type of `parse()`.
 *
 * Wraps the parsed AST with mutation helpers, undo/redo, and emission.
 * All mutations go through `mutate()` which keeps the document's
 * `__children` in sync with root-level property changes.
 */

import type { AstRoot, FieldType, InferFieldType } from '@agentscript/language';
import type { Diagnostic } from '@agentscript/types';
import { DiagnosticSeverity } from '@agentscript/types';
import { emitDocument, isNamedMap, PassStore } from '@agentscript/language';
import { parseAndLint } from '@agentscript/language';
import {
  AgentforceSchema,
  agentforceDialect,
} from '@agentscript/agentforce-dialect';
import type {
  ParsedAgentforce,
  AgentforceSchema as AgentforceSchemaType,
} from '@agentscript/agentforce-dialect';
import type {
  AgentScriptParser,
  MutationHelpers,
  HistoryEntry,
  SingularKeys,
  NamedKeys,
} from './types.js';
import {
  syncSingularField,
  addNamedEntryChild,
  removeNamedEntryChild,
} from './children-sync.js';
import {
  buildMutationHelpers,
  type ChildrenSyncStrategy,
} from './mutate-component.js';

const schema = AgentforceSchema as Record<string, FieldType>;

export class Document {
  private _ast: ParsedAgentforce;
  private _diagnostics: readonly Diagnostic[];
  private _parser: AgentScriptParser;
  private _isDirty: boolean;
  private _history: HistoryEntry[];
  private _historyIndex: number;
  private _redoStack: HistoryEntry[];

  private constructor(
    ast: ParsedAgentforce,
    diagnostics: readonly Diagnostic[],
    _store: PassStore,
    parser: AgentScriptParser
  ) {
    this._ast = ast;
    this._diagnostics = diagnostics;
    this._parser = parser;
    this._isDirty = false;
    this._history = [];
    this._historyIndex = 0;
    this._redoStack = [];
  }

  /** @internal Factory used by `parse()`. */
  static create(
    ast: ParsedAgentforce,
    diagnostics: readonly Diagnostic[],
    store: PassStore,
    parser: AgentScriptParser
  ): Document {
    return new Document(ast, diagnostics, store, parser);
  }

  /** @internal Factory for creating an empty document (used when parse fails). */
  static empty(diagnostics: readonly Diagnostic[]): Document {
    const emptyAst = {
      __cst: {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
      },
      __diagnostics: [...diagnostics],
      __children: [],
    } as unknown as ParsedAgentforce;

    // Create a no-op parser for the empty document (undo/redo won't be used)
    const noopParser: AgentScriptParser = {
      parse: () => ({
        rootNode:
          emptyAst as unknown as import('@agentscript/types').SyntaxNode,
      }),
    };
    return new Document(emptyAst, diagnostics, new PassStore(), noopParser);
  }

  // ---------------------------------------------------------------------------
  // Read-only properties
  // ---------------------------------------------------------------------------

  get ast(): ParsedAgentforce {
    return this._ast;
  }

  get diagnostics(): readonly Diagnostic[] {
    return this._diagnostics;
  }

  get hasErrors(): boolean {
    return this._diagnostics.some(d => d.severity === DiagnosticSeverity.Error);
  }

  get errors(): Diagnostic[] {
    return this._diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );
  }

  get warnings(): Diagnostic[] {
    return this._diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Warning
    );
  }

  // ---------------------------------------------------------------------------
  // Emission
  // ---------------------------------------------------------------------------

  emit(options?: { tabSize?: number }): string {
    return emitDocument(this._ast, schema, options);
  }

  // ---------------------------------------------------------------------------
  // Core mutation
  // ---------------------------------------------------------------------------

  /**
   * Apply a mutation to the AST in-place.
   *
   * Creates an undo point (source snapshot before the mutation).
   * After `fn` executes, auto-syncs document `__children` for singular
   * root-level property changes. For named entries, use the `helpers`.
   */
  mutate(
    fn: (
      ast: ParsedAgentforce,
      helpers: MutationHelpers<ParsedAgentforce>
    ) => void,
    label?: string
  ): this {
    // 1. Snapshot current source for undo
    const source = this.emit();
    this._history.splice(this._historyIndex);
    this._history.push({ source, label, timestamp: Date.now() });
    this._historyIndex = this._history.length;
    this._redoStack = [];

    // 2. Snapshot root property references (for auto-sync of singular blocks)
    const before = new Map<string, unknown>();
    for (const key of Object.keys(schema)) {
      before.set(key, this._ast[key]);
    }

    // 3. Build helpers (shared implementation with mutateComponent)
    const astRoot = this._ast as AstRoot;
    const sync: ChildrenSyncStrategy = {
      syncField: (key, value) => syncSingularField(astRoot, key, value, schema),
      addNamedChild: (key, name, value) =>
        addNamedEntryChild(astRoot, key, name, value, schema),
      removeNamedChild: (key, name) =>
        removeNamedEntryChild(astRoot, key, name),
    };
    const helpers = buildMutationHelpers(this._ast, schema, sync);

    // 4. Execute mutation
    fn(this._ast, helpers);

    // 5. Auto-sync: detect singular root property changes
    for (const key of Object.keys(schema)) {
      const prev = before.get(key);
      const curr = this._ast[key];
      if (curr !== prev && !isNamedMap(curr)) {
        syncSingularField(this._ast as AstRoot, key, curr, schema);
      }
    }

    this._isDirty = true;
    return this;
  }

  // ---------------------------------------------------------------------------
  // Convenience mutations
  // ---------------------------------------------------------------------------

  /** Add/replace a singular root-level block. Handles `__children`. */
  setField<K extends SingularKeys>(
    key: K,
    value: InferFieldType<AgentforceSchemaType[K]>,
    label?: string
  ): this {
    return this.mutate((_ast, helpers) => helpers.setField(key, value), label);
  }

  /** Remove a singular root-level block. Handles `__children`. */
  removeField(key: SingularKeys, label?: string): this {
    return this.mutate((_ast, helpers) => helpers.removeField(key), label);
  }

  /** Add a named entry (topic, connection, etc.). Handles NamedMap + document `__children`. */
  addEntry<K extends NamedKeys>(
    key: K,
    name: string,
    value: InferFieldType<AgentforceSchemaType[K]>,
    label?: string
  ): this {
    return this.mutate(
      (_ast, helpers) => helpers.addEntry(key, name, value),
      label
    );
  }

  /** Remove a named entry. Handles NamedMap + document `__children`. */
  removeEntry(key: NamedKeys, name: string, label?: string): this {
    return this.mutate(
      (_ast, helpers) => helpers.removeEntry(key, name),
      label
    );
  }

  // ---------------------------------------------------------------------------
  // Undo / Redo
  // ---------------------------------------------------------------------------

  get canUndo(): boolean {
    return this._historyIndex > 0;
  }

  get canRedo(): boolean {
    return this._redoStack.length > 0;
  }

  get isDirty(): boolean {
    return this._isDirty;
  }

  undo(): this {
    if (!this.canUndo) return this;

    // Save current state to redo stack
    const currentSource = this.emit();
    const lastEntry = this._history[this._historyIndex - 1];
    this._redoStack.push({
      source: currentSource,
      label: lastEntry.label,
      timestamp: Date.now(),
    });

    // Restore from history
    this._historyIndex--;
    const entry = this._history[this._historyIndex];
    this._parseFrom(entry.source);
    this._isDirty = false;
    return this;
  }

  redo(): this {
    if (!this.canRedo) return this;

    // Save current state to history
    const currentSource = this.emit();
    const redoEntry = this._redoStack[this._redoStack.length - 1];
    this._history.splice(this._historyIndex);
    this._history.push({
      source: currentSource,
      label: redoEntry.label,
      timestamp: Date.now(),
    });
    this._historyIndex = this._history.length;

    // Restore from redo stack
    const entry = this._redoStack.pop()!;
    this._parseFrom(entry.source);
    this._isDirty = false;
    return this;
  }

  // ---------------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------------

  get history(): readonly HistoryEntry[] {
    return this._history;
  }

  get historyIndex(): number {
    return this._historyIndex;
  }

  /**
   * Get before/after source for diffing.
   * Defaults to comparing the state before the last mutation to the current state.
   */
  getDiff(
    fromIndex?: number,
    toIndex?: number
  ): { before: string; after: string } {
    const from = fromIndex ?? Math.max(0, this._historyIndex - 1);
    const before =
      from < this._history.length ? this._history[from].source : '';
    const after =
      toIndex !== undefined && toIndex < this._history.length
        ? this._history[toIndex].source
        : this.emit();
    return { before, after };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private _parseFrom(source: string): void {
    const tree = this._parser.parse(source);
    const result = parseAndLint(tree.rootNode, agentforceDialect);
    this._ast = result.ast as ParsedAgentforce;
    this._diagnostics = result.diagnostics;
  }
}
