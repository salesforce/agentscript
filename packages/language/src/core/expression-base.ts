/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { EmitContext, CstMeta, Comment } from './types.js';
import { AstNodeBase } from './types.js';
import type { Diagnostic } from './diagnostics.js';

export interface Expression {
  readonly __kind: string;
  __emit(ctx: EmitContext): string;
  __diagnostics: Diagnostic[];
  __cst?: CstMeta;
  __comments?: Comment[];
  /** User-friendly description for error messages (e.g., "number 42") */
  __describe(): string;
}

/**
 * Base class for expression nodes. Provides the default `__describe()` that
 * most compound expressions use (`expression <emit>`); leaf literals override.
 */
export abstract class ExpressionBase extends AstNodeBase implements Expression {
  abstract readonly __kind: string;
  abstract __emit(ctx: EmitContext): string;

  __describe(): string {
    return `expression ${this.__emit({ indent: 0 })}`;
  }
}
