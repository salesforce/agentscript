/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { IfStatement } from '@agentscript/language';
import type { Statement } from '@agentscript/language';
import type {
  CompilerContext,
  DynamicConnectionSystemInstructions,
} from '../compiler-context.js';
import type { ParsedSystem, ParsedTopicLike } from '../parsed-types.js';
import type { Action, HandOffAction } from '../types.js';
import {
  CONNECTION_SYSTEM_INSTRUCTIONS_VARIABLE,
  SYSTEM_INSTRUCTIONS_VARIABLE,
} from '../constants.js';
import { getCstRange } from '../ast-helpers.js';
import { compileTemplateValue } from '../expressions/compile-template.js';
import { dedent } from '../utils.js';
import { compileDeterministicDirectives } from './compile-directives.js';
import {
  createInstructionResetAction,
  createStateUpdateAction,
  instructionAppendValue,
} from './optimize-actions.js';

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

  ctx.usesSystemInstructionsVariable = true;
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

/**
 * Appends each conditional connection's system instructions to a subagent's
 * compiled system instructions, gated on its connection.
 * Static text stays as is; only the connection part is rebuilt before each
 * reasoning iteration.
 */
export function appendConnectionSystemInstructions(
  compiled: CompiledSystemInstructions,
  ctx: CompilerContext
): CompiledSystemInstructions {
  const connections = ctx.dynamicConnectionSystemInstructions;
  if (connections.length === 0) return compiled;

  // Compiled per subagent, so condition slots follow the subagent's own.
  const connectionActions = connections.flatMap(connection =>
    compileConnectionSystemInstructions(connection, ctx)
  );
  ctx.usesSystemInstructionsVariable = true;
  ctx.usesDynamicConnectionSystemInstructions = true;
  const isStatic = compiled.beforeReasoningIteration.length === 0;
  if (isStatic) {
    return {
      instructions: `${compiled.instructions}{{state.${SYSTEM_INSTRUCTIONS_VARIABLE}}}`,
      beforeReasoningIteration: [
        createInstructionResetAction(SYSTEM_INSTRUCTIONS_VARIABLE),
        ...connectionActions,
      ],
    };
  }
  return {
    instructions: compiled.instructions,
    beforeReasoningIteration: [
      ...compiled.beforeReasoningIteration,
      ...connectionActions,
    ],
  };
}

/**
 * Compiles actions that build one connection's system instructions in a
 * separate state variable, line by line as their conditions pass, then append
 * that text to the system instructions.
 * The append is skipped when no line was added.
 */
function compileConnectionSystemInstructions(
  { connectionName, statements }: DynamicConnectionSystemInstructions,
  ctx: CompilerContext
): (Action | HandOffAction)[] {
  const activeConnectionGate = buildConnectionGate(connectionName);
  const previousConnectionName = ctx.connectionName;
  // Compiles `@inputs.X` to `connection.<name>.X`.
  ctx.connectionName = connectionName;
  try {
    return [
      ...compileDeterministicDirectives(statements, ctx, {
        addNextTopicResetAction: false,
        gateOnNextTopicEmpty: false,
        agentInstructionsVariable: CONNECTION_SYSTEM_INSTRUCTIONS_VARIABLE,
        enabled: activeConnectionGate,
      }),
      createStateUpdateAction(
        [
          {
            [SYSTEM_INSTRUCTIONS_VARIABLE]: instructionAppendValue(
              SYSTEM_INSTRUCTIONS_VARIABLE,
              `{{state.${CONNECTION_SYSTEM_INSTRUCTIONS_VARIABLE}}}`
            ),
          },
        ],
        `(${activeConnectionGate}) and (state.${CONNECTION_SYSTEM_INSTRUCTIONS_VARIABLE} != "")`
      ),
    ];
  } finally {
    // Leave the connection context, so later `@inputs` keep their plain form.
    ctx.connectionName = previousConnectionName;
  }
}

/**
 * Returns a gate that evaluates to true while `connectionName` is the current
 * connection.
 * Only 2 spellings are officially accepted:
 * - Core Enum (PascalCase/camelCase: `CustomerWebClient`, `customerWebClient`)
 * - Script name (snake_case: `customer_web_client`).
 * The gate lowercases both sides, so either spelling matches.
 */
function buildConnectionGate(connectionName: string): string {
  const name = connectionName.toLowerCase();
  const spellings = name.includes('_')
    ? [name, name.replace(/_/g, '')]
    : [name];
  const list = spellings.map(spelling => JSON.stringify(spelling)).join(', ');
  return `lower(system.current_connection or "") in [${list}]`;
}

/**
 * Returns the connections whose `additional_system_instructions` is a valid
 * procedure with at least one `if`; their whole field moves into the standard
 * subagents' system instructions.
 * Static text and procedures without an `if` are skipped and left to the
 * surface; invalid procedures are reported and dropped.
 */
export function collectDynamicConnectionSystemInstructions(
  connections: Iterable<[string, { additional_system_instructions?: unknown }]>,
  ctx: CompilerContext
): DynamicConnectionSystemInstructions[] {
  const result: DynamicConnectionSystemInstructions[] = [];
  for (const [name, def] of connections) {
    const statements = extractProcedureStatements(
      def.additional_system_instructions
    );
    if (!statements?.some(statement => statement instanceof IfStatement)) {
      continue;
    }
    if (!validateSystemInstructionStatements(statements, ctx)) continue;
    result.push({ connectionName: name, statements });
  }
  return result;
}

export function extractProcedureStatements(
  value: unknown
): Statement[] | undefined {
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

export function validateSystemInstructionStatements(
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
