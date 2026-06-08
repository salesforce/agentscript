/**
 * Lint rules for action bindings inside agentic nodes (orchestrator,
 * subagent, generator).
 *
 * Each agentic node may declare `reasoning.actions` that bind to
 * top-level `actions` definitions. This module validates that every
 * `with <param>` clause in those bindings references a parameter
 * that is either explicitly declared as an input on the referenced
 * action def or is an implicit parameter (e.g. `message`).
 */

import {
  Ellipsis,
  WithClause,
  decomposeAtMemberExpression,
  isNamedMap,
} from '@agentscript/language';
import {
  normalizeId,
  IMPLICIT_WITH_PARAMS,
  listActionDefInputNames,
} from '../../utils.js';
import { attachError, extractStringValue, type AstLike } from './shared.js';

function getActionDefName(
  toolEntry: Record<string, unknown>
): string | undefined {
  const rawColinear =
    toolEntry.value ??
    toolEntry.__colinear ??
    toolEntry.colinear ??
    toolEntry.__value;
  const ref = decomposeAtMemberExpression(rawColinear);
  if (ref && ref.namespace === 'actions') {
    return ref.property;
  }
  const strValue = extractStringValue(rawColinear);
  if (strValue) {
    return strValue.startsWith('@actions.') ? strValue.substring(9) : strValue;
  }
  return undefined;
}

function getBodyStatements(toolEntry: Record<string, unknown>): unknown[] {
  const body = toolEntry.body as { statements?: unknown[] } | undefined;
  if (body && Array.isArray(body.statements)) return body.statements;
  if (Array.isArray(toolEntry.statements)) return toolEntry.statements;
  return [];
}

function validateNodeActionBindings(
  nodeEntry: Record<string, unknown>,
  actionDefs: Map<string, Record<string, unknown>>
): void {
  const reasoning = nodeEntry.reasoning as Record<string, unknown> | undefined;
  if (!reasoning) return;

  const actionsMap = reasoning.actions;
  if (!actionsMap || typeof actionsMap !== 'object') return;
  if (!isNamedMap(actionsMap) && !(Symbol.iterator in actionsMap)) return;

  const entries =
    actionsMap instanceof Map
      ? actionsMap.entries()
      : (actionsMap as Iterable<[string, unknown]>);

  for (const [, toolEntry] of entries) {
    if (toolEntry == null || typeof toolEntry !== 'object') continue;
    const entry = toolEntry as Record<string, unknown>;
    const actionDefName = getActionDefName(entry);
    if (!actionDefName) continue;

    const actionDef = actionDefs.get(normalizeId(actionDefName));
    if (!actionDef) continue;

    const declaredInputs = new Set(listActionDefInputNames(actionDef));
    if (declaredInputs.size === 0) continue;

    const bodyStmts = getBodyStatements(entry);
    for (const stmt of bodyStmts) {
      if (!(stmt instanceof WithClause)) continue;
      if (stmt.value instanceof Ellipsis) continue;
      if (declaredInputs.has(stmt.param)) continue;
      if (IMPLICIT_WITH_PARAMS.has(stmt.param)) continue;

      attachError(
        nodeEntry as AstLike,
        `\`with ${stmt.param}\` is not a declared input on this action. ` +
          `Declared inputs: [${[...declaredInputs].join(', ')}]. ` +
          `Implicit parameters: [${[...IMPLICIT_WITH_PARAMS].join(', ')}].`,
        'action-binding-undeclared-input'
      );
    }
  }
}

const AGENTIC_NODE_TYPES = ['orchestrator', 'subagent', 'generator'] as const;

export function checkActionBindingRules(root: Record<string, unknown>): void {
  const actionDefs = isNamedMap(root.actions)
    ? new Map<string, Record<string, unknown>>(
        [...root.actions].map(([k, v]) => [
          normalizeId(k),
          v as Record<string, unknown>,
        ])
      )
    : undefined;

  if (!actionDefs) return;

  for (const nodeType of AGENTIC_NODE_TYPES) {
    const nodes = root[nodeType];
    if (!isNamedMap(nodes)) continue;

    for (const [, entry] of nodes) {
      if (entry == null || typeof entry !== 'object') continue;
      validateNodeActionBindings(entry as Record<string, unknown>, actionDefs);
    }
  }
}
