/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import {
  ProcedureValue,
  StringValue,
  addBuilderMethods,
  emitIndent,
} from '@agentscript/language';
import type {
  Dialect,
  EmitContext,
  FieldType,
  ParseResult,
  TStringValue,
} from '@agentscript/language';
import type { SyntaxNode } from '@agentscript/types';

/**
 * System instructions accept the existing string/template forms plus an arrow
 * procedure for conditional instruction text.
 */
export type SystemInstructionValue = TStringValue | ProcedureValue;

const systemInstructionValueFieldType: FieldType<SystemInstructionValue> = {
  __fieldKind: 'Primitive',
  // Schema-driven tools use this metadata to choose a control. The parser
  // still dispatches explicitly below because ProcedureValue is not a string
  // expression kind.
  __accepts: ['StringLiteral', 'TemplateExpression', 'ProcedureValue'],

  parse(
    node: SyntaxNode,
    dialect: Dialect
  ): ParseResult<SystemInstructionValue> {
    if (node.type === 'procedure' || node.type === 'mapping') {
      return ProcedureValue.parse(node, dialect);
    }
    return StringValue.parse(node, dialect);
  },

  emit(value: SystemInstructionValue, ctx: EmitContext): string {
    return value.__emit(ctx);
  },

  emitField(
    key: string,
    value: SystemInstructionValue,
    ctx: EmitContext
  ): string {
    if (value.__kind === 'ProcedureValue') {
      return ProcedureValue.emitField!(key, value, ctx);
    }

    const indent = emitIndent(ctx);
    const prefix = `${indent}${key}: `;
    return `${prefix}${value.__emit({ ...ctx, continuationColumn: prefix.length })}`;
  },
};

export const SystemInstructionValue = addBuilderMethods(
  systemInstructionValueFieldType,
  ['string', 'generic']
);
