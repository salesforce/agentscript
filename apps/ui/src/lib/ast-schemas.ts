/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

// AST schemas placeholder
// TODO: Implement Zod schemas for AST validation if needed

export interface Position {
  line: number;
  character: number;
}

export interface Location {
  start: Position;
  end: Position;
}

export interface Comment {
  content: string;
  location: Location;
}

export interface TypeInfo {
  kind: 'primitive' | 'list' | 'complex';
  name: string;
  elementType?: TypeInfo;
}

export const ASTSchemas = {};
