/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { SyntaxNode } from './syntax-node.js';

export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export function toRange(node: SyntaxNode): Range {
  return {
    start: {
      line: node.startRow,
      character: node.startCol,
    },
    end: { line: node.endRow, character: node.endCol },
  };
}
