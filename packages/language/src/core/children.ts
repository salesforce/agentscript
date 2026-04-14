/**
 * Children types for the __children single-source-of-truth pattern.
 *
 * Each child type wraps a value and knows how to emit itself. The parent
 * block's `__children` array preserves CST order for faithful round-trip
 * emission.
 */
import type {
  FieldType,
  EmitContext,
  CstMeta,
  Comment,
  CommentTarget,
  Range,
} from './types.js';
import { emitIndent, isNamedMap, wrapWithComments } from './types.js';
import type { Diagnostic } from './diagnostics.js';
import type { BlockCore } from './named-map.js';
import type { Statement } from './statements.js';

/** Contract for __children entries that can emit source text. */
export interface Emittable {
  readonly __type: string;
  __emit(ctx: EmitContext): string;
}

/**
 * A parsed schema field stored in __children. Self-emitting.
 *
 * Stores the canonical value for the field. The block's property is an
 * accessor (getter/setter) that delegates here.
 */
export class FieldChild implements Emittable {
  readonly __type = 'field' as const;
  private _value: unknown;
  /** Original CST mapping_element text for verbatim emission. */
  __elementText?: string;
  /** Column of the original CST mapping_element for verbatim emission. */
  __elementColumn?: number;

  constructor(
    readonly key: string,
    value: unknown,
    private _fieldType: FieldType,
    /** Set for document-level named entries (e.g., `topic main:`). */
    readonly entryName?: string,
    /** Source range of the key token, for diagnostic positioning. */
    readonly __keyRange?: Range
  ) {
    this._value = value;
  }

  get value(): unknown {
    return this._value;
  }

  set value(newValue: unknown) {
    this._value = newValue;
    // Invalidate verbatim CST text — value has changed
    this.__elementText = undefined;
    this.__elementColumn = undefined;
  }

  __emit(ctx: EmitContext): string {
    // Prefer verbatim emission from the original CST mapping_element text.
    // This preserves exact source indentation and formatting, ensuring
    // that re-parsing produces the same tree structure.
    if (this.__elementText != null && this.__elementColumn != null) {
      return emitRawTextVerbatim(this.__elementText, this.__elementColumn, ctx);
    }

    const val = this.value;
    let emitted: string;
    const carrier = val as CommentTarget | null | undefined;
    // Named entry at document level (e.g., "topic main:")
    if (this.entryName && isNamedBlockValue(val)) {
      emitted = val.emitWithKey(this.key, ctx);
      return wrapWithComments(emitted, carrier, ctx, 1);
    }
    // Field with custom emitField (containers like actions:, typed maps like variables:)
    if (this._fieldType.emitField) {
      emitted = this._fieldType.emitField(this.key, val, ctx);
      return wrapWithComments(emitted, carrier, ctx, 1);
    }
    // Simple field (e.g., "description: ...")
    const indent = emitIndent(ctx);
    emitted = `${indent}${this.key}: ${this._fieldType.emit(val, ctx)}`;
    return wrapWithComments(emitted, carrier, ctx, 1);
  }
}

/**
 * Attach original CST mapping_element text to a FieldChild or MapEntryChild
 * for verbatim emission. Call after construction with the CST element node.
 */
export function attachElementText(
  child: FieldChild | MapEntryChild,
  elementNode: { text: string; startPosition: { column: number } }
): void {
  child.__elementText = normalizeRawText(
    elementNode.text,
    elementNode.startPosition.column
  );
  child.__elementColumn = elementNode.startPosition.column;
}

/**
 * A named entry in a NamedMap or TypedMap stored in __children.
 * Wraps a value with its name for ordered emission.
 */
export class MapEntryChild<T = unknown> implements Emittable {
  readonly __type = 'map_entry' as const;
  value: T;
  /** Original CST mapping_element text for verbatim emission. */
  __elementText?: string;
  /** Column of the original CST mapping_element for verbatim emission. */
  __elementColumn?: number;

  constructor(
    readonly name: string,
    value: T
  ) {
    this.value = value;
  }

  __emit(ctx: EmitContext): string {
    // Prefer verbatim emission from the original CST mapping_element text
    if (this.__elementText != null && this.__elementColumn != null) {
      return emitRawTextVerbatim(this.__elementText, this.__elementColumn, ctx);
    }

    const v = this.value;
    if (isEmittable(v)) {
      return wrapWithComments(v.__emit(ctx), v as CommentTarget, ctx);
    }
    if (v != null) {
      console.warn(
        `MapEntryChild '${this.name}': value is non-null but missing __emit — entry will be dropped from emission`
      );
    }
    return '';
  }
}

/**
 * @internal Builds an O(1) lookup index over MapEntryChild entries in a
 * BlockChild[] array. Always rebuilds from __children on every access,
 * ensuring correctness even when __children is mutated externally.
 * For the sizes involved (dozens of entries per collection), the cost
 * is negligible.
 */
export class MapIndex<T> {
  /** Build a fresh index from the current `children` array. */
  ensure(children: BlockChild[]): Map<string, MapEntryChild<T>> {
    const index = new Map<string, MapEntryChild<T>>();
    for (const child of children) {
      if (child instanceof MapEntryChild) {
        index.set(child.name, child as MapEntryChild<T>);
      }
    }
    return index;
  }
}

/**
 * A sequence item stored in SequenceNode.__children. Self-emitting.
 * Handles dash-prefix formatting for YAML-style sequence emission.
 */
export class SequenceItemChild implements Emittable {
  readonly __type = 'sequence_item' as const;
  value: unknown;

  constructor(value: unknown) {
    this.value = value;
  }

  __emit(ctx: EmitContext): string {
    const indent = emitIndent(ctx);
    const childCtx = { ...ctx, indent: ctx.indent + 1 };
    const childIndent = emitIndent(childCtx);
    const item = this.value;

    if (isEmittable(item) && '__symbol' in item) {
      // Block items: replace first line's indent with "- " prefix,
      // and align continuation lines with the content after "- ".
      const rawOutput = item.__emit(childCtx);
      const lines = rawOutput.split('\n');
      lines[0] = `${indent}- ${lines[0].slice(childIndent.length)}`;
      // Continuation lines: replace childIndent with indent + 2 spaces
      // so fields align with the first field after "- ".
      const continuationIndent = indent + '  ';
      for (let i = 1; i < lines.length; i++) {
        if (lines[i].startsWith(childIndent)) {
          lines[i] = continuationIndent + lines[i].slice(childIndent.length);
        }
      }
      return lines.join('\n');
    }

    if (isEmittable(item)) {
      return `${indent}- ${item.__emit({ ...ctx, indent: 0 })}`;
    }

    return '';
  }
}

/**
 * Preserved raw text for unknown/unparseable CST content.
 */

/**
 * Count leading whitespace characters in a string, treating each tab or space
 * as one character (matching how the lexer tracks `col`).
 */
function countLeadingWsChars(line: string): number {
  let count = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line.charCodeAt(i);
    if (c === 0x20 /* space */ || c === 0x09 /* tab */) {
      count++;
    } else {
      break;
    }
  }
  return count;
}

/**
 * Normalize raw text to zero-based relative indentation.
 *
 * In CST node text, line 0 starts at the node offset (no leading whitespace),
 * while lines 1+ retain their absolute source indentation. This strips
 * `baseIndent` whitespace characters from lines 1+ so the stored text uses
 * relative indentation — completely independent of where the block sits in
 * the tree. Handles both tab and space indentation.
 *
 * Also strips trailing blank lines to prevent accumulation across round-trips.
 */
function normalizeRawText(rawText: string, baseIndent: number): string {
  const lines = rawText.split('\n');
  // Strip trailing blank lines
  while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') {
    lines.pop();
  }
  if (lines.length <= 1) return lines.join('\n');

  // Line 0 already has no leading whitespace (CST node offset).
  // Lines 1+ have absolute source indentation — strip baseIndent characters
  // (tabs or spaces) to get relative indentation.
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    const wsChars = countLeadingWsChars(line);
    if (wsChars >= baseIndent) {
      lines[i] = line.slice(baseIndent);
    } else {
      // Line has less indent than base — strip all leading whitespace
      // to prevent negative relative indent.
      lines[i] = line.trimStart();
    }
  }
  return lines.join('\n');
}

/**
 * Emit raw text using context-relative indentation.
 *
 * The stored `rawText` is in zero-based relative form (via normalizeRawText):
 * line 0 has no leading whitespace, lines 1+ have relative indentation.
 * This function prepends `emitIndent(ctx)` to every non-empty line, so the
 * output indentation is always driven by the emit context — never by stale
 * absolute column positions from the original parse.
 *
 * This ensures idempotent round-trips: re-parsing the emitted text produces
 * the same block membership regardless of how error recovery reclassified
 * fields between passes.
 */
function emitRawTextVerbatim(
  rawText: string,
  _originalIndent: number,
  ctx: EmitContext
): string {
  const indent = emitIndent(ctx);
  const lines = rawText.split('\n');

  return lines
    .map((line, i) => {
      // Line 0: strip any residual whitespace, prepend context indent
      if (i === 0) {
        const stripped = line.replace(/^\s*/, '');
        return stripped ? indent + stripped : '';
      }
      // Lines 1+: text is already in relative form; prepend context indent
      const stripped = line.replace(/^\s*/, '');
      if (!stripped) return '';
      // Preserve relative indentation beyond the base level
      const lineIndent = line.length - line.trimStart().length;
      return indent + ' '.repeat(lineIndent) + stripped;
    })
    .join('\n');
}

export class ErrorBlock implements Emittable {
  readonly __type = 'error' as const;
  readonly __kind = 'ErrorBlock' as const;
  __diagnostics: Diagnostic[] = [];
  __cst?: CstMeta;

  /** Normalized raw text with zero-based relative indentation. */
  readonly rawText: string;
  readonly originalIndent: number;

  constructor(rawText: string, originalIndent: number) {
    this.rawText = normalizeRawText(rawText, originalIndent);
    this.originalIndent = originalIndent;
  }

  __emit(ctx: EmitContext): string {
    return emitRawTextVerbatim(this.rawText, this.originalIndent, ctx);
  }
}

/**
 * Structured representation of an unknown/unrecognized block.
 *
 * Combines raw-text emission (like ErrorBlock, for round-trip fidelity)
 * with structured `__children` parsed from the CST. This enables
 * downstream tooling (symbols, completions, walkers) to operate
 * inside unknown blocks while preserving faithful emission.
 */
export class UntypedBlock implements Emittable {
  readonly __type = 'untyped' as const;
  readonly __kind = 'UntypedBlock' as const;
  __diagnostics: Diagnostic[] = [];
  __cst?: CstMeta;
  __comments?: Comment[];
  /** Structured children for analysis (symbols, walkers, completions). */
  __children: BlockChild[] = [];

  /** Normalized raw text with zero-based relative indentation. */
  readonly rawText?: string;
  readonly originalIndent: number;
  /**
   * The second key id (e.g., "billing" in "tpoic billing:").
   * Stored with __ prefix to avoid collision with defineFieldAccessors
   * which can create a `name` property accessor when a child has key "name".
   */
  readonly __blockName?: string;

  /**
   * Public accessor for the second key id.
   * NOTE: defineFieldAccessors may overwrite this with a getter for a child
   * named "name". Internal emission uses __blockName to avoid this.
   */
  get name(): string | undefined {
    return this.__blockName;
  }

  constructor(
    /** The unrecognized key (e.g., "tpoic"). */
    public readonly key: string,
    /** The second id if present (e.g., "billing" in "tpoic billing:"). */
    name?: string,
    /** Raw element text for faithful emission. */
    rawText?: string,
    /** Column offset for re-indentation during emission. */
    originalIndent: number = 0
  ) {
    this.__blockName = name;
    this.rawText =
      rawText != null ? normalizeRawText(rawText, originalIndent) : undefined;
    this.originalIndent = originalIndent;
  }

  __emit(ctx: EmitContext): string {
    // Emit raw text verbatim to preserve original source indentation.
    // This ensures re-parsing produces the same INDENT/DEDENT boundaries
    // and the same error recovery tree structure — critical for round-trip
    // stability of unparseable content.
    if (this.rawText != null) {
      return emitRawTextVerbatim(this.rawText, this.originalIndent, ctx);
    }

    // Fallback: emit from structure (programmatically constructed blocks)
    const indent = emitIndent(ctx);
    const header = this.__blockName
      ? `${this.key} ${this.__blockName}:`
      : `${this.key}:`;

    if (this.__children.length === 0) return `${indent}${header}`;

    const childCtx = { ...ctx, indent: ctx.indent + 1 };
    const body = this.__children
      .map(child => child.__emit(childCtx))
      .filter(Boolean)
      .join('\n');
    return body ? `${indent}${header}\n${body}` : `${indent}${header}`;
  }
}

/**
 * Create a FieldType for an untyped colinear field.
 *
 * `emitField` uses the original raw text for round-trip fidelity.
 * `emit` delegates to the Expression's `__emit` for standalone use.
 */
export function untypedFieldType(
  rawText: string,
  originalIndent: number
): FieldType {
  const normalizedText = normalizeRawText(rawText, originalIndent);
  return {
    __fieldKind: 'Primitive',
    __accepts: [],
    parse: () => {
      throw new Error('UntypedFieldType cannot parse');
    },
    emit: (value: unknown, ctx: EmitContext): string => {
      if (isEmittable(value)) {
        return value.__emit(ctx);
      }
      return String(value ?? '');
    },
    emitField: (_key: string, _value: unknown, ctx: EmitContext): string => {
      return emitRawTextVerbatim(normalizedText, originalIndent, ctx);
    },
  };
}

/**
 * A colinear expression value stored in __children (e.g., `@actions.send_email`
 * in `send_email: @actions.send_email`). Emission is handled by the parent
 * block's __emit — this child just stores the canonical value.
 */
export class ValueChild implements Emittable {
  readonly __type = 'value' as const;
  value: unknown;

  constructor(value: unknown) {
    this.value = value;
  }

  /** Value emission is handled inline by the parent; this is a no-op. */
  __emit(_ctx: EmitContext): string {
    return '';
  }
}

/**
 * A statement stored in __children (e.g., `with`, `set`, `to`, `available when`).
 * Self-emitting — delegates to the wrapped statement's __emit.
 */
export class StatementChild implements Emittable {
  readonly __type = 'statement' as const;
  value: Statement;

  constructor(statement: Statement) {
    this.value = statement;
  }

  __emit(ctx: EmitContext): string {
    const v = this.value;
    if (isEmittable(v)) {
      return wrapWithComments(v.__emit(ctx), v, ctx);
    }
    return '';
  }
}

export type BlockChild =
  | FieldChild
  | ErrorBlock
  | UntypedBlock
  | MapEntryChild
  | SequenceItemChild
  | ValueChild
  | StatementChild;

/**
 * Type guard for BlockChild values.
 * All BlockChild variants carry a `__type` discriminant string.
 */
export function isBlockChild(value: unknown): value is BlockChild {
  return value != null && typeof value === 'object' && '__type' in value;
}

/**
 * Type guard for named block instances that support `emitWithKey`.
 * Uses `__kind` as a reliable discriminator (only block instances have it)
 * rather than raw structural duck-typing on arbitrary objects.
 */
export function isNamedBlockValue(
  v: unknown
): v is BlockCore & { emitWithKey: (key: string, ctx: EmitContext) => string } {
  return (
    v != null &&
    typeof v === 'object' &&
    '__kind' in v &&
    'emitWithKey' in v &&
    typeof v.emitWithKey === 'function'
  );
}

/**
 * Type guard for objects with an `__emit` method.
 * Matches blocks, statements, and expressions — anything that can emit source text.
 */
export function isEmittable(
  value: unknown
): value is BlockCore & { __emit(ctx: EmitContext): string } {
  return (
    value != null &&
    typeof value === 'object' &&
    '__emit' in value &&
    typeof value.__emit === 'function'
  );
}

/**
 * Type guard for singular (unnamed) block instances.
 * These have `__kind` and `__children` (block structure) but no `__name`,
 * which distinguishes them from named blocks and from statements/expressions
 * that also carry `__kind`.
 */
export function isSingularBlock(value: unknown): value is BlockCore {
  return (
    isEmittable(value) &&
    '__kind' in value &&
    typeof value.__kind === 'string' &&
    '__children' in value &&
    !('__name' in value && typeof value.__name === 'string')
  );
}

/** Emit an array of BlockChild entries, filtering empty results. */
export function emitChildren(
  children: BlockChild[],
  ctx: EmitContext,
  sep = '\n'
): string {
  return children
    .map(c => c.__emit(ctx))
    .filter(Boolean)
    .join(sep);
}

/**
 * Define getter/setter property accessors on the block for each simple
 * (non-named) FieldChild, delegating to FieldChild as the single source
 * of truth.
 *
 * Accessors are defined as own properties (not prototype) so that
 * `Object.keys()` and `Object.entries()` pick them up — which is required
 * by AST walkers.
 *
 * **Serialization note:** `JSON.stringify` calls getters, so serialization
 * works. `Object.assign({}, block)` produces value snapshots (not accessor
 * delegation). `console.log` may show `[Getter/Setter]` — use `.toJSON()`
 * or explicit property access for cleaner output.
 *
 * **Invariant:** Each accessor closes over its `FieldChild` instance. If
 * `__children` is ever replaced (e.g., via `.filter()`), the replacement
 * **must** preserve all `FieldChild` entries — otherwise the accessor will
 * silently read/write an orphaned `FieldChild` that is no longer in the
 * array. Mutations that only add or remove non-field children (statements,
 * values, errors) are safe. Dropping a `FieldChild` from the array without
 * re-defining the accessor is a bug.
 */
export function defineFieldAccessors(
  block: object,
  children: BlockChild[]
): void {
  const defined = new Set<string>();
  for (const child of children) {
    if (child.__type !== 'field') continue;
    const fc = child; // narrowed to FieldChild by __type check
    // Skip named entries — they don't need accessor delegation
    if (fc.entryName) continue;
    // Only define once per key (first FieldChild wins)
    if (defined.has(fc.key)) continue;
    defined.add(fc.key);

    Object.defineProperty(block, fc.key, {
      get(): unknown {
        return fc.value;
      },
      set(newValue: unknown) {
        fc.value = newValue;
      },
      enumerable: true,
      configurable: true,
    });
  }
}

/**
 * Wire up a block's properties from a resolved `__children` array.
 *
 * - NamedMap fields are assigned directly (they manage their own children).
 * - Simple fields get getter/setter accessors delegating to FieldChild.
 *
 * Shared by both parse and programmatic construction paths.
 */
function wireBlockProperties(
  block: BlockCore,
  children: BlockChild[],
  fields: Record<string, unknown>
): void {
  for (const [key, value] of Object.entries(fields)) {
    if (isNamedMap(value)) {
      block[key] = value;
    }
  }
  defineFieldAccessors(block, children);
}

/**
 * Initialize `__children` for a block instance.
 *
 * If parse-provided children exist (from `parseMappingElements`), they are
 * used directly (preserving CST order). Otherwise, children are synthesized
 * from schema fields (programmatic construction path).
 *
 * In both cases, {@link wireBlockProperties} handles the shared work of
 * assigning NamedMap fields and defining accessor properties.
 *
 * @param block     - The block instance, used for accessor definition.
 * @param parseChildren - Children from the dialect parse, if available.
 * @param fields    - The field values (without __children).
 * @param schema    - The block's field schema.
 */
export function initChildren(
  block: BlockCore,
  parseChildren: BlockChild[] | undefined,
  fields: Record<string, unknown>,
  schema: Record<string, FieldType>
): BlockChild[] {
  if (parseChildren) {
    wireBlockProperties(block, parseChildren, fields);
    return parseChildren;
  }
  // Programmatic construction: build __children from schema field order
  const children: BlockChild[] = [];
  for (const [key, fieldType] of Object.entries(schema)) {
    const value = fields[key];
    if (value !== undefined) {
      children.push(new FieldChild(key, value, fieldType));
    }
  }
  wireBlockProperties(block, children, fields);
  return children;
}

/**
 * Extract `__children` from a parse result, returning cleaned fields and children separately.
 *
 * Used at boundaries where `parseMappingElements` results feed into Block constructors,
 * so internal metadata isn't smuggled through the `InferFields<T>` type boundary.
 * Centralizes the extraction so that a rename of `__children` only needs to change here.
 */
export function extractChildren(
  parsed: Record<string, unknown> & { __children?: BlockChild[] }
): {
  fields: Record<string, unknown>;
  children: BlockChild[] | undefined;
} {
  const { __children, ...fields } = parsed;
  return { fields, children: __children };
}
