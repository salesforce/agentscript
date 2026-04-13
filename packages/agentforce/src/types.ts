/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { SyntaxNode, Diagnostic } from '@agentscript/types';
import type {
  InferEntryType,
  BlockCore,
  NamedMap,
} from '@agentscript/language';
import type { AgentforceSchema as AgentforceSchemaType } from '@agentscript/agentforce-dialect';

/**
 * JSON-serializable representation of a CST node.
 * Preserves all CST node metadata needed for debug views.
 */
export interface SerializedCSTNode {
  type: string;
  text?: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  children?: SerializedCSTNode[];
  fieldName?: string | null;
  isNamed: boolean;
  hasError: boolean;
  isMissing: boolean;
}

/**
 * Full parse result from `parseComponentDebug()`.
 *
 * Generic over `T` so the `component` field carries the same type safety as
 * `parseComponent()`.  Defaults to `unknown` for backward-compatible usage.
 */
export interface ParseComponentDebugResult<T = unknown> {
  /** The extracted component (block instance, or undefined on failure). */
  component: T | undefined;
  /** Serialized CST with positions adjusted to the user's original source. */
  cst: SerializedCSTNode | null;
  /** Parse and lint diagnostics. */
  diagnostics: Diagnostic[];
}

/**
 * Internal parser interface.
 *
 * Used internally by `parseComponent()`, `parseComponentDebug()`, and `AgentforceDocument`.
 */
export interface AgentScriptParser {
  parse(source: string): { rootNode: SyntaxNode };
}

/**
 * Valid component kinds for `parseComponent()`.
 *
 * Schema block keys map to their respective block types in the Agentforce schema.
 * `'statement'` and `'expression'` are special kinds for parsing isolated statements
 * and expressions respectively.
 *
 * In JavaScript, these are just strings — no import needed.
 */
export type ComponentKind =
  | keyof AgentforceSchemaType
  | 'statement'
  | 'expression'
  | 'action'
  | 'actions'
  | 'reasoning_actions';

/**
 * Maps each schema block key to its parsed block type (single entry, not NamedMap).
 *
 * Uses `InferEntryType` which, for collection factories, follows the `entryBlock`
 * reference to get the single-entry parsed type (exactly what `parseComponent()`
 * returns via `extractNamedEntry`). For non-collection types it falls back to
 * `InferFieldType`.
 */
export type ComponentResultMap = {
  [K in keyof AgentforceSchemaType]: InferEntryType<
    AgentforceSchemaType[K]
  > extends BlockCore
    ? InferEntryType<AgentforceSchemaType[K]>
    : never;
};

/**
 * Schema keys whose FieldType holds named entries (NamedBlock or CollectionBlock).
 * These keys accept named entries via `addEntry()` / `removeEntry()`.
 */
export type NamedKeys = {
  [K in keyof AgentforceSchemaType]: AgentforceSchemaType[K] extends {
    isNamed: true;
  }
    ? K
    : AgentforceSchemaType[K] extends { __isCollection: true }
      ? K
      : never;
}[keyof AgentforceSchemaType];

/**
 * Schema keys whose FieldType does NOT hold named entries (singular blocks).
 * These keys accept direct values via `setField()` / `removeField()`.
 */
export type SingularKeys = {
  [K in keyof AgentforceSchemaType]: AgentforceSchemaType[K] extends {
    isNamed: true;
  }
    ? never
    : AgentforceSchemaType[K] extends { __isCollection: true }
      ? never
      : K;
}[keyof AgentforceSchemaType];

/**
 * Extract non-internal (`__`-prefixed) field keys from a block type.
 * When `T` is a specific parsed block, this narrows to its known field names.
 * Falls back to `string` for plain `BlockCore`.
 */
export type BlockFieldKeys<T> = Exclude<
  { [K in keyof T]: K extends `__${string}` ? never : K }[keyof T],
  undefined
> &
  string;

/**
 * Extract field keys from `T` whose values are NamedMap collections.
 * Falls back to `string` when `T` is plain `BlockCore`.
 */
export type NamedMapFieldKeys<T> = Exclude<
  {
    [K in keyof T]: K extends `__${string}`
      ? never
      : NonNullable<T[K]> extends NamedMap<unknown>
        ? K
        : never;
  }[keyof T],
  undefined
> &
  string;

/**
 * Helpers available inside mutation callbacks for __children-safe mutations.
 *
 * Generic over the block type `T` so that field keys and values are typed when
 * the concrete block type is known (works for both document-root and standalone
 * component mutations). Falls back to `string` / `unknown` for plain `BlockCore`.
 */
export interface MutationHelpers<T = BlockCore> {
  /** Set a field value (new or existing). Creates FieldChild + accessor if new. */
  setField<K extends BlockFieldKeys<T>>(key: K, value: NonNullable<T[K]>): void;
  /** Set a field value by arbitrary string key (escape hatch for dynamic keys). */
  setField(key: string, value: unknown): void;
  /** Remove a field. Removes FieldChild from __children and deletes accessor. */
  removeField<K extends BlockFieldKeys<T>>(key: K): void;
  /** Remove a field by arbitrary string key. */
  removeField(key: string): void;
  /** Add a named entry to a NamedMap field. Handles NamedMap + __children. */
  addEntry<K extends NamedMapFieldKeys<T>>(
    key: K,
    name: string,
    value: BlockCore
  ): void;
  /** Add a named entry by arbitrary string key (escape hatch for dynamic keys). */
  addEntry(key: string, name: string, value: BlockCore): void;
  /** Remove a named entry from a NamedMap field. Handles NamedMap + __children. */
  removeEntry<K extends NamedMapFieldKeys<T>>(key: K, name: string): void;
  /** Remove a named entry by arbitrary string key (escape hatch for dynamic keys). */
  removeEntry(key: string, name: string): void;
}

/**
 * A single entry in the document's mutation history.
 * Used to power undo/redo, change list panels, and diff viewers.
 */
export interface HistoryEntry {
  /** Source snapshot BEFORE this mutation was applied. */
  readonly source: string;
  /** Human-readable description of the change (from mutate()'s label parameter). */
  readonly label: string | undefined;
  /** Wall-clock time when the mutation was applied. */
  readonly timestamp: number;
}
