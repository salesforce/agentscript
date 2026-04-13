/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { SyntaxNode } from './syntax-node.js';
import type { Range } from './position.js';

export interface CstMeta {
  node: SyntaxNode;
  range: Range;
}
