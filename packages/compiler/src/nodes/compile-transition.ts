import type { Statement, Expression } from '@agentscript/language';
import type { Range } from '@agentscript/types';
import {
  ToClause,
  TransitionStatement,
  AvailableWhen,
} from '@agentscript/language';
import type { CompilerContext } from '../compiler-context.js';
import type { Tool, HandOffAction } from '../types.js';
import type { ParsedTool } from '../parsed-types.js';
import {
  STATE_UPDATE_ACTION,
  NEXT_TOPIC_VARIABLE,
  EMPTY_TOPIC_VALUE,
  TRANSITION_TARGET_NAMESPACES,
} from '../constants.js';
import {
  extractSourcedString,
  extractSourcedDescription,
  resolveAtReference,
} from '../ast-helpers.js';
import type { Sourceable } from '../sourced.js';
import { normalizeDeveloperName } from '../utils.js';
import { compileExpression } from '../expressions/compile-expression.js';
import { warnIfConnectedAgentTransition } from './compile-utils.js';

/**
 * Compile a @utils.transition reasoning action.
 *
 * Transitions create:
 * 1. A Tool that sets the next_topic state variable
 * 2. A HandOffAction that triggers topic switching
 */
export function compileTransition(
  name: string,
  actionDef: ParsedTool,
  body: Statement[],
  _currentTopicName: string,
  topicDescriptions: Record<string, string>,
  ctx: CompilerContext
): { tools: Tool[]; handOffActions: HandOffAction[] } {
  const tools: Tool[] = [];
  const handOffActions: HandOffAction[] = [];

  // Parse transition clauses from body
  const transitions: TransitionTarget[] = [];
  let availableWhenCondition: string | undefined;

  let lastAvailableWhenRange: Range | undefined;

  for (const stmt of body) {
    if (stmt instanceof ToClause) {
      if (warnIfConnectedAgentTransition(stmt.target, ctx)) continue;
      const targetName = resolveAtReference(
        stmt.target,
        TRANSITION_TARGET_NAMESPACES,
        ctx,
        'transition target'
      );
      if (targetName) {
        transitions.push({
          targetName,
          condition: availableWhenCondition,
          toClauseRange: stmt.__cst?.range,
          availableWhenRange: lastAvailableWhenRange,
        });
        availableWhenCondition = undefined;
        lastAvailableWhenRange = undefined;
      }
    } else if (stmt instanceof AvailableWhen) {
      availableWhenCondition = compileExpression(stmt.condition, ctx);
      lastAvailableWhenRange = stmt.__cst?.range;
    } else if (stmt instanceof TransitionStatement) {
      for (const clause of stmt.clauses) {
        if (clause instanceof ToClause) {
          if (warnIfConnectedAgentTransition(clause.target, ctx)) continue;
          const targetName = resolveAtReference(
            clause.target,
            TRANSITION_TARGET_NAMESPACES,
            ctx,
            'transition target'
          );
          if (targetName) {
            transitions.push({
              targetName,
              condition: availableWhenCondition,
              toClauseRange: clause.__cst?.range,
              availableWhenRange: lastAvailableWhenRange,
            });
            availableWhenCondition = undefined;
            lastAvailableWhenRange = undefined;
          }
        }
      }
    }
  }

  // If no transitions parsed from body, check for inline target in the action
  if (transitions.length === 0) {
    // The colinear value might encode a target (not typical for AgentForce)
    const colinear = actionDef.value;
    if (colinear) {
      if (!warnIfConnectedAgentTransition(colinear as Expression, ctx)) {
        const targetName = resolveAtReference(
          colinear as Expression,
          TRANSITION_TARGET_NAMESPACES,
          ctx,
          'transition target'
        );
        if (targetName) {
          transitions.push({ targetName, condition: undefined });
        }
      }
    }
  }

  const alias = extractSourcedString(actionDef.label);
  const description = extractSourcedDescription(actionDef.description) ?? '';

  for (const trans of transitions) {
    // Tool name: use the action key name from the .agent file
    const toolName = alias ?? name;
    const toolDescription =
      description ||
      topicDescriptions[trans.targetName] ||
      normalizeDeveloperName(trans.targetName);

    // Tool: set next_topic variable
    const tool: Sourceable<Tool> = {
      type: 'action',
      target: STATE_UPDATE_ACTION,
      state_updates: [{ [NEXT_TOPIC_VARIABLE]: `"${trans.targetName}"` }],
      name: toolName,
      description: toolDescription,
    };

    // Add enabled condition if present
    if (trans.condition) {
      tool.enabled = trans.condition;
    }

    tools.push(tool as Tool);

    // HandOff: trigger actual topic switch
    const handoff: HandOffAction = {
      type: 'handoff',
      target: trans.targetName,
      enabled: `state.${NEXT_TOPIC_VARIABLE}=="${trans.targetName}"`,
      state_updates: [{ [NEXT_TOPIC_VARIABLE]: EMPTY_TOPIC_VALUE }],
    };
    handOffActions.push(handoff);
  }

  return { tools, handOffActions };
}

interface TransitionTarget {
  targetName: string;
  condition?: string;
  /** CST range of the `to @topic.X` clause for specific annotation */
  toClauseRange?: Range;
  /** CST range of the `available when` clause */
  availableWhenRange?: Range;
}
