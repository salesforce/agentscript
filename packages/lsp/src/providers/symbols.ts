/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Symbols Provider - provides document and workspace symbols.
 */

import type { DocumentSymbol, SymbolInformation } from 'vscode-languageserver';
import { SymbolKind as LspSymbolKind } from 'vscode-languageserver';
import type { DocumentState } from '../document-store.js';
import { getDocumentSymbols, SymbolKind } from '@agentscript/language';
import type { DocumentSymbol as LangDocumentSymbol } from '@agentscript/language';
import { toLspRange } from '../adapters/types.js';

/**
 * Map dialect SymbolKind to LSP SymbolKind.
 */
export function toLspSymbolKind(symbolKind: SymbolKind): LspSymbolKind {
  switch (symbolKind) {
    case SymbolKind.File:
      return LspSymbolKind.File;
    case SymbolKind.Module:
      return LspSymbolKind.Module;
    case SymbolKind.Namespace:
      return LspSymbolKind.Namespace;
    case SymbolKind.Package:
      return LspSymbolKind.Package;
    case SymbolKind.Class:
      return LspSymbolKind.Class;
    case SymbolKind.Method:
      return LspSymbolKind.Method;
    case SymbolKind.Property:
      return LspSymbolKind.Property;
    case SymbolKind.Field:
      return LspSymbolKind.Field;
    case SymbolKind.Constructor:
      return LspSymbolKind.Constructor;
    case SymbolKind.Enum:
      return LspSymbolKind.Enum;
    case SymbolKind.Interface:
      return LspSymbolKind.Interface;
    case SymbolKind.Function:
      return LspSymbolKind.Function;
    case SymbolKind.Variable:
      return LspSymbolKind.Variable;
    case SymbolKind.Constant:
      return LspSymbolKind.Constant;
    case SymbolKind.String:
      return LspSymbolKind.String;
    case SymbolKind.Number:
      return LspSymbolKind.Number;
    case SymbolKind.Boolean:
      return LspSymbolKind.Boolean;
    case SymbolKind.Array:
      return LspSymbolKind.Array;
    case SymbolKind.Object:
      return LspSymbolKind.Object;
    case SymbolKind.Key:
      return LspSymbolKind.Key;
    case SymbolKind.Null:
      return LspSymbolKind.Null;
    default:
      return LspSymbolKind.Variable;
  }
}

/**
 * Provide document symbols.
 */
export function provideDocumentSymbols(state: DocumentState): DocumentSymbol[] {
  try {
    const { ast } = state;
    if (!ast) return [];

    const symbols = getDocumentSymbols(ast);

    return symbols.map(sym => convertSymbol(sym));
  } catch (error) {
    console.error('[Symbols] Error providing document symbols:', error);
    return [];
  }
}

function convertSymbol(sym: LangDocumentSymbol): DocumentSymbol {
  const result: DocumentSymbol = {
    name: sym.name,
    kind: toLspSymbolKind(sym.kind),
    range: toLspRange(sym.range),
    selectionRange: toLspRange(sym.selectionRange),
  };

  if (sym.detail) {
    result.detail = sym.detail;
  }

  if (sym.children && sym.children.length > 0) {
    result.children = sym.children.map(convertSymbol);
  }

  return result;
}

/**
 * Provide workspace symbols (search across all documents).
 */
export function provideWorkspaceSymbols(
  allStates: DocumentState[],
  query: string
): SymbolInformation[] {
  const symbols: SymbolInformation[] = [];

  try {
    for (const state of allStates) {
      const { ast, uri } = state;
      if (!ast) continue;

      const docSymbols = getDocumentSymbols(ast);

      // Flatten and filter by query
      const flatSymbols = flattenSymbols(docSymbols, uri);
      for (const sym of flatSymbols) {
        if (!query || sym.name.toLowerCase().includes(query.toLowerCase())) {
          symbols.push(sym);
        }
      }
    }
  } catch (error) {
    console.error('[Symbols] Error providing workspace symbols:', error);
  }

  return symbols;
}

function flattenSymbols(
  symbols: LangDocumentSymbol[],
  uri: string,
  containerName?: string
): SymbolInformation[] {
  const result: SymbolInformation[] = [];

  for (const sym of symbols) {
    result.push({
      name: sym.name,
      kind: toLspSymbolKind(sym.kind),
      location: {
        uri,
        range: toLspRange(sym.range),
      },
      containerName,
    });

    if (sym.children && sym.children.length > 0) {
      result.push(...flattenSymbols(sym.children, uri, sym.name));
    }
  }

  return result;
}
