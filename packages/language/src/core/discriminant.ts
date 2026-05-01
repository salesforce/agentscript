/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { FieldType, SyntaxNode } from './types.js';
import { getKeyText, getValueNodes } from './types.js';

/**
 * Configuration for discriminant-based schema variant resolution.
 * When provided to `parseMappingElements`, a pre-scan extracts the
 * discriminant field value and selects the corresponding variant schema.
 */
export interface DiscriminantConfig {
  /** The field name whose value selects the variant (e.g., "kind") */
  field: string;
  /** Variant schemas keyed by discriminant value, already merged with base schema */
  variants: Record<string, Record<string, FieldType>>;
  /** Valid variant names for error messages */
  validValues: string[];
}

/**
 * Pre-scan mapping elements for a discriminant field and extract its string value.
 * Returns the value and the CST node of the value (for diagnostics), or undefined
 * if the field is not found.
 */
export function prescanDiscriminantValue(
  elements: SyntaxNode[],
  fieldName: string
): { value: string; cstNode: SyntaxNode } | undefined {
  for (const element of elements) {
    if (element.type !== 'mapping_element') continue;
    const keyNode = element.childForFieldName('key');
    if (!keyNode) continue;
    if (getKeyText(keyNode) !== fieldName) continue;

    // Found the discriminant element — extract its colinear string value
    const { colinearValue } = getValueNodes(element);
    if (!colinearValue) continue;

    // Navigate to the actual expression node
    const exprNode =
      colinearValue.childForFieldName('expression') ?? colinearValue;
    const text = exprNode.text?.trim();
    if (!text) continue;

    // Handle quoted strings — strip quotes
    if (
      (text.startsWith('"') && text.endsWith('"')) ||
      (text.startsWith("'") && text.endsWith("'"))
    ) {
      return { value: text.slice(1, -1), cstNode: exprNode };
    }
    // Unquoted identifier
    return { value: text, cstNode: exprNode };
  }
  return undefined;
}
