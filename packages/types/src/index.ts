/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

export type { SyntaxNode } from './syntax-node.js';
export type { Position, Range } from './position.js';
export { toRange } from './position.js';
export type { CstMeta } from './cst.js';
export type { CommentAttachment, Comment } from './comment.js';
export { comment } from './comment.js';
export { DiagnosticSeverity, DiagnosticTag } from './diagnostic.js';
export type { Diagnostic } from './diagnostic.js';
export {
  BUILTIN_FUNCTION_NAMES,
  BUILTIN_FUNCTION_NAME_SET,
} from './functions.js';
export type { BuiltinFunctionName } from './functions.js';
