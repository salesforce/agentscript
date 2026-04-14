import type { EmitContext, SymbolMeta, Comment } from './types.js';
import { CstMeta, NAMED_MAP_BRAND } from './types.js';
import type { Diagnostic } from './diagnostics.js';
import { MapEntryChild, MapIndex, emitChildren } from './children.js';
import type { BlockChild } from './children.js';

export interface BlockCore {
  __kind: string;
  __symbol?: SymbolMeta;
  __name?: string;
  __scope?: string;
  /**
   * @internal Ordered list of children, preserving CST structure for faithful
   * round-trip emission.
   *
   * **Single source of truth.** For simple fields, FieldChild stores the canonical
   * value and block properties are getter/setter accessors that delegate here.
   * For NamedMap/TypedMap, MapEntryChild entries store entries. For SequenceNode,
   * SequenceItemChild entries store items.
   */
  __children?: BlockChild[];
  __diagnostics: Diagnostic[];
  __cst?: CstMeta;
  __comments?: Comment[];
  __emit(ctx: EmitContext): string;
  /** Schema-defined fields are set dynamically via Object.defineProperty. */
  [key: string]: unknown;
}

export abstract class BlockBase implements BlockCore {
  [key: string]: unknown;
  abstract __kind: string;
  __symbol?: SymbolMeta;
  /** @internal See {@link BlockCore.__children}. */
  __children: BlockChild[] = [];
  __diagnostics: Diagnostic[] = [];
  __cst?: CstMeta;
  __comments?: Comment[];
  abstract __emit(ctx: EmitContext): string;
}

/** Build the canonical NamedMap label for a given collection key. */
export function collectionLabel(key: string): string {
  return `${key}Collection`;
}

/**
 * Map-like collection that also implements BlockCore.
 *
 * Used for NamedBlock collections (e.g., `actions:`) and
 * TypedMap entries (e.g., `variables:`, `inputs:`, `outputs:`).
 *
 * Maintains an O(1) lookup index while preserving CST insertion order
 * in `__children` for emission.
 */
export class NamedMap<T> implements BlockCore {
  // Index signature for AstNodeLike compatibility
  [key: string]: unknown;

  /** @internal Brand for `isNamedMap` type guard. */
  readonly [NAMED_MAP_BRAND] = true;

  __kind: string;
  __symbol?: SymbolMeta;
  __children: BlockChild[] = [];
  __diagnostics: Diagnostic[] = [];
  __cst?: CstMeta;
  __comments?: Comment[];

  /** @internal Lazily-derived O(1) lookup index — keys → MapEntryChild. */
  private _mapIndex = new MapIndex<T>();

  /** Create a NamedMap with the canonical collection label for the given key. */
  static forCollection<T>(
    key: string,
    options?: { symbol?: SymbolMeta; entries?: Iterable<[string, T]> }
  ): NamedMap<T> {
    return new NamedMap<T>(collectionLabel(key), options);
  }

  constructor(
    kind: string,
    options?: { symbol?: SymbolMeta; entries?: Iterable<[string, T]> }
  ) {
    this.__kind = kind;
    this.__symbol = options?.symbol;
    if (options?.entries) {
      for (const [key, value] of options.entries) {
        this.set(key, value);
      }
    }
  }

  get size(): number {
    return this._mapIndex.ensure(this.__children).size;
  }

  get(key: string): T | undefined {
    return this._mapIndex.ensure(this.__children).get(key)?.value;
  }

  has(key: string): boolean {
    return this._mapIndex.ensure(this.__children).has(key);
  }

  set(key: string, value: T): this {
    const index = this._mapIndex.ensure(this.__children);
    const existing = index.get(key);
    if (existing) {
      existing.value = value;
    } else {
      const child = new MapEntryChild<T>(key, value);
      this.__children.push(child);
    }
    return this;
  }

  delete(key: string): boolean {
    const index = this._mapIndex.ensure(this.__children);
    const entry = index.get(key);
    if (!entry) return false;
    const idx = this.__children.indexOf(entry);
    if (idx !== -1) this.__children.splice(idx, 1);
    return true;
  }

  clear(): void {
    this.__children = [];
  }

  // __children is the authoritative ordered list — iteration always follows
  // CST insertion order, not the _index Map. The _index is only for O(1) lookups.

  private *_entries(): IterableIterator<MapEntryChild<T>> {
    for (const child of this.__children) {
      if (child instanceof MapEntryChild) {
        yield child as MapEntryChild<T>;
      }
    }
  }

  *entries(): IterableIterator<[string, T]> {
    for (const entry of this._entries()) {
      yield [entry.name, entry.value];
    }
  }

  *keys(): IterableIterator<string> {
    for (const entry of this._entries()) {
      yield entry.name;
    }
  }

  *values(): IterableIterator<T> {
    for (const entry of this._entries()) {
      yield entry.value;
    }
  }

  forEach(callbackfn: (value: T, key: string, map: NamedMap<T>) => void): void {
    for (const entry of this._entries()) {
      callbackfn(entry.value, entry.name, this);
    }
  }

  [Symbol.iterator](): IterableIterator<[string, T]> {
    return this.entries();
  }

  toJSON(): Record<string, T> {
    const obj: Record<string, T> = {};
    for (const [k, v] of this) {
      obj[k] = v;
    }
    return obj;
  }

  __emit(ctx: EmitContext): string {
    return emitChildren(this.__children, ctx);
  }
}
