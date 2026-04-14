import {
  MemberExpression,
  decomposeAtMemberExpression,
} from '@agentscript/language';
import type { ParsedTool } from '../parsed-types.js';

export type ActionType =
  | 'transition'
  | 'setVariables'
  | 'escalate'
  | 'supervise'
  | 'tool';

/**
 * Determine the action type of a reasoning action based on its @utils.* reference
 * or name prefix.
 */
export function resolveActionType(name: string, def: ParsedTool): ActionType {
  // Check the colinear expression for @utils.* patterns
  const colinear = def.value;
  if (colinear instanceof MemberExpression) {
    const decomposed = decomposeAtMemberExpression(colinear);
    if (decomposed) {
      if (decomposed.namespace === 'utils') {
        const utilName = decomposed.property;
        if (utilName === 'transition') return 'transition';
        if (utilName === 'setVariables') return 'setVariables';
        if (utilName === 'escalate') return 'escalate';
        if (utilName === 'supervise') return 'supervise';
      }
      // @topic.XXX and @subagent.XXX references are supervision actions
      if (
        decomposed.namespace === 'topic' ||
        decomposed.namespace === 'subagent' ||
        decomposed.namespace === 'connected_subagent'
      ) {
        return 'supervise';
      }
    }
  }

  // Check the name prefix as fallback
  if (name.startsWith('@utils.transition') || name === 'transition') {
    return 'transition';
  }
  if (name.startsWith('@utils.setVariables') || name === 'setVariables') {
    return 'setVariables';
  }
  if (name.startsWith('@utils.escalate') || name === 'escalate') {
    return 'escalate';
  }
  if (name.startsWith('@utils.supervise') || name === 'supervise') {
    return 'supervise';
  }

  return 'tool';
}
