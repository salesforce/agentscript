/**
 * References Provider - provides find-references for AgentScript documents.
 */

import type { Location } from 'vscode-languageserver';
import type { DocumentState } from '../document-store.js';
import {
  findReferencesAtPosition,
  positionIndexKey,
} from '@agentscript/language';
import { toLspRange } from '../adapters/types.js';

/**
 * Provide reference locations for a symbol at a position.
 */
export function provideReferences(
  state: DocumentState,
  line: number,
  character: number,
  includeDeclaration: boolean
): Location[] {
  try {
    const { ast, uri, store, service } = state;
    if (!ast || !store) return [];

    const index = store.get(positionIndexKey);
    const schemaContext = service.schemaContext;

    const refs = findReferencesAtPosition(
      ast,
      line,
      character,
      includeDeclaration,
      schemaContext,
      undefined, // symbols (optional)
      index
    );

    return refs.map(r => ({
      uri,
      range: toLspRange(r.range),
    }));
  } catch (error) {
    console.error('[References] Error providing references:', error);
    return [];
  }
}
