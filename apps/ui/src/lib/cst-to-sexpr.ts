/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { CSTNode } from '~/lib/cst-helpers';
import type { SerializedNode } from '~/store/source';

type CSTInput = CSTNode | SerializedNode;

interface SExprNode {
  type: string;
  text?: string;
  isNamed: boolean;
  isError?: boolean;
  isMissing?: boolean;
  fieldName?: string | null;
  children?: SExprNode[];
}

/**
 * Convert a CST (CSTNode or SerializedNode) to an S-expression string.
 * Uses field name prefixes and short text previews on leaf named nodes for debugging.
 */
export function cstToSExpr(cst: CSTInput | null): string {
  if (!cst) return '';

  if ('type' in cst && cst.type) {
    return formatNode(cst as SExprNode, 0);
  }

  return '';
}

/**
 * Format a single node (and its descendants) as an S-expression string.
 * Only named nodes are included.
 * MISSING nodes render as (MISSING "type"), ERROR nodes as (ERROR ...).
 */
function formatNode(node: SExprNode, indent: number): string {
  // MISSING nodes always render as (MISSING "type")
  if (node.isMissing) {
    return `(MISSING ${JSON.stringify(node.type)})`;
  }

  const isError = node.isError || node.type === 'ERROR';
  const namedChildren = (node.children ?? []).filter(
    c => c.isNamed || c.isError || c.type === 'ERROR' || c.isMissing
  );

  // ERROR leaf
  if (isError && namedChildren.length === 0) {
    return '(ERROR)';
  }

  // ERROR with children
  if (isError) {
    const childIndent = indent + 2;
    const pad = ' '.repeat(childIndent);
    const parts: string[] = ['(ERROR'];
    for (const child of namedChildren) {
      const prefix = child.fieldName ? `${child.fieldName}: ` : '';
      parts.push(`\n${pad}${prefix}${formatNode(child, childIndent)}`);
    }
    parts.push(')');
    return parts.join('');
  }

  // Leaf named node — include a short text preview
  if (namedChildren.length === 0) {
    const preview = truncate(node.text, 20);
    if (preview) {
      return `(${node.type} ${JSON.stringify(preview)})`;
    }
    return `(${node.type})`;
  }

  // Node with named children — recurse
  const childIndent = indent + 2;
  const pad = ' '.repeat(childIndent);
  const parts: string[] = [`(${node.type}`];

  for (const child of namedChildren) {
    const prefix = child.fieldName ? `${child.fieldName}: ` : '';
    parts.push(`\n${pad}${prefix}${formatNode(child, childIndent)}`);
  }

  parts.push(')');
  return parts.join('');
}

function truncate(text: string | undefined | null, max: number): string | null {
  if (!text) return null;
  if (text.length <= max) return text;
  return text.slice(0, max) + '\u2026';
}
