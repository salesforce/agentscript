/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

export {
  LintEngine,
  PassStore,
  DependencyResolutionError,
  storeKey,
  each,
  defineRule,
  schemaContextKey,
} from './lint.js';

export type { LintPass, StoreKey, EachDep, Dep, ResolveDeps } from './lint.js';

export {
  createSchemaContext,
  getSchemaNamespaces,
  getGlobalScopes,
} from './scope.js';

export type { ScopeContext, SchemaContext } from './scope.js';

export { getDocumentSymbols, getSymbolMembers } from './symbols.js';

export type { DocumentSymbol } from './symbols.js';

export { resolveReference, walkDefinitionKeys } from './references.js';

export { collectDiagnostics } from './ast-walkers.js';

export {
  resolveSchemaField,
  formatConstraints,
  formatSchemaHoverMarkdown,
  formatKeywordHoverMarkdown,
  findKeywordInfo,
} from './schema-hover.js';

export type { SchemaFieldInfo, ResolvedSchemaField } from './schema-hover.js';

export { resolveHover } from './hover-resolver.js';

export type {
  NodeAccessor,
  HoverRange,
  SchemaFieldHover,
  KeywordHover,
  HoverResult,
} from './hover-resolver.js';
