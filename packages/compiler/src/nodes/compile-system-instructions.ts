/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { IfStatement } from '@agentscript/language';
import type { Statement } from '@agentscript/language';
import type { CompilerContext } from '../compiler-context.js';
import type { ParsedSystem, ParsedTopicLike } from '../parsed-types.js';
import type { Action, HandOffAction } from '../types.js';
import { SYSTEM_INSTRUCTIONS_VARIABLE } from '../constants.js';
import { getCstRange } from '../ast-helpers.js';
import { compileTemplateValue } from '../expressions/compile-template.js';
import { dedent } from '../utils.js';
import { compileDeterministicDirectives } from './compile-directives.js';

export interface CompiledSystemInstructions {
  instructions: string;
  beforeReasoningIteration: (Action | HandOffAction)[];
}

const EMPTY_SYSTEM_INSTRUCTIONS: CompiledSystemInstructions = {
  instructions: '',
  beforeReasoningIteration: [],
};

/**
 * Compile topic-level system instructions, falling back to the global block.
 * Static instructions remain direct node text; conditional instructions are
 * rebuilt in a dedicated state variable before each reasoning iteration.
 */
export function compileSystemInstructions(
  systemBlock: ParsedSystem | undefined,
  topicBlock: ParsedTopicLike,
  ctx: CompilerContext
): CompiledSystemInstructions {
  const topicInstructions = topicBlock.system?.instructions;
  if (topicInstructions) {
    const compiled = compileInstructionValue(topicInstructions, ctx);
    if (compiled) return compiled;
  }

  const globalInstructions = systemBlock?.instructions;
  if (globalInstructions) {
    const compiled = compileInstructionValue(globalInstructions, ctx);
    if (compiled) return compiled;
  }

  return EMPTY_SYSTEM_INSTRUCTIONS;
}

function compileInstructionValue(
  value: unknown,
  ctx: CompilerContext
): CompiledSystemInstructions | undefined {
  const statements = extractProcedureStatements(value);
  if (!statements) {
    const instructions = dedent(
      compileTemplateValue(value, ctx, { allowActionReferences: true })
    );
    return instructions
      ? { instructions, beforeReasoningIteration: [] }
      : undefined;
  }

  if (!validateSystemInstructionStatements(statements, ctx)) {
    return EMPTY_SYSTEM_INSTRUCTIONS;
  }

  const hasConditional = statements.some(
    statement => statement instanceof IfStatement
  );
  if (!hasConditional) {
    const instructions = dedent(
      compileTemplateValue(value, ctx, { allowActionReferences: true })
    );
    return instructions
      ? { instructions, beforeReasoningIteration: [] }
      : undefined;
  }

  ctx.usesDynamicSystemInstructions = true;
  const actions = compileDeterministicDirectives(statements, ctx, {
    addNextTopicResetAction: false,
    gateOnNextTopicEmpty: false,
    agentInstructionsVariable: SYSTEM_INSTRUCTIONS_VARIABLE,
  });

  return {
    instructions: `{{state.${SYSTEM_INSTRUCTIONS_VARIABLE}}}`,
    // The reset is prepended (and folded into the first unconditional append)
    // inside compileDeterministicDirectives on the instruction path.
    beforeReasoningIteration: actions,
  };
}

function extractProcedureStatements(value: unknown): Statement[] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const procedure = value as { __kind?: unknown; statements?: unknown };
  if (
    procedure.__kind !== 'ProcedureValue' ||
    !Array.isArray(procedure.statements)
  ) {
    return undefined;
  }
  return procedure.statements as Statement[];
}

function validateSystemInstructionStatements(
  statements: readonly Statement[],
  ctx: CompilerContext,
  insideConditional = false
): boolean {
  let valid = true;
  for (const statement of statements) {
    if (statement.__kind === 'Template') continue;
    if (statement instanceof IfStatement) {
      const isElseIf = statement.__cst?.node?.type === 'else_if_clause';
      if (insideConditional && !isElseIf) {
        ctx.error(
          "AgentScript does not support nested 'if' statements. Combine conditions with 'and'/'or', or restructure the logic.",
          getCstRange(statement),
          'unsupported-nested-if'
        );
        valid = false;
      }
      valid =
        validateSystemInstructionStatements(statement.body, ctx, true) && valid;
      valid =
        validateSystemInstructionStatements(statement.orelse, ctx, true) &&
        valid;
      continue;
    }

    ctx.error(
      'System instructions only support instruction text and if/else conditionals.',
      getCstRange(statement),
      'unsupported-system-instruction-statement'
    );
    valid = false;
  }
  return valid;
}
