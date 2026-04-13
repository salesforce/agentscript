/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { Range } from './position.js';

/** Where a comment is placed relative to its owning AST node. */
export type CommentAttachment = 'leading' | 'inline' | 'trailing';

/** A parsed source comment. Range is only present for parsed comments. */
export interface Comment {
  value: string;
  attachment: CommentAttachment;
  range?: Range;
}

export function comment(
  value: string,
  attachment: CommentAttachment = 'leading'
): Comment {
  return { value, attachment };
}
