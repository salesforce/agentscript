/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Definition Provider - provides go-to-definition for AgentScript documents.
 */

import type { Location } from 'vscode-languageserver';
import type { DocumentState } from '../document-store.js';
import {
  findDefinitionAtPosition,
  positionIndexKey,
} from '@agentscript/language';
import { toLspRange } from '../adapters/types.js';

/**
 * Provide definition location for a symbol at a position.
 */
export function provideDefinition(
  state: DocumentState,
  line: number,
  character: number
): Location | null {
  try {
    const { ast, uri, store, service } = state;
    if (!ast || !store) return null;

    const index = store.get(positionIndexKey);
    const schemaContext = service.schemaContext;

    const result = findDefinitionAtPosition(
      ast,
      line,
      character,
      schemaContext,
      undefined, // symbols (optional)
      index
    );

    if (!result.definition) return null;

    return {
      uri,
      range: toLspRange(result.definition.definitionRange),
    };
  } catch (error) {
    console.error('[Definition] Error providing definition:', error);
    return null;
  }
}
