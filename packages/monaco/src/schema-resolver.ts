/**
 * Schema Resolver - maps a cursor position in the CST to schema metadata.
 *
 * Delegates to the shared hover resolver from @agentscript/language,
 * providing a {@link NodeAccessor} for SerializedNode trees.
 */

import type { SerializedNode } from './worker-parser';
import type { FieldMetadata } from '@agentscript/language';
import {
  resolveHover,
  type NodeAccessor,
  type SchemaFieldInfo,
  type HoverResult,
  type SchemaFieldHover,
  type KeywordHover,
} from '@agentscript/language';

export type { FieldMetadata, SchemaFieldInfo };

// Re-export hover result types under the names Monaco consumers expect
export type SchemaHoverInfo = SchemaFieldHover;
export type KeywordHoverInfo = KeywordHover;
export type HoverInfo = HoverResult;

// ---------------------------------------------------------------------------
// SerializedNode accessor
// ---------------------------------------------------------------------------

const serializedNodeAccessor: NodeAccessor<SerializedNode> = {
  type: n => n.type,
  text: n => n.text,
  children: n => n.children,
  namedChildren: n => n.children.filter(c => c.isNamed),
  startLine: n => n.range.start.line,
  startColumn: n => n.range.start.character,
  endLine: n => n.range.end.line,
  endColumn: n => n.range.end.character,
  childByFieldName: (n, name) =>
    n.children.find(c => c.fieldName === name) ?? null,
};

// ---------------------------------------------------------------------------
// Public API (preserves existing function signature for hover-provider.ts)
// ---------------------------------------------------------------------------

/**
 * Resolve hover info for a position in the CST.
 *
 * @param root - The serialized CST root node
 * @param line - 0-based line number
 * @param character - 0-based character offset
 * @param schema - The root schema object
 * @returns Hover info with metadata and range, or null
 */
export function resolveHoverInfo(
  root: SerializedNode,
  line: number,
  character: number,
  schema: Record<string, SchemaFieldInfo>
): HoverInfo | null {
  return resolveHover(root, line, character, schema, serializedNodeAccessor);
}
