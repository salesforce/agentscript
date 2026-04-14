import type {
  Schema,
  SyntaxNode,
  EmitContext,
  ParseResult,
  Parsed,
} from './types.js';
import { withCst, getValueNodes, emitIndent, parseResult } from './types.js';
import type { Dialect } from './dialect.js';
import {
  createDiagnostic,
  DiagnosticSeverity,
  DiagnosticCollector,
} from './diagnostics.js';
import { addBuilderMethods } from './field-builder.js';
import { MapEntryChild, emitChildren, attachElementText } from './children.js';
import { errorBlockFromNode } from './error-recovery.js';
import { BlockCore, NamedMap } from './named-map.js';
import type {
  CollectionBlockFactory,
  CollectionBlockOpts,
  NamedBlockFactory,
  NamedCollectionBlockFactory,
} from './factory-types.js';
import { overrideFactoryBuilderMethods } from './factory-utils.js';

// ---------------------------------------------------------------------------
// CollectionBlock — a block that contains typed variadic named children.
// Replaces the implicit NamedMap created by NamedBlock fields.
// ---------------------------------------------------------------------------

/**
 * Create a collection block factory — a block that holds typed variadic
 * named children. The collection IS a block (has __kind, __children, __cst,
 * __diagnostics, __emit). `__children` is the single source of truth.
 *
 * The kind is derived automatically as `Collection<EntryBlockKind>`.
 *
 * @example
 * ```ts
 * const ActionsBlock = CollectionBlock(ActionBlock);
 * // __kind = "Collection<ActionBlock>"
 * // Used in schema:
 * const TopicBlock = NamedBlock('TopicBlock', {
 *   actions: ActionsBlock,
 * });
 * ```
 */
export function CollectionBlock<
  T extends Schema,
  V extends Record<string, Schema> = Record<never, never>,
>(
  entryBlock: NamedBlockFactory<T, V>,
  opts?: CollectionBlockOpts
): CollectionBlockFactory<T, V> {
  const kind = `Collection<${entryBlock.kind}>`;

  class CollectionBlockNode extends NamedMap<BlockCore> {
    static readonly __fieldKind = 'Collection' as const;
    static readonly kind = kind;
    static readonly isNamed = false as const;
    static readonly entryBlock = entryBlock;

    constructor(entries?: Iterable<[string, BlockCore]>) {
      super(kind, { entries });
    }

    // -- Parsing --

    static parse(
      node: SyntaxNode,
      dialect: Dialect
    ): ParseResult<CollectionBlockNode> {
      const instance = new CollectionBlockNode();
      const dc = new DiagnosticCollector();

      // Iterate inner mapping_element children, delegating key/value
      // extraction to the shared helpers used by Dialect.parseMappingElements.
      let lastEntryValue: BlockCore | undefined;
      for (const child of node.children) {
        if (child.type === 'comment') continue;

        // ERROR nodes following a bodyless entry contain its broken body
        // content (e.g. "!!!invalid syntax" after "broken:"). Attach to the
        // previous entry so the text survives round-trip emission.
        if (child.type === 'ERROR') {
          const errBlock = errorBlockFromNode(child);
          if (errBlock && lastEntryValue) {
            (lastEntryValue.__children ??= []).push(errBlock);
          }
          continue;
        }

        if (child.type !== 'mapping_element') continue;

        // In a collection, only single-id keys are valid (the entry name).
        // Two-id keys (e.g. "Get_Order test:") are a syntax error — use
        // the first id for parsing and flag the extra ids.
        const [typeId, nameId] = dialect.getKeyIds(child);
        const entryName = typeId;
        if (!entryName) continue;

        if (nameId !== undefined) {
          const keyNode = child.childForFieldName('key');
          dc.add(
            createDiagnostic(
              keyNode ?? child,
              `Composite key '${keyNode?.text ?? `${typeId} ${nameId}`}' is not allowed; expected a single name`,
              DiagnosticSeverity.Error,
              'composite-key'
            )
          );
        }

        const { blockValue, colinearValue, procedure } = getValueNodes(child);
        const valueNode = blockValue ?? colinearValue ?? procedure ?? child;

        const result = entryBlock.parse(valueNode, entryName, dialect);
        if (instance.has(entryName)) {
          const keyNode = child.childForFieldName('key');
          const dupDiag = createDiagnostic(
            keyNode ?? child,
            `Duplicate key '${keyNode?.text ?? entryName}'`,
            DiagnosticSeverity.Warning,
            'duplicate-key'
          );
          dc.add(dupDiag);
        }
        instance.set(entryName, result.value as unknown as BlockCore);
        lastEntryValue = result.value as unknown as BlockCore;
        dc.merge(result);

        // When the mapping_element contains ERROR children (e.g., broken
        // `to` clause fragments like `tz @topic.A2`), attach the original
        // element text for verbatim emission. This preserves error content
        // that would otherwise be lost during structured emission.
        // Only do this for error cases — normal entries use structured
        // emission to handle tab-size changes correctly.
        const hasErrorChildren = child.children.some(
          (c: { isError?: boolean }) => c.isError
        );
        if (hasErrorChildren) {
          const lastChild = instance.__children[instance.__children.length - 1];
          if (lastChild instanceof MapEntryChild) {
            attachElementText(lastChild, child);
          }
        }
      }

      // Only attach own-level diagnostics to the node. Child diagnostics
      // are already on child nodes and will be found by collectDiagnostics.
      instance.__diagnostics = dc.own;
      const parsed = withCst(instance, node);
      return parseResult(parsed as Parsed<CollectionBlockNode>, dc.all);
    }

    // -- Emission --

    static emit(value: CollectionBlockNode, ctx: EmitContext): string {
      return value.__emit(ctx);
    }

    static emitField(
      key: string,
      value: CollectionBlockNode,
      ctx: EmitContext
    ): string {
      if (!value.__children || value.__children.length === 0) {
        // Preserve empty collections that were in the original source
        if (value.__cst) {
          return `${emitIndent(ctx)}${key}:`;
        }
        return '';
      }
      const indent = emitIndent(ctx);
      const childCtx = { ...ctx, indent: ctx.indent + 1 };
      const body = emitChildren(value.__children, childCtx);
      if (!body) return '';
      return `${indent}${key}:\n${body}`;
    }
  }

  const base = addBuilderMethods(CollectionBlockNode);
  const dp = (key: string, value: unknown) =>
    Object.defineProperty(base, key, {
      value,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  // Propagate presentational metadata (example, description) from the entry
  // block as defaults. The collection's own opts.description takes precedence.
  const entryMeta = (entryBlock as unknown as Record<string, unknown>)
    .__metadata as Record<string, unknown> | undefined;
  const collectionMeta: Record<string, unknown> = {};
  if (entryMeta?.example) collectionMeta.example = entryMeta.example;
  if (entryMeta?.description)
    collectionMeta.description = entryMeta.description;
  if (opts?.description) collectionMeta.description = opts.description;
  if (Object.keys(collectionMeta).length > 0) {
    dp('__metadata', collectionMeta);
  }
  // Propagate schema, scopeAlias, and capabilities from the entry block so that
  // scope introspection can discover scoped namespaces through collections.
  dp('schema', entryBlock.schema);
  dp('scopeAlias', entryBlock.scopeAlias);
  dp('capabilities', entryBlock.capabilities);
  dp('colinearType', entryBlock.colinearType);
  dp('__isCollection', true);
  dp('__clone', () => CollectionBlock(entryBlock, opts));
  overrideFactoryBuilderMethods(base);
  return base as unknown as CollectionBlockFactory<T, V>;
}

// ---------------------------------------------------------------------------
// NamedCollectionBlock — a CollectionBlock whose entries are declared as
// sibling keys (e.g., `subagent Foo:`, `subagent Bar:`) rather than nested
// children under a single container key.
// ---------------------------------------------------------------------------

/**
 * Create a named collection block factory — a CollectionBlock whose entries
 * are declared as sibling keys with the collection keyword as prefix.
 *
 * Use this for top-level collections like `subagent`, `start_agent`,
 * `connected_subagent`, `topic`, `connection`, `modality` where each entry
 * repeats the schema key: `subagent Foo:`, `subagent Bar:`.
 *
 * Use plain `CollectionBlock` for nested containers like `actions:`
 * where entries are children under a single key.
 *
 * @example
 * ```ts
 * // Sibling pattern: `subagent Foo:`, `subagent Bar:`
 * const schema = { subagent: NamedCollectionBlock(SubagentBlock) };
 *
 * // Nested pattern: `actions:` with `Foo:`, `Bar:` as children
 * const schema = { actions: CollectionBlock(ActionBlock) };
 * ```
 */
export function NamedCollectionBlock<
  T extends Schema,
  V extends Record<string, Schema> = Record<never, never>,
>(
  entryBlock: NamedBlockFactory<T, V>,
  opts?: CollectionBlockOpts
): NamedCollectionBlockFactory<T, V> {
  const base = CollectionBlock(entryBlock, opts);
  const dp = (key: string, value: unknown) =>
    Object.defineProperty(base, key, {
      value,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  dp('__isNamedCollection', true);
  dp('__clone', () => NamedCollectionBlock(entryBlock, opts));
  overrideFactoryBuilderMethods(
    base as unknown as Record<string, unknown> & { __clone?: () => unknown }
  );
  return base as unknown as NamedCollectionBlockFactory<T, V>;
}
