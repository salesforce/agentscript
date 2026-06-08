/**
 * Hover Provider - provides hover information for AgentScript documents.
 */

import type { Hover, MarkupContent } from 'vscode-languageserver';
import { MarkupKind } from 'vscode-languageserver';
import type { DialectConfig } from '@agentscript/language';
import type { DocumentState } from '../document-store.js';
import type { SyntaxNode } from '@agentscript/types';
import {
  type NodeAccessor,
  type HoverResult,
  resolveHover,
  formatSchemaHoverMarkdown,
  formatKeywordHoverMarkdown,
} from '@agentscript/language';
import { parseDialectAnnotation } from '../dialect-annotation.js';

// ---------------------------------------------------------------------------
// SyntaxNode accessor – adapts parser native nodes for the shared resolver
// ---------------------------------------------------------------------------

const syntaxNodeAccessor: NodeAccessor<SyntaxNode> = {
  type: n => n.type,
  text: n => n.text,
  children: n => n.children,
  namedChildren: n => n.namedChildren,
  startLine: n => n.startRow,
  startColumn: n => n.startCol,
  endLine: n => n.endRow,
  endColumn: n => n.endCol,
  childByFieldName: (n, name) => n.childForFieldName(name),
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Provide hover information at a position.
 */
export function provideHover(
  state: DocumentState,
  line: number,
  character: number,
  dialects?: readonly DialectConfig[]
): Hover | null {
  try {
    // Check for dialect annotation hover first (LSP-only)
    if (line < 10 && dialects) {
      const annotationHover = provideDialectAnnotationHover(
        state.source,
        line,
        character,
        dialects
      );
      if (annotationHover) return annotationHover;
    }

    const { ast, service } = state;
    if (!ast) return null;

    const rootNode = ast.__cst?.node;
    if (!rootNode) return null;

    const schema = service.dialectConfig.schemaInfo.schema;
    const result = resolveHover(
      rootNode,
      line,
      character,
      schema,
      syntaxNodeAccessor
    );

    return result ? toHover(result) : null;
  } catch (error) {
    console.error('[Hover] Error providing hover:', error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Convert platform-neutral HoverResult → LSP Hover
// ---------------------------------------------------------------------------

function toHover(result: HoverResult): Hover {
  let markdown: string;

  if (result.kind === 'field') {
    markdown = formatSchemaHoverMarkdown(
      result.path,
      result.metadata,
      result.modifiers,
      result.primitiveTypes
    );
  } else {
    markdown = formatKeywordHoverMarkdown(
      result.keyword,
      result.kind,
      result.info
    );
  }

  const content: MarkupContent = {
    kind: MarkupKind.Markdown,
    value: markdown,
  };

  return {
    contents: content,
    range: {
      start: {
        line: result.range.start.line,
        character: result.range.start.character,
      },
      end: {
        line: result.range.end.line,
        character: result.range.end.character,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Dialect annotation hover (LSP-only feature)
// ---------------------------------------------------------------------------

/**
 * Provide hover for `# @dialect: NAME=VERSION` annotations.
 * Shows dialect info, version semantics, and available dialects.
 */
function provideDialectAnnotationHover(
  source: string,
  line: number,
  character: number,
  dialects: readonly DialectConfig[]
): Hover | null {
  const annotation = parseDialectAnnotation(source);
  if (!annotation || annotation.line !== line) return null;

  // The annotation starts at column 0 (the `#`) and ends after the last
  // parsed token (version if present, otherwise name).
  const annotationStart = 0;
  const annotationEnd =
    annotation.versionStart >= 0
      ? annotation.versionStart + annotation.versionLength
      : annotation.nameStart + annotation.nameLength;

  if (character < annotationStart || character > annotationEnd) return null;

  const matchedDialect = dialects.find(
    d => d.name.toLowerCase() === annotation.name
  );

  const parts: string[] = [];

  if (matchedDialect) {
    parts.push(
      `**Dialect:** ${matchedDialect.name} v${matchedDialect.version}`
    );

    if (annotation.version) {
      const vParts = annotation.version.split('.');
      if (vParts.length === 1) {
        parts.push(
          `\n\n**Version constraint:** \`=${annotation.version}\` — any v${vParts[0]}.x release`
        );
      } else {
        parts.push(
          `\n\n**Version constraint:** \`=${annotation.version}\` — v${vParts[0]}.x with minimum minor version ${vParts[1]}`
        );
      }
    } else {
      parts.push('\n\n_No version constraint — uses latest available._');
    }
  } else {
    parts.push(`**Unknown dialect:** \`${annotation.name}\``);
    parts.push(
      `\n\n**Available:** ${dialects.map(d => `\`${d.name}\``).join(', ')}`
    );
  }

  parts.push('\n\n---');
  parts.push(
    '\n\n_Format:_ `# @dialect: NAME=VERSION`\n\n' +
      '- `NAME=MAJOR` — any release in that major version\n' +
      '- `NAME=MAJOR.MINOR` — minimum minor version within that major'
  );

  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: parts.join(''),
    },
    range: {
      start: { line, character: annotationStart },
      end: { line, character: annotationEnd },
    },
  };
}
