/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Rename Provider - provides rename refactoring for AgentScript documents.
 */

import type { WorkspaceEdit, TextEdit } from 'vscode-languageserver';
import type { DocumentState } from '../document-store.js';
import {
  findReferencesAtPosition,
  positionIndexKey,
} from '@agentscript/language';
import { toLspRange } from '../adapters/types.js';

/**
 * Provide rename edits for a symbol at a position.
 */
export function provideRename(
  state: DocumentState,
  line: number,
  character: number,
  newName: string
): WorkspaceEdit | null {
  try {
    const { ast, uri, store, service } = state;
    if (!ast || !store) return null;

    const index = store.get(positionIndexKey);
    const schemaContext = service.schemaContext;

    // Find all references (including declaration)
    const refs = findReferencesAtPosition(
      ast,
      line,
      character,
      true, // include declaration
      schemaContext,
      undefined, // symbols (optional)
      index
    );

    if (refs.length === 0) return null;

    const edits: TextEdit[] = refs.map(ref => ({
      range: toLspRange(ref.nameRange),
      newText: newName,
    }));

    return {
      changes: {
        [uri]: edits,
      },
    };
  } catch (error) {
    console.error('[Rename] Error providing rename:', error);
    return null;
  }
}
