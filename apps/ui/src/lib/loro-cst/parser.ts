/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Parser Integration for Loro CST
 *
 * NOTE: This module is a stub. The loro-crdt dependency has not been added.
 * When/if Loro CRDT support is needed, install loro-crdt and implement this module.
 */

/**
 * Initialize the parser - stub
 */
export const initParser = async () => {};

/**
 * Get the parser instance - stub
 * @deprecated
 */
export const getParser = () => null;

/**
 * Parse source code - stub
 */
export function parseIntoLoroTree(
  _source: string,
  _doc: unknown,
  _signal?: AbortSignal
): Promise<{
  tree: unknown;
  rootId: string | null;
  parseTree: unknown;
}> {
  console.warn(
    '[loro-cst] parseIntoLoroTree is not implemented - loro-crdt not installed'
  );
  return { tree: null, rootId: null, parseTree: null };
}

/**
 * Alias for parseIntoLoroTree
 */
export const parseSourceToLoro = parseIntoLoroTree;

/**
 * Parse and validate - stub
 */
export function parseAndValidate(
  _source: string,
  _doc: unknown,
  _signal?: AbortSignal
): Promise<{
  tree: unknown;
  rootId: string | null;
  errors: Array<{
    message: string;
    line: number;
    column: number;
    endLine?: number;
    endColumn?: number;
  }>;
}> {
  console.warn(
    '[loro-cst] parseAndValidate is not implemented - loro-crdt not installed'
  );
  return { tree: null, rootId: null, errors: [] };
}
