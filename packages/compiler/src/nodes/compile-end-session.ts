import type { Statement } from '@agentscript/language';
import { AvailableWhen } from '@agentscript/language';
import type { CompilerContext } from '../compiler-context.js';
import type { Tool } from '../types.js';
import type { ParsedTool } from '../parsed-types.js';
import { END_SESSION_TARGET } from '../constants.js';
import {
  extractSourcedString,
  extractSourcedDescription,
} from '../ast-helpers.js';
import type { Sourceable } from '../sourced.js';
import { compileExpression } from '../expressions/compile-expression.js';

/**
 * Compile a @utils.end_session reasoning action.
 *
 * Creates a tool that ends the current session. Unlike escalate,
 * this compiles to a single tool (no state-update + handoff pattern).
 *
 * When `available when` is present, the tool gets an `enabled` condition
 * so the LLM can only select it when the condition is met.
 */
export function compileEndSession(
  name: string,
  actionDef: ParsedTool,
  body: Statement[],
  ctx: CompilerContext
): { tool: Tool } {
  const alias = extractSourcedString(actionDef.label);
  const description =
    extractSourcedDescription(actionDef.description) ?? 'End the session';

  // Check for available when condition
  let enabledCondition: string | undefined;
  for (const stmt of body) {
    if (stmt instanceof AvailableWhen) {
      enabledCondition = compileExpression(stmt.condition, ctx, {
        expressionContext: "'available when' clause",
      });
    }
  }

  const tool: Sourceable<Tool> = {
    type: 'action',
    target: END_SESSION_TARGET,
    name: alias ?? name,
    description,
  };

  if (enabledCondition) {
    tool.enabled = enabledCondition;
  }

  return { tool: tool as Tool };
}
