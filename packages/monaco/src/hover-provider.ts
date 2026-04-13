/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Monaco Hover Provider for AgentScript.
 *
 * Shows field descriptions, deprecation warnings, version info, etc.
 * when hovering over field keys, modifiers, and type names in the editor.
 *
 * CST is cached per model version to avoid re-parsing on every hover.
 */

import * as monaco from 'monaco-editor';
import { parseAgentScript } from './parser-api';
import {
  resolveHoverInfo,
  type SchemaFieldInfo,
  type SchemaHoverInfo,
  type KeywordHoverInfo,
} from './schema-resolver';
import type { SerializedNode } from './worker-parser';
import {
  formatSchemaHoverMarkdown,
  formatKeywordHoverMarkdown,
} from '@agentscript/language';

export function createHoverProvider(
  schema: Record<string, SchemaFieldInfo>
): monaco.languages.HoverProvider {
  // Cache CST to avoid re-parsing on every hover
  let cachedVersionId: number | undefined;
  let cachedRoot: SerializedNode | null = null;

  return {
    provideHover: async (model, position) => {
      // Use cached CST if content hasn't changed
      const versionId = model.getVersionId();
      if (versionId !== cachedVersionId) {
        cachedRoot = await parseAgentScript(model.getValue());
        cachedVersionId = versionId;
      }
      if (!cachedRoot) return null;

      // Monaco is 1-based, CST is 0-based
      const info = resolveHoverInfo(
        cachedRoot,
        position.lineNumber - 1,
        position.column - 1,
        schema
      );
      if (!info) return null;

      const monacoRange = new monaco.Range(
        info.range.start.line + 1,
        info.range.start.character + 1,
        info.range.end.line + 1,
        info.range.end.character + 1
      );

      if (info.kind === 'field') {
        return formatFieldHover(info, monacoRange);
      }

      return formatKeywordHover(info, monacoRange);
    },
  };
}

function formatFieldHover(
  info: SchemaHoverInfo,
  range: monaco.Range
): monaco.languages.Hover {
  const markdown = formatSchemaHoverMarkdown(
    info.path,
    info.metadata,
    info.modifiers,
    info.primitiveTypes
  );
  return { contents: [{ value: markdown }], range };
}

function formatKeywordHover(
  info: KeywordHoverInfo,
  range: monaco.Range
): monaco.languages.Hover {
  const markdown = formatKeywordHoverMarkdown(
    info.keyword,
    info.kind,
    info.info
  );
  return { contents: [{ value: markdown }], range };
}
