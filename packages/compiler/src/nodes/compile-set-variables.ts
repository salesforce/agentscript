import type { Expression, Statement } from '@agentscript/language';
import {
  MemberExpression,
  AtIdentifier,
  Identifier,
  SetClause,
  WithClause,
  Ellipsis,
} from '@agentscript/language';
import type { CompilerContext } from '../compiler-context.js';
import type { Tool, StateUpdate } from '../types.js';
import type { ParsedTool } from '../parsed-types.js';
import { STATE_UPDATE_ACTION } from '../constants.js';
import { compileExpression } from '../expressions/compile-expression.js';
import { extractSourcedString } from '../ast-helpers.js';
import type { Sourceable } from '../sourced.js';
import { stateVarToParameterDataType } from '../variables/variable-utils.js';

/**
 * Compile a @utils.setVariables reasoning action.
 *
 * Creates a Tool that updates state variables.
 * - `with param=value` → state_updates (direct assignment)
 * - `with param=...` → llm_inputs + state_updates (LLM-filled)
 * - `set @variables.x = value` → state_updates
 */
export function compileSetVariables(
  name: string,
  actionDef: ParsedTool,
  body: Statement[],
  ctx: CompilerContext
): Tool {
  const alias = extractSourcedString(actionDef.label);
  const description = extractSourcedString(actionDef.description);

  const llmInputs: string[] = [];
  const stateUpdates: StateUpdate[] = [];
  let hasWithClauses = false;

  for (const stmt of body) {
    if (stmt instanceof WithClause) {
      hasWithClauses = true;
      if (stmt.value instanceof Ellipsis) {
        // LLM-filled input: with param=...
        llmInputs.push(stmt.param);
        // Capture the LLM result as a state_update
        stateUpdates.push({ [stmt.param]: `result.${stmt.param}` });
      } else {
        // Direct assignment: with param=value → state_update
        const compiledValue = compileExpression(stmt.value, ctx, {
          expressionContext: "'with' clause",
        });
        stateUpdates.push({ [stmt.param]: compiledValue });
      }
    } else if (stmt instanceof SetClause) {
      const varName = extractVariableName(stmt.target, ctx);
      if (varName) {
        const compiledValue = compileExpression(stmt.value, ctx, {
          expressionContext: "'set' clause",
        });
        stateUpdates.push({ [varName]: compiledValue });
      }
    }
  }

  const tool: Sourceable<Tool> = {
    type: 'action',
    target: STATE_UPDATE_ACTION,
    state_updates: stateUpdates,
    name: alias ?? name,
  };

  if (description !== undefined) {
    tool.description = description;
  }

  // When the tool has with-clauses, emit the full tool structure
  if (hasWithClauses) {
    tool.bound_inputs = {};
    tool.llm_inputs = llmInputs;
    tool.input_parameters =
      llmInputs.length > 0
        ? llmInputs.map(inputName => {
            // Look up the variable's state type to derive the parameter data_type
            const stateVar = ctx.stateVariables.find(
              v => v.developer_name === inputName
            );
            const dataType = stateVar
              ? stateVarToParameterDataType(stateVar.data_type)
              : ('String' as const);
            return {
              developer_name: inputName,
              label: inputName,
              data_type: dataType,
            };
          })
        : [];
  }

  return tool as Tool;
}

function extractVariableName(
  expr: Expression,
  ctx: CompilerContext
): string | undefined {
  if (expr instanceof MemberExpression) {
    if (
      expr.object instanceof AtIdentifier &&
      expr.object.name === 'variables'
    ) {
      return expr.property;
    }
  }
  if (expr instanceof Identifier) {
    return expr.name;
  }
  ctx.error('Cannot resolve variable name', expr.__cst?.range);
  return undefined;
}
