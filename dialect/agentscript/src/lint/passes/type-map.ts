/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { AstNodeLike, AstRoot, NamedMap } from '@agentscript/language';
import {
  storeKey,
  schemaContextKey,
  resolveNamespaceKeys,
  decomposeAtMemberExpression,
  isNamedMap,
} from '@agentscript/language';
import type { LintPass, PassStore } from '@agentscript/language';
import type { CstMeta, Range } from '@agentscript/types';
import { toRange } from '@agentscript/types';

export interface BooleanField {
  value: boolean;
  keyRange: Range;
  /** AST node for diagnostic attachment. */
  node: Record<string, unknown>;
}

export interface StringField {
  value: string;
  keyRange: Range;
  /** AST node for diagnostic attachment. */
  node: Record<string, unknown>;
}

export interface ParamInfo {
  /** e.g. "string", "boolean", "list[object]" */
  type: string;
  hasDefault: boolean;
}

export interface OutputParamInfo extends ParamInfo {
  isDisplayable?: BooleanField;
  isUsedByPlanner?: BooleanField;
}

export interface ActionSignature {
  inputs: Map<string, ParamInfo>;
  outputs: Map<string, OutputParamInfo>;
  requireUserConfirmation?: BooleanField;
  /** The `source` field value, if present. */
  source?: string;
  /** The `target` field, if present (e.g. "flow://Get_Account"). */
  target?: StringField;
}

export interface VariableTypeInfo {
  /** e.g. "string", "number", "boolean" */
  type: string;
  /** e.g. "linked", "mutable", or undefined if no modifier */
  modifier?: string;
}

export interface ConnectedAgentInputInfo extends ParamInfo {
  /** The ParameterDeclarationNode — attach diagnostics here (reachable by collectDiagnostics). */
  decl: AstNodeLike;
  /** The default value expression AST node, if present. */
  defaultValueNode?: AstNodeLike;
  /** CST metadata for the default value (for diagnostic ranges). */
  defaultValueCst?: CstMeta;
}

export interface ConnectedAgentInfo {
  inputs: Map<string, ConnectedAgentInputInfo>;
  /** The target URI string value, if present (e.g. "agentforce://Agent_Name"). */
  target?: string;
  /** The AST node for the target field (for diagnostic attachment). */
  targetNode?: AstNodeLike;
}

export interface TransitionTarget {
  namespace: string;
  property: string;
  range: Range;
  /** AST node to attach diagnostics to. */
  diagnosticParent: AstNodeLike;
}

export interface TypeMap {
  variables: Map<string, VariableTypeInfo>;
  /** subagent/topic → action → signature */
  actions: Map<string, Map<string, ActionSignature>>;
  /** connected agent name → info */
  connectedAgents: Map<string, ConnectedAgentInfo>;
  /** All transition targets found in reasoning actions and procedure blocks, keyed by namespace. */
  transitionTargets: Map<string, TransitionTarget[]>;
}

/** Extract type text from a declaration node's `type` field via CST source. */
function getTypeText(decl: Record<string, unknown>): string | null {
  const type = decl.type as Record<string, unknown> | undefined;
  if (!type) return null;
  const cst = type.__cst as CstMeta | undefined;
  return cst?.node?.text?.trim() ?? null;
}

/** Extract a BooleanField from an AST node, including the key range from the parent mapping_element. */
function extractBooleanField(node: unknown): BooleanField | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const obj = node as Record<string, unknown>;
  if (obj.__kind !== 'BooleanValue' || typeof obj.value !== 'boolean')
    return undefined;
  const cst = obj.__cst as CstMeta | undefined;
  if (!cst) return undefined;

  const parent = cst.node.parent;
  let keyRange = cst.range;
  if (parent?.type === 'mapping_element') {
    const keyNode = parent.childForFieldName('key');
    if (keyNode) keyRange = toRange(keyNode);
  }

  return { value: obj.value, keyRange, node: obj };
}

/** Extract a StringField from an AST node, including the key range from the parent mapping_element. */
function extractStringField(node: unknown): StringField | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const obj = node as Record<string, unknown>;
  if (obj.__kind !== 'StringLiteral' || typeof obj.value !== 'string')
    return undefined;
  const cst = obj.__cst as CstMeta | undefined;
  if (!cst) return undefined;

  const parent = cst.node.parent;
  let keyRange = cst.range;
  if (parent?.type === 'mapping_element') {
    const keyNode = parent.childForFieldName('key');
    if (keyNode) keyRange = toRange(keyNode);
  }

  return { value: obj.value, keyRange, node: obj };
}

function extractParamMap(mapValue: unknown): Map<string, ParamInfo> {
  const result = new Map<string, ParamInfo>();
  if (!mapValue || !isNamedMap(mapValue)) return result;

  for (const [name, decl] of mapValue as NamedMap<unknown>) {
    if (!decl || typeof decl !== 'object') continue;
    const obj = decl as Record<string, unknown>;
    const typeText = getTypeText(obj);
    if (!typeText) continue;
    result.set(name, {
      type: typeText,
      hasDefault: obj.defaultValue != null,
    });
  }

  return result;
}

function extractOutputParamMap(
  mapValue: unknown
): Map<string, OutputParamInfo> {
  const result = new Map<string, OutputParamInfo>();
  if (!mapValue || !isNamedMap(mapValue)) return result;

  for (const [name, decl] of mapValue as NamedMap<unknown>) {
    if (!decl || typeof decl !== 'object') continue;
    const obj = decl as Record<string, unknown>;
    const typeText = getTypeText(obj);
    if (!typeText) continue;

    const info: OutputParamInfo = {
      type: typeText,
      hasDefault: obj.defaultValue != null,
    };

    const props = obj.properties as Record<string, unknown> | undefined;
    if (props) {
      const isDisplayable = extractBooleanField(props.is_displayable);
      if (isDisplayable) info.isDisplayable = isDisplayable;

      const isUsedByPlanner = extractBooleanField(props.is_used_by_planner);
      if (isUsedByPlanner) info.isUsedByPlanner = isUsedByPlanner;
    }

    result.set(name, info);
  }

  return result;
}

export const typeMapKey = storeKey<TypeMap>('type-map');

class TypeMapAnalyzer implements LintPass {
  readonly id = typeMapKey;
  readonly description =
    'Extracts structured type information for variables and action parameters';

  private variables = new Map<string, VariableTypeInfo>();

  init(): void {
    this.variables = new Map();
  }

  visitVariables(varsMap: NamedMap<unknown>): void {
    for (const [name, decl] of varsMap) {
      if (!decl || typeof decl !== 'object') continue;
      const obj = decl as Record<string, unknown>;
      const typeText = getTypeText(obj);
      if (!typeText) continue;

      const modifier = obj.modifier as { name?: string } | undefined;
      this.variables.set(name, {
        type: typeText,
        modifier: modifier?.name,
      });
    }
  }

  finalize(store: PassStore, root: AstRoot): void {
    const ctx = store.get(schemaContextKey);
    const actions = new Map<string, Map<string, ActionSignature>>();
    const transitionTargets = new Map<string, TransitionTarget[]>();
    const rootObj = root as AstNodeLike;

    if (ctx) {
      // Support both 'subagent' (base dialect) and 'topic' (agentforce dialect)
      const subagentKeys = new Set([
        ...resolveNamespaceKeys('subagent', ctx),
        ...resolveNamespaceKeys('topic', ctx),
      ]);
      for (const topicKey of subagentKeys) {
        const topicMap = rootObj[topicKey];
        if (!topicMap || !isNamedMap(topicMap)) continue;

        for (const [topicName, block] of topicMap as NamedMap<unknown>) {
          if (!block || typeof block !== 'object') continue;
          const topic = block as AstNodeLike;

          // Extract action/tool definition signatures.
          const actionsMap = topic.actions;
          if (actionsMap && isNamedMap(actionsMap)) {
            for (const [actName, actBlock] of actionsMap as NamedMap<unknown>) {
              if (!actBlock || typeof actBlock !== 'object') continue;
              const act = actBlock as Record<string, unknown>;

              const inputs = extractParamMap(act.inputs);
              const outputs = extractOutputParamMap(act.outputs);
              const requireUserConfirmation = extractBooleanField(
                act.require_user_confirmation
              );
              const sourceNode = act.source as { value?: string } | undefined;
              const source =
                sourceNode && typeof sourceNode.value === 'string'
                  ? sourceNode.value
                  : undefined;

              const target = extractStringField(act.target);

              if (!actions.has(topicName)) {
                actions.set(topicName, new Map());
              }
              actions.get(topicName)!.set(actName, {
                inputs,
                outputs,
                requireUserConfirmation,
                source,
                target,
              });
            }
          }

          // Collect transition targets from procedure blocks and reasoning actions.
          collectTransitionTargets(topic.before_reasoning, transitionTargets);
          collectTransitionTargets(topic.after_reasoning, transitionTargets);

          const reasoning = topic.reasoning as
            | Record<string, unknown>
            | undefined;
          const reasoningTools = reasoning?.actions;
          if (reasoningTools && isNamedMap(reasoningTools)) {
            for (const [, raBlock] of reasoningTools as NamedMap<unknown>) {
              if (!raBlock || typeof raBlock !== 'object') continue;
              collectTransitionTargets(raBlock, transitionTargets);
            }
          }
        }
      }
    }

    const connectedAgents = new Map<string, ConnectedAgentInfo>();
    const caMap = rootObj.connected_subagent;
    if (caMap && isNamedMap(caMap)) {
      for (const [agentName, block] of caMap as NamedMap<unknown>) {
        if (!block || typeof block !== 'object') continue;
        const node = block as AstNodeLike;
        const inputsMap = node.inputs;
        const inputs = new Map<string, ConnectedAgentInputInfo>();

        if (inputsMap && isNamedMap(inputsMap)) {
          for (const [inputName, paramDef] of inputsMap as NamedMap<unknown>) {
            if (!paramDef || typeof paramDef !== 'object') continue;
            const decl = paramDef as AstNodeLike;
            const typeText = getTypeText(decl as Record<string, unknown>);
            if (!typeText) continue;

            const defaultValue = decl.defaultValue as AstNodeLike | undefined;
            const defaultValueCst = defaultValue?.__cst as CstMeta | undefined;

            inputs.set(inputName, {
              type: typeText,
              hasDefault: defaultValue != null,
              decl,
              defaultValueNode: defaultValue,
              defaultValueCst: defaultValueCst ?? undefined,
            });
          }
        }

        const targetNode = node.target as AstNodeLike | undefined;
        const target =
          targetNode && typeof targetNode.value === 'string'
            ? targetNode.value
            : undefined;

        connectedAgents.set(agentName, { inputs, target, targetNode });
      }
    }

    store.set(typeMapKey, {
      variables: this.variables,
      actions,
      connectedAgents,
      transitionTargets,
    });
  }
}

/** Walk statements in a block and collect all transition targets. */
function collectTransitionTargets(
  block: unknown,
  targets: Map<string, TransitionTarget[]>
): void {
  if (!block || typeof block !== 'object') return;
  const obj = block as AstNodeLike;
  const stmts = obj.statements as Array<Record<string, unknown>> | undefined;
  if (!stmts) return;

  for (const stmt of stmts) {
    collectTransitionTargetsFromStatement(stmt, obj, targets);
  }
}

function collectTransitionTargetsFromStatement(
  stmt: Record<string, unknown>,
  diagnosticParent: AstNodeLike,
  targets: Map<string, TransitionTarget[]>
): void {
  if (stmt.__kind === 'ToClause') {
    collectToTarget(stmt, diagnosticParent, targets);
  } else if (stmt.__kind === 'TransitionStatement') {
    const clauses = stmt.clauses as Array<Record<string, unknown>> | undefined;
    if (clauses) {
      for (const clause of clauses) {
        if (clause.__kind === 'ToClause') {
          collectToTarget(clause, diagnosticParent, targets);
        }
      }
    }
  } else if (stmt.__kind === 'IfStatement') {
    const body = stmt.body as Array<Record<string, unknown>> | undefined;
    if (body) {
      for (const s of body)
        collectTransitionTargetsFromStatement(s, diagnosticParent, targets);
    }
    const orelse = stmt.orelse as Array<Record<string, unknown>> | undefined;
    if (orelse) {
      for (const s of orelse)
        collectTransitionTargetsFromStatement(s, diagnosticParent, targets);
    }
  }
}

function collectToTarget(
  toClause: Record<string, unknown>,
  diagnosticParent: AstNodeLike,
  targets: Map<string, TransitionTarget[]>
): void {
  const target = toClause.target;
  if (!target || typeof target !== 'object') return;

  const ref = decomposeAtMemberExpression(target);
  if (!ref) return;

  const targetCst = (target as AstNodeLike).__cst as CstMeta | undefined;
  const range = targetCst?.range ?? (toClause as AstNodeLike).__cst?.range;
  if (!range) return;

  const entry: TransitionTarget = {
    namespace: ref.namespace,
    property: ref.property,
    range,
    diagnosticParent,
  };
  const list = targets.get(ref.namespace);
  if (list) {
    list.push(entry);
  } else {
    targets.set(ref.namespace, [entry]);
  }
}

export function typeMapAnalyzer(): LintPass {
  return new TypeMapAnalyzer();
}
