/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * CST Serialization - Convert CST back to AgentScript text.
 * Currently uses a simple text-based approach.
 */

import type { SerializedNode } from '~/store/source';

/**
 * Serialize a CST back to AgentScript text
 * @param cst - The CST (SerializedNode with text property)
 * @returns AgentScript source code as string
 */
export function serializeCST(cst: SerializedNode): string {
  if (cst.text) {
    return cst.text;
  }
  throw new Error('CST serialization not yet implemented - node has no text');
}
