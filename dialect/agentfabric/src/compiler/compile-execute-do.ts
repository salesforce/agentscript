/**
 * Compile `execute.do` procedures into ActionCallableReference[] for the graph.
 * Supports `set` (IdentityAction) and `run @actions.*` (action definitions) with the same
 * expression shapes used in AgentScript: @variables.*, @request.*, and
 * @<node_type>.<node_name>.output (for graph node outputs).
 */

import type {
  Expression,
  Statement,
  TemplatePart,
} from '@agentscript/language';
import {
  AtIdentifier,
  BinaryExpression,
  BooleanLiteral,
  CallExpression,
  ComparisonExpression,
  DictLiteral,
  Ellipsis,
  Identifier,
  ListLiteral,
  MemberExpression,
  NoneLiteral,
  NumberLiteral,
  RunStatement,
  SetClause,
  SpreadExpression,
  StringLiteral,
  SubscriptExpression,
  TemplateExpression,
  TemplateInterpolation,
  TemplateText,
  TernaryExpression,
  UnaryExpression,
  WithClause,
  decomposeAtMemberExpression,
  decomposeMemberExpression,
  isNamedMap,
} from '@agentscript/language';
import type { ActionCallableReference } from './unified-agent-specification.js';
import { ObjectTypes } from './unified-agent-specification.js';
import { normalizeId, extractString } from './utils.js';
import { AgentFabricSchemaInfo } from '../schema.js';
import { lowercaseHttpHeaderKeys } from './build-nodes.js';

export interface ExecuteVariableEnv {
  /** Mutable variable names (normalized snake_case). */
  mutable: ReadonlySet<string>;
  /** Linked variable names (read from external context). */
  linked: ReadonlySet<string>;
}

/**
 * - `execute`: top-level `executor.do` (previous-node data lives in `state.outputs`).
 * - `run-body`: inside `run @actions.*` — `@outputs.*` refers to the action invocation result.
 */
export type ExecuteExpressionMode = 'execute' | 'run-body';

const NAMESPACED_FUNCTION_NAMES: ReadonlySet<string> = new Set(
  Object.keys(AgentFabricSchemaInfo.namespacedFunctions!)
);

function isA2aNamespaceCall(expr: CallExpression): boolean {
  if (!(expr.func instanceof MemberExpression)) return false;
  const ref =
    decomposeAtMemberExpression(expr.func) ??
    decomposeMemberExpression(expr.func, NAMESPACED_FUNCTION_NAMES);
  return ref?.namespace === 'a2a';
}

const SYSTEM_NODE_OUTPUT_NAMESPACES = new Set([
  'orchestrator',
  'subagent',
  'generator',
]);

const NODE_OUTPUTS_RE = /^system\.node_outputs\['[^']+'\]$/;

/**
 * Wrap a bare `system.node_outputs['X']` reference with `parse_json()` so that
 * subsequent attribute / subscript access works at runtime (node_outputs values
 * are JSON strings, not dicts).  Bare references without further access are
 * left unchanged — they're used as whole string values.
 */
function wrapNodeOutputParseJson(compiled: string): string {
  return NODE_OUTPUTS_RE.test(compiled) ? `parse_json(${compiled})` : compiled;
}

const ALL_NODE_NAMESPACES = new Set([
  'orchestrator',
  'subagent',
  'generator',
  'executor',
  'router',
  'echo',
]);

/**
 * Collect variable namespaces from the parsed `variables:` block.
 */
export function collectExecuteVariableEnv(
  ast: Record<string, unknown>
): ExecuteVariableEnv {
  const mutable = new Set<string>();
  const linked = new Set<string>();

  const vars = ast.variables;
  if (!isNamedMap(vars)) {
    return { mutable, linked };
  }

  for (const [name, entry] of vars) {
    if (entry == null || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const mod = e.modifier as { name?: string } | undefined;
    const key = normalizeId(name);
    if (mod?.name === 'linked') {
      linked.add(key);
    } else {
      // mutable or unmarked — treat as assignable state for execute
      mutable.add(key);
    }
  }

  return { mutable, linked };
}

function getProcedureStatements(doValue: unknown): Statement[] {
  if (doValue == null || typeof doValue !== 'object') return [];
  const rec = doValue as Record<string, unknown>;
  if (!Array.isArray(rec.statements)) return [];
  return rec.statements as Statement[];
}

/**
 * Compile an expression for IdentityAction / tool state-updates (Python-style runtime strings).
 */
export function compileExecuteExpression(
  expr: Expression,
  env: ExecuteVariableEnv,
  mode: ExecuteExpressionMode = 'execute'
): string {
  return compileExpr(expr, env, mode);
}

function compileExpr(
  expr: Expression,
  env: ExecuteVariableEnv,
  mode: ExecuteExpressionMode
): string {
  if (expr instanceof MemberExpression) {
    const objectRef = decomposeAtMemberExpression(expr.object as Expression);
    if (
      objectRef?.namespace === 'request' &&
      objectRef.property === 'headers'
    ) {
      return `state.request.headers['${expr.property.toLowerCase()}']`;
    }
  }

  if (
    expr instanceof MemberExpression &&
    expr.property === 'output' &&
    expr.object instanceof MemberExpression
  ) {
    const nodeRef = decomposeAtMemberExpression(expr.object);
    if (nodeRef && nodeRef.namespace === 'executor') {
      return `state.outputs['${normalizeId(nodeRef.property)}']`;
    }
    if (nodeRef && SYSTEM_NODE_OUTPUT_NAMESPACES.has(nodeRef.namespace)) {
      return `system.node_outputs['${normalizeId(nodeRef.property)}']`;
    }
  }

  if (
    expr instanceof MemberExpression &&
    expr.property === 'input' &&
    expr.object instanceof MemberExpression
  ) {
    const nodeRef = decomposeAtMemberExpression(expr.object);
    if (nodeRef && ALL_NODE_NAMESPACES.has(nodeRef.namespace)) {
      return 'state._node_input';
    }
  }

  if (expr instanceof MemberExpression) {
    // Unify @namespace.property and bare namespace.property into the same path.
    const decomposed =
      decomposeAtMemberExpression(expr) ??
      decomposeMemberExpression(expr, NAMESPACED_FUNCTION_NAMES);
    if (decomposed) {
      const { namespace, property } = decomposed;
      const prop = normalizeId(property);

      switch (namespace) {
        case 'variables': {
          if (env.linked.has(prop)) {
            return `variables['${prop}']`;
          }
          return `state.${prop}`;
        }
        case 'outputs':
          return `result.${prop}`;
        case 'request':
          return `state.request.${prop}`;
        case 'a2a':
          return `a2a_${prop}`;
        default: {
          const obj = compileExpr(expr.object as Expression, env, mode);
          return `${wrapNodeOutputParseJson(obj)}.${expr.property}`;
        }
      }
    }

    const obj = compileExpr(expr.object as Expression, env, mode);
    if (expr.property === 'length') {
      return `len(${wrapNodeOutputParseJson(obj)})`;
    }
    return `${wrapNodeOutputParseJson(obj)}.${expr.property}`;
  }

  if (expr instanceof SubscriptExpression) {
    const objectRef = decomposeAtMemberExpression(expr.object as Expression);
    if (
      objectRef?.namespace === 'request' &&
      objectRef.property === 'headers'
    ) {
      const index = compileExpr(expr.index as Expression, env, mode);
      return `state.request.headers[lower(${index})]`;
    }
    if (expr.object instanceof AtIdentifier && expr.object.name === 'outputs') {
      const index = compileExpr(expr.index as Expression, env, mode);
      if (mode === 'run-body') {
        return `result[${index}]`;
      }
      return `state.outputs[${index}]`;
    }
    const obj = compileExpr(expr.object as Expression, env, mode);
    const index = compileExpr(expr.index as Expression, env, mode);
    return `${wrapNodeOutputParseJson(obj)}[${index}]`;
  }

  if (expr instanceof Identifier) {
    return expr.name;
  }

  if (expr instanceof StringLiteral) {
    return JSON.stringify(expr.value);
  }

  if (expr instanceof NumberLiteral) {
    return String(expr.value);
  }

  if (expr instanceof BooleanLiteral) {
    return expr.value ? 'True' : 'False';
  }

  if (expr instanceof NoneLiteral) {
    return 'None';
  }

  if (expr instanceof UnaryExpression) {
    const operand = compileExpr(expr.operand, env, mode);
    if (expr.operator === 'not') {
      return `not ${operand}`;
    }
    return `${expr.operator}${operand}`;
  }

  if (expr instanceof BinaryExpression) {
    const left = compileExpr(expr.left, env, mode);
    const right = compileExpr(expr.right, env, mode);
    return `${left} ${expr.operator} ${right}`;
  }

  if (expr instanceof ComparisonExpression) {
    const left = compileExpr(expr.left, env, mode);
    const right = compileExpr(expr.right, env, mode);
    return `${left} ${expr.operator} ${right}`;
  }

  if (expr instanceof TernaryExpression) {
    const consequence = compileExpr(expr.consequence, env, mode);
    const condition = compileExpr(expr.condition, env, mode);
    const alternative = compileExpr(expr.alternative, env, mode);
    return `${consequence} if ${condition} else ${alternative}`;
  }

  if (expr instanceof CallExpression) {
    const func = compileExpr(expr.func as Expression, env, mode);
    if (
      isA2aNamespaceCall(expr) &&
      expr.args.length === 1 &&
      expr.args[0] instanceof DictLiteral
    ) {
      const dict = expr.args[0];
      const kwargs = dict.entries
        .map(
          e =>
            `${compileExpr(e.key, env, mode)}=${compileExpr(e.value, env, mode)}`
        )
        .join(', ');
      return `${func}(${kwargs})`;
    }
    const args = expr.args
      .map((a: Expression) => compileExpr(a, env, mode))
      .join(', ');
    return `${func}(${args})`;
  }

  if (expr instanceof ListLiteral) {
    const elements = expr.elements
      .map((e: Expression) => compileExpr(e, env, mode))
      .join(', ');
    return `[${elements}]`;
  }

  if (expr instanceof DictLiteral) {
    const pairs = expr.entries
      .map(
        e =>
          `${compileExpr(e.key, env, mode)}: ${compileExpr(e.value, env, mode)}`
      )
      .join(', ');
    return `{${pairs}}`;
  }

  if (expr instanceof TemplateExpression) {
    if (expr.parts.length === 0) {
      // Parser can represent "" as an empty template expression; runtime expects
      // a valid Python string literal expression, not an empty expression.
      return '""';
    }
    return expr.parts
      .map((part: TemplatePart) => compileTemplatePart(part, env, mode))
      .join('');
  }

  if (expr instanceof Ellipsis) {
    return '...';
  }

  if (expr instanceof SpreadExpression) {
    return `*${compileExpr(expr.expression, env, mode)}`;
  }

  return '';
}

function compileTemplatePart(
  part: TemplatePart,
  env: ExecuteVariableEnv,
  mode: ExecuteExpressionMode
): string {
  if (part instanceof TemplateText) {
    return part.value;
  }
  if (part instanceof TemplateInterpolation) {
    const compiled = compileExpr(part.expression, env, mode);
    const normalized = compiled.replace(/\brequest\./g, 'state.request.');
    return `{{${normalized}}}`;
  }
  return '';
}

function actionDefRef(actionDefName: string): string {
  return `${actionDefName}-action`;
}

/**
 * Compile `execute` node's `do` procedure into ordered tool references.
 */
export function compileExecuteDoProcedure(
  doValue: unknown,
  actionDefs: Map<string, Record<string, unknown>> | undefined,
  ast: Record<string, unknown>,
  executeNodeName: string
): ActionCallableReference[] {
  const env = collectExecuteVariableEnv(ast);
  const statements = getProcedureStatements(doValue);
  const tools: ActionCallableReference[] = [];
  const pendingStateUpdates: Array<Record<string, string>> = [];

  const flushPendingIdentityAction = (): void => {
    if (pendingStateUpdates.length === 0) return;
    tools.push({
      type: ObjectTypes.ACTION,
      ref: 'IdentityAction',
      'state-updates': [...pendingStateUpdates],
    });
    pendingStateUpdates.length = 0;
  };

  for (const stmt of statements) {
    if (stmt instanceof SetClause) {
      const varName = normalizeId(
        decomposeAtMemberExpression(stmt.target)!.property
      );
      const valueExpr = compileExecuteExpression(stmt.value, env, 'execute');
      pendingStateUpdates.push({ [varName]: valueExpr });
      continue;
    }

    if (stmt instanceof RunStatement) {
      flushPendingIdentityAction();
      const actionDefName = normalizeId(
        decomposeAtMemberExpression(stmt.target)!.property
      );

      const boundInputs: Record<string, string> = {};
      const stateUpdates: Array<Record<string, string>> = [];

      for (const child of stmt.body) {
        if (child instanceof WithClause) {
          const compiled = compileExecuteExpression(
            child.value,
            env,
            'execute'
          );
          boundInputs[child.param] =
            child.param === 'http_headers'
              ? lowercaseHttpHeaderKeys(compiled)
              : compiled;
        } else if (child instanceof SetClause) {
          const key = normalizeId(
            decomposeAtMemberExpression(child.target)!.property
          );
          stateUpdates.push({
            [key]: compileExecuteExpression(child.value, env, 'run-body'),
          });
        }
      }

      const actionDef = actionDefs!.get(actionDefName)!;
      const resultField =
        extractString(actionDef.kind) === 'mcp:tool' ? 'content' : 'result';
      stateUpdates.push({
        outputs: `add(state.outputs, "${executeNodeName}", result["${resultField}"])`,
      });

      const action: ActionCallableReference = {
        type: ObjectTypes.ACTION,
        ref: actionDefRef(actionDefName),
      };
      if (Object.keys(boundInputs).length > 0) {
        action['bound-inputs'] = boundInputs;
      }
      if (stateUpdates.length > 0) {
        action['state-updates'] = stateUpdates;
      }
      tools.push(action);
      continue;
    }
  }

  flushPendingIdentityAction();
  return tools;
}
