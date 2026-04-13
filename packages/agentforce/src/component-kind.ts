/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Component kind configuration — describes how to parse each component kind.
 *
 * This encapsulates the wrapping, schema, parsing strategy, and extraction logic
 * so that consumers (e.g. the UI playground) don't need to know about internal
 * parsing details like source wrapping for nested collection blocks.
 */

import {
  isNamedCollectionFieldType,
  isNamedMap,
  ReasoningActionsBlock,
  Dialect,
  parseAndLint,
} from '@agentscript/language';
import type { FieldType } from '@agentscript/language';
import type { SyntaxNode, Diagnostic } from '@agentscript/types';
import {
  AgentforceSchema,
  AFActionsBlock,
  agentforceDialect,
} from '@agentscript/agentforce-dialect';
import type { SerializedCSTNode } from './types.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ComponentParseResult {
  ast: Record<string, unknown>;
  diagnostics: Diagnostic[];
}

export interface ComponentKindConfig {
  label: string;
  /** Schema used for parsing. */
  schema: Record<string, FieldType>;
  /** Wrap user source so the parser sees a valid top-level document. */
  wrap(source: string): string;
  /** Extract the parsed component from the full parse result. */
  extract(ast: Record<string, unknown>): unknown;
  /** Run the dialect/lint parse on a CST root node. */
  parse(rootNode: SyntaxNode): ComponentParseResult;
  /**
   * Strip synthetic wrapper nodes from a serialized CST.
   * For nested kinds this descends past the wrapper; for non-nested kinds
   * this is an identity function.
   */
  stripWrapperCST(cst: SerializedCSTNode): SerializedCSTNode;
  /** Line/column offsets introduced by wrapping (for position adjustment). */
  wrapOffsets: { lines: number; columns: number };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

const INDENT = '    ';

function indentSource(source: string): string {
  return source
    .split('\n')
    .map(line => INDENT + line)
    .join('\n');
}

const fullSchema: Record<string, FieldType> = AgentforceSchema;

function extractNamedEntry(ast: Record<string, unknown>, key: string): unknown {
  const map = ast[key];
  if (map && typeof map === 'object' && isNamedMap(map)) {
    const entries = [...(map as Iterable<[string, unknown]>)];
    return entries.length > 0 ? entries[0][1] : undefined;
  }
  return undefined;
}

/** Identity — non-nested kinds have no wrapper nodes to strip. */
function identityStripCST(cst: SerializedCSTNode): SerializedCSTNode {
  return cst;
}

/**
 * Strip wrapper nodes from a serialized CST for nested component kinds.
 *
 * For nested kinds like `actions`, the source is wrapped as:
 *   actions:\n    <user content>
 *
 * The CST contains `source_file > mapping_element(actions) > body...`.
 * This function descends past the wrapper mapping_element and returns
 * only the user's content subtree, creating a synthetic root if needed.
 */
function nestedStripWrapperCST(
  wrapLineOffset: number
): (cst: SerializedCSTNode) => SerializedCSTNode {
  return (root: SerializedCSTNode): SerializedCSTNode => {
    if (wrapLineOffset === 0 || !root.children) return root;

    // Find the wrapper mapping_element (the single named child of source_file)
    const namedChildren = root.children.filter(c => c.isNamed);
    if (namedChildren.length !== 1) return root;

    const wrapper = namedChildren[0];
    if (!wrapper.children) return root;

    // Collect all content children: named children that start at or after the
    // wrap line (these are the user's actual content nodes)
    const contentChildren = wrapper.children.filter(
      c => c.isNamed && c.range.start.line >= wrapLineOffset
    );

    if (contentChildren.length === 0) return root;

    // Return a synthetic root containing only the user's content
    return {
      ...root,
      children: contentChildren,
      range: {
        start: { ...contentChildren[0].range.start },
        end: { ...contentChildren[contentChildren.length - 1].range.end },
      },
    };
  };
}

/** Parse using Dialect with a subset schema (for nested collection kinds). */
function nestedParse(schema: Record<string, FieldType>) {
  return (rootNode: SyntaxNode): ComponentParseResult => {
    const dialectParser = new Dialect();
    const result = dialectParser.parse(rootNode, schema);
    return {
      ast: result.value as Record<string, unknown>,
      diagnostics: result.diagnostics ?? [],
    };
  };
}

/** Parse using parseAndLint with the full agentforce dialect. */
function fullParse(rootNode: SyntaxNode): ComponentParseResult {
  const result = parseAndLint(rootNode, agentforceDialect);
  return {
    ast: result.ast as Record<string, unknown>,
    diagnostics: result.diagnostics ?? [],
  };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const COMPONENT_KINDS: Record<string, ComponentKindConfig> = {
  action: {
    label: 'action (single)',
    schema: { actions: AFActionsBlock },
    wrap: src => `actions:\n${indentSource(src)}`,
    extract: ast => extractNamedEntry(ast, 'actions'),
    parse: nestedParse({ actions: AFActionsBlock }),
    stripWrapperCST: nestedStripWrapperCST(1),
    wrapOffsets: { lines: 1, columns: INDENT.length },
  },
  actions: {
    label: 'actions (collection)',
    schema: { actions: AFActionsBlock },
    wrap: src => `actions:\n${indentSource(src)}`,
    extract: ast => ast['actions'],
    parse: nestedParse({ actions: AFActionsBlock }),
    stripWrapperCST: nestedStripWrapperCST(1),
    wrapOffsets: { lines: 1, columns: INDENT.length },
  },
  reasoning_actions: {
    label: 'reasoning_actions (collection)',
    schema: {
      reasoning_actions: ReasoningActionsBlock,
    },
    wrap: src => `reasoning_actions:\n${indentSource(src)}`,
    extract: ast => ast['reasoning_actions'],
    parse: nestedParse({ reasoning_actions: ReasoningActionsBlock }),
    stripWrapperCST: nestedStripWrapperCST(1),
    wrapOffsets: { lines: 1, columns: INDENT.length },
  },
};

for (const [key, fieldType] of Object.entries(fullSchema)) {
  if (key in COMPONENT_KINDS) continue;
  // Only named collections (sibling-keyed entries like `subagent Foo:`) get
  // the no-wrap treatment.  Nested collections (e.g. actions) require
  // container-key wrapping and must be registered manually above.
  if (isNamedCollectionFieldType(fieldType)) {
    COMPONENT_KINDS[key] = {
      label: `${key} (collection)`,
      schema: fullSchema,
      wrap: src => src,
      extract: ast => extractNamedEntry(ast, key),
      parse: fullParse,
      stripWrapperCST: identityStripCST,
      wrapOffsets: { lines: 0, columns: 0 },
    };
  } else {
    COMPONENT_KINDS[key] = {
      label: `${key} (singular block)`,
      schema: fullSchema,
      wrap: src => `${key}:\n${indentSource(src)}`,
      extract: ast => ast[key],
      parse: fullParse,
      stripWrapperCST: nestedStripWrapperCST(1),
      wrapOffsets: { lines: 1, columns: INDENT.length },
    };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Get the component kind configuration for a given kind.
 * Returns `undefined` for unknown kinds.
 */
export function getComponentKindConfig(
  kind: string
): ComponentKindConfig | undefined {
  return COMPONENT_KINDS[kind];
}

/**
 * Get all available component kinds as `{ value, label }` pairs
 * suitable for a dropdown selector.
 */
export function getComponentKindOptions(): ReadonlyArray<{
  readonly value: string;
  readonly label: string;
}> {
  return Object.entries(COMPONENT_KINDS).map(([key, cfg]) => ({
    value: key,
    label: cfg.label,
  }));
}
