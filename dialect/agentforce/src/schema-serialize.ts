/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Schema serialization for the Agentforce dialect.
 *
 * Exposes a structured, JSON-serializable representation of the dialect schema,
 * including root blocks, global scopes, lint rules, and action target URI schemes.
 */

import {
  AgentforceSchemaInfo,
  AgentforceSchema,
  agentforceSchemaContext,
} from './schema.js';
import { defaultRules as agentforceRules } from './lint/passes/index.js';
import { VALID_SCHEMES } from './lint/passes/action-target.js';
import { ALLOWED_SCHEMES as CONNECTED_AGENT_SCHEMES } from './lint/passes/connected-agents/target-validation.js';
import {
  RESPONSE_FORMAT_TARGET_SCHEMES,
  ALLOWED_CONNECTION_INPUT_TYPES,
} from './lint/passes/connection-validation.js';
import { ALLOWED_AGENT_TYPES } from './lint/agent-types.js';
import { keywordNames, getGlobalScopes } from '@agentscript/language';
import type { GlobalScopeMember } from '@agentscript/language';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SerializedFieldBase {
  description?: string;
  example?: string;
  required?: boolean;
  deprecated?: { message?: string; since?: string; removeIn?: string };
  experimental?: boolean;
  constraints?: Record<string, unknown>;
  omitArrow?: boolean;
  crossBlockReferenceable?: boolean;
}

export interface SerializedBlockField extends SerializedFieldBase {
  fieldKind: 'Block';
  type: string;
  fields?: Record<string, SerializedField>;
}

export interface SerializedTypedMapField extends SerializedFieldBase {
  fieldKind: 'TypedMap';
  type: string;
  modifiers?: readonly string[];
  primitiveTypes?: readonly string[];
  propertiesFields?: Record<string, SerializedField>;
}

export interface SerializedPrimitiveField extends SerializedFieldBase {
  fieldKind: 'Primitive';
  type: string;
  accepts?: string[];
}

export interface SerializedSequenceField extends SerializedFieldBase {
  fieldKind: 'Sequence';
  type: 'Sequence';
  itemFields?: Record<string, SerializedField>;
}

export interface SerializedCollectionField extends SerializedFieldBase {
  fieldKind: 'Collection';
  type: string;
  fields?: Record<string, SerializedField>;
  scopeAlias?: string;
}

export type SerializedField =
  | SerializedBlockField
  | SerializedTypedMapField
  | SerializedPrimitiveField
  | SerializedSequenceField
  | SerializedCollectionField;

export interface SerializedDiagnosticCode {
  code: string;
  severity: 'error' | 'warning' | 'information';
  description: string;
}

export interface SerializedLintRule {
  id: string;
  description: string;
  diagnosticCodes: SerializedDiagnosticCode[];
}

/** A single global-scope member, carrying its type/capability and any nested sub-members. */
export interface SerializedGlobalScopeMember {
  type?: string;
  capability?: string;
  subMembers?: Record<string, SerializedGlobalScopeMember>;
}

/** A global scope: a namespace whose members are typed declarations. */
export interface SerializedGlobalScope {
  members: Record<string, SerializedGlobalScopeMember>;
}

/** Serialized dialect schema. */
export interface SerializedSchema {
  dialect: string;
  rootBlocks: Record<string, SerializedField>;
  aliases: Record<string, string>;
  globalScopes: Record<string, SerializedGlobalScope>;
  lintRules: SerializedLintRule[];
  actionTargetSchemes: readonly string[];
  agentTypes: readonly string[];
  connectedAgentSchemes: readonly string[];
  responseFormatTargetSchemes: readonly string[];
  connectionInputTypes: readonly string[];
}

// ---------------------------------------------------------------------------
// Recursion guard
// ---------------------------------------------------------------------------

const RECURSION_GUARD = new WeakSet<object>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function inferPrimitiveType(field: Record<string, unknown>): string {
  const accepts = field.__accepts as string[] | undefined;
  if (!accepts || accepts.length === 0) {
    if (field.emitField) return 'ProcedureValue';
    return 'ExpressionValue';
  }
  if (accepts.includes('MemberExpression') && accepts.length === 1)
    return 'ReferenceValue';
  if (accepts.includes('NumberLiteral') && accepts.length === 1)
    return 'NumberValue';
  if (accepts.includes('BooleanLiteral') && accepts.length === 1)
    return 'BooleanValue';
  if (
    accepts.includes('StringLiteral') ||
    accepts.includes('TemplateExpression')
  )
    return 'StringValue';
  return 'ExpressionValue';
}

function getBlockKindName(field: Record<string, unknown>): string | undefined {
  if (typeof field.kind === 'string') return field.kind;
  return field.__fieldKind as string | undefined;
}

function extractMetadata(field: Record<string, unknown>): SerializedFieldBase {
  const meta = field.__metadata as Record<string, unknown> | undefined;
  if (!meta) return {};

  const result: SerializedFieldBase = {};
  if (meta.description) result.description = meta.description as string;
  if (meta.example) result.example = meta.example as string;
  if (meta.required) result.required = true;
  if (meta.deprecated)
    result.deprecated = meta.deprecated as SerializedFieldBase['deprecated'];
  if (meta.experimental) result.experimental = true;
  if (meta.omitArrow) result.omitArrow = true;
  if (meta.crossBlockReferenceable) result.crossBlockReferenceable = true;

  if (meta.constraints) {
    const cm = meta.constraints as Record<string, unknown>;
    const c: Record<string, unknown> = {};
    for (const key of [
      'minimum',
      'maximum',
      'exclusiveMinimum',
      'exclusiveMaximum',
      'multipleOf',
      'minLength',
      'maxLength',
      'pattern',
      'enum',
      'const',
      'minItems',
      'maxItems',
      'allowedNamespaces',
    ]) {
      if (cm[key] !== undefined) c[key] = cm[key];
    }
    if (Object.keys(c).length > 0) result.constraints = c;
  }

  return result;
}

function serializeSchema(
  schema: Record<string, unknown>
): Record<string, SerializedField> {
  const result: Record<string, SerializedField> = {};
  for (const [key, fieldOrArray] of Object.entries(schema)) {
    if (key.startsWith('__')) continue;
    const field = (
      Array.isArray(fieldOrArray) ? fieldOrArray[0] : fieldOrArray
    ) as Record<string, unknown> | undefined;
    if (!field) continue;
    result[key] = serializeField(field);
  }
  return result;
}

/** Builds the truncated stand-in emitted for a field already on the recursion stack. */
function buildRecursionStub(
  fieldKind: unknown,
  type: string,
  meta: SerializedFieldBase
): SerializedField {
  const stubMeta: SerializedFieldBase = {
    ...(meta.description ? { description: meta.description } : {}),
    ...(meta.required ? { required: true } : {}),
  };

  switch (fieldKind) {
    case 'Block':
      return { fieldKind: 'Block', type, ...stubMeta };
    case 'TypedMap':
      return { fieldKind: 'TypedMap', type, ...stubMeta };
    case 'Primitive':
      return { fieldKind: 'Primitive', type, ...stubMeta };
    case 'Sequence':
      return { fieldKind: 'Sequence', type: 'Sequence', ...stubMeta };
    case 'Collection':
      return { fieldKind: 'Collection', type, ...stubMeta };
    default:
      throw new Error(
        `Unknown field kind encountered during recursion: ${String(fieldKind)}`
      );
  }
}

function serializeField(field: Record<string, unknown>): SerializedField {
  const meta = extractMetadata(field);

  if (typeof field === 'object' && field !== null) {
    if (RECURSION_GUARD.has(field)) {
      return buildRecursionStub(
        field.__fieldKind,
        getBlockKindName(field) ?? 'Unknown',
        meta
      );
    }
    RECURSION_GUARD.add(field);
  }

  try {
    switch (field.__fieldKind) {
      case 'Block': {
        const schema = field.schema as Record<string, unknown> | undefined;
        const fields =
          schema && Object.keys(schema).length > 0
            ? serializeSchema(schema)
            : undefined;
        return {
          fieldKind: 'Block',
          type: getBlockKindName(field) ?? 'Unknown',
          ...meta,
          ...(fields ? { fields } : {}),
        };
      }
      case 'TypedMap': {
        const modifiers = Array.isArray(field.__modifiers)
          ? keywordNames(field.__modifiers)
          : undefined;
        const primitiveTypes = Array.isArray(field.__primitiveTypes)
          ? keywordNames(field.__primitiveTypes)
          : undefined;
        const propertiesFields = field.propertiesSchema
          ? serializeSchema(field.propertiesSchema as Record<string, unknown>)
          : undefined;
        return {
          fieldKind: 'TypedMap',
          type: getBlockKindName(field) ?? 'Unknown',
          ...meta,
          ...(modifiers ? { modifiers } : {}),
          ...(primitiveTypes ? { primitiveTypes } : {}),
          ...(propertiesFields ? { propertiesFields } : {}),
        };
      }
      case 'Primitive': {
        const accepts = field.__accepts as string[] | undefined;
        return {
          fieldKind: 'Primitive',
          type: inferPrimitiveType(field),
          ...meta,
          ...(accepts && accepts.length > 0 ? { accepts: [...accepts] } : {}),
        };
      }
      case 'Sequence': {
        const schema = field.schema as Record<string, unknown> | undefined;
        const itemFields =
          schema && Object.keys(schema).length > 0
            ? serializeSchema(schema)
            : undefined;
        return {
          fieldKind: 'Sequence',
          type: 'Sequence',
          ...meta,
          ...(itemFields ? { itemFields } : {}),
        };
      }
      case 'Collection': {
        const schema = field.schema as Record<string, unknown> | undefined;
        const fields =
          schema && Object.keys(schema).length > 0
            ? serializeSchema(schema)
            : undefined;
        return {
          fieldKind: 'Collection',
          type: getBlockKindName(field) ?? 'Collection',
          ...meta,
          ...(fields ? { fields } : {}),
          ...(field.scopeAlias
            ? { scopeAlias: field.scopeAlias as string }
            : {}),
        };
      }
      default:
        throw new Error(`Unknown field kind: ${String(field.__fieldKind)}`);
    }
  } finally {
    if (typeof field === 'object' && field !== null) {
      RECURSION_GUARD.delete(field);
    }
  }
}

// ---------------------------------------------------------------------------
// Lint rule serialization
// ---------------------------------------------------------------------------

export const DIAGNOSTIC_CODES: Record<string, SerializedDiagnosticCode[]> = {
  'execution-mode': [
    {
      code: 'execution-mode-unsupported',
      severity: 'error',
      description:
        'This reasoning action does not support non-blocking execution.',
    },
    {
      code: 'non-blocking-output-unavailable',
      severity: 'error',
      description:
        'Fire-and-forget tool results are unavailable to output-dependent statements and render rules.',
    },
  ],
  'symbol-table': [],
  'position-index': [],
  'duplicate-key': [
    {
      code: 'duplicate-key',
      severity: 'warning',
      description: 'Duplicate key in a named mapping block.',
    },
  ],
  'required-fields': [
    {
      code: 'missing-required-field',
      severity: 'error',
      description:
        'A required field is missing from a block (e.g., topic without description).',
    },
  ],
  'workflow-validation': [
    {
      code: 'workflow-step-form-required',
      severity: 'error',
      description:
        "A workflow defines neither an unnamed 'steps:' flow nor a named 'step <name>:' block.",
    },
    {
      code: 'workflow-step-form-conflict',
      severity: 'error',
      description:
        "A workflow mixes an unnamed 'steps:' flow with named 'step <name>:' blocks.",
    },
    {
      code: 'workflow-empty-steps',
      severity: 'error',
      description: "An unnamed 'steps:' workflow flow contains no directives.",
    },
    {
      code: 'workflow-empty-step',
      severity: 'error',
      description: 'A named workflow step contains no directives.',
    },
    {
      code: 'workflow-with-ellipsis',
      severity: 'error',
      description:
        "A workflow 'run @actions.X' binds an input with 'with p = ...'. Workflow actions have no LLM to fill inputs.",
    },
    {
      code: 'workflow-action-missing-input',
      severity: 'error',
      description:
        "A workflow 'run @actions.X' leaves an input marked 'is_required: True' with no default without a 'with' clause. Workflow actions have no LLM to fill inputs.",
    },
    {
      code: 'workflow-unknown-action',
      severity: 'error',
      description:
        "A workflow 'run @actions.X' targets an action that is not defined in the workflow's own 'actions'. Top-level actions are not available to workflows.",
    },
    {
      code: 'action-unknown-input',
      severity: 'error',
      description:
        'A workflow \'run @actions.X\' binds an input not defined on the action. Includes "did you mean?" suggestions.',
    },
    {
      code: 'action-unknown-output',
      severity: 'error',
      description:
        'A workflow \'run @actions.X\' sets from an output not defined on the action. Includes "did you mean?" suggestions.',
    },
    {
      code: 'workflow-action-confirmation-ignored',
      severity: 'warning',
      description:
        "A workflow 'run @actions.X' targets an action with 'require_user_confirmation: True'. Workflows don't support confirmation yet, so the action runs without it.",
    },
    {
      code: 'workflow-duplicate-node-name',
      severity: 'error',
      description:
        'A workflow has the same name as a subagent, topic, start_agent, orchestrator, or connected agent; both would compile to a node with the same developer_name.',
    },
  ],
  'singular-collection': [
    {
      code: 'singular-collection',
      severity: 'error',
      description:
        'A collection field marked singular (e.g. start_agent) has more than one entry.',
    },
  ],
  'constraint-validation': [
    {
      code: 'constraint-enum',
      severity: 'error',
      description: 'Value is not in the allowed enum list.',
    },
    {
      code: 'constraint-const',
      severity: 'error',
      description: 'Value does not match the required constant.',
    },
    {
      code: 'constraint-minimum',
      severity: 'error',
      description: 'Number is below the minimum.',
    },
    {
      code: 'constraint-maximum',
      severity: 'error',
      description: 'Number exceeds the maximum.',
    },
    {
      code: 'constraint-exclusive-minimum',
      severity: 'error',
      description: 'Number is at or below the exclusive minimum.',
    },
    {
      code: 'constraint-exclusive-maximum',
      severity: 'error',
      description: 'Number is at or above the exclusive maximum.',
    },
    {
      code: 'constraint-multiple-of',
      severity: 'error',
      description: 'Number is not a multiple of the required value.',
    },
    {
      code: 'constraint-min-length',
      severity: 'error',
      description: 'String is shorter than the minimum length.',
    },
    {
      code: 'constraint-max-length',
      severity: 'error',
      description: 'String exceeds the maximum length.',
    },
    {
      code: 'constraint-pattern',
      severity: 'error',
      description: 'String does not match the required regex pattern.',
    },
    {
      code: 'constraint-invalid-pattern',
      severity: 'warning',
      description: 'The regex pattern in the schema is invalid.',
    },
    {
      code: 'constraint-min-items',
      severity: 'error',
      description: 'Sequence has fewer items than the minimum.',
    },
    {
      code: 'constraint-max-items',
      severity: 'error',
      description: 'Sequence has more items than the maximum.',
    },
    {
      code: 'constraint-allowed-namespaces',
      severity: 'error',
      description:
        'Reference uses a namespace not in the allowed list (e.g., @Unknown.field).',
    },
  ],
  'unreachable-code': [
    {
      code: 'unreachable-code',
      severity: 'warning',
      description:
        'Code after a terminal statement (transition, escalate) is unreachable.',
    },
  ],
  'unsupported-conditionals': [
    {
      code: 'unsupported-nested-if',
      severity: 'error',
      description:
        "AgentScript does not support nested 'if' statements; combine conditions with 'and'/'or' or restructure the logic.",
    },
  ],
  'transition-target': [
    {
      code: 'transition-missing-target',
      severity: 'error',
      description: "A 'transition' statement has no 'to <target>' clause.",
    },
    {
      code: 'transition-multiple-targets',
      severity: 'error',
      description: "A 'transition' statement has more than one 'to' clause.",
    },
  ],
  'empty-block': [
    {
      code: 'empty-block',
      severity: 'error',
      description:
        "A named-map field required to hold at least one entry (e.g. 'inputs', 'outputs') is empty.",
    },
  ],
  'unused-variable': [
    {
      code: 'unused-variable',
      severity: 'information',
      description: 'A declared variable is never referenced.',
    },
  ],
  'expression-validation': [
    {
      code: 'unknown-function',
      severity: 'error',
      description:
        'A function call references a name not in the recognized function set (built-in or namespaced). Includes "did you mean?" suggestions.',
    },
    {
      code: 'namespace-function-call',
      severity: 'error',
      description:
        'A call expression targets a namespace function indirectly rather than calling it directly.',
    },
    {
      code: 'indirect-function-call',
      severity: 'error',
      description:
        'A call expression is indirect (e.g. a method call) rather than a direct call to a built-in function.',
    },
    {
      code: 'malformed-ast',
      severity: 'warning',
      description:
        'An Identifier node in the AST is missing its name property.',
    },
    {
      code: 'unsupported-operator',
      severity: 'error',
      description:
        'A binary expression uses an operator that is not supported.',
    },
    {
      code: 'bare-uploaded-files-reference',
      severity: 'error',
      description:
        '@system_variables.uploaded_files is referenced as a bare list rather than indexed, sliced, or wrapped in len().',
    },
    {
      code: 'unsupported-slice-target',
      severity: 'error',
      description:
        'A slice expression targets @system_variables directly instead of @system_variables.uploaded_files.',
    },
  ],
  'spread-context': [
    {
      code: 'invalid-spread-context',
      severity: 'error',
      description:
        'A spread expression (*expr) appears outside a call argument or list-literal element.',
    },
  ],
  'identifier-validation': [
    {
      code: 'identifier-confusable-none',
      severity: 'error',
      description:
        "A bare 'none' identifier is used as a value; the capitalized 'None' literal was likely intended.",
    },
    {
      code: 'identifier-confusable-boolean',
      severity: 'error',
      description:
        "A bare 'true'/'false' identifier is used as a value; the capitalized 'True'/'False' literal was likely intended.",
    },
    {
      code: 'null-not-allowed',
      severity: 'error',
      description:
        "A bare 'null' identifier is used as a value; AgentScript has no 'null' — use 'None' or an empty string.",
    },
    {
      code: 'unknown-identifier',
      severity: 'error',
      description:
        'A bare identifier is used as an expression value but does not resolve to a literal or an @variables.X reference.',
    },
  ],
  'agentiq-validation': [
    {
      code: 'workflow-exactly-one-target',
      severity: 'error',
      description: "A workflow defines neither 'agent' nor 'prompt'.",
    },
    {
      code: 'invalid-workflow-agent',
      severity: 'error',
      description:
        "A workflow's 'agent' does not reference @subagent or @connected_subagent.",
    },
    {
      code: 'invalid-cron-schedule',
      severity: 'error',
      description: "A trigger's 'schedule' is not a valid cron expression.",
    },
    {
      code: 'invalid-trigger-target',
      severity: 'error',
      description:
        "A trigger's 'target' does not reference @workflows.<workflow> or @bundles.<bundle>.workflows.<workflow>.",
    },
    {
      code: 'invalid-node-bundle-reference',
      severity: 'error',
      description:
        "A subagent/start_agent 'bundles' entry does not reference @bundles.<name>.",
    },
    {
      code: 'invalid-orchestrator-agent',
      severity: 'error',
      description:
        "An orchestrator's 'agents' entry does not reference @subagent or @connected_subagent.",
    },
  ],
  'undefined-reference': [
    {
      code: 'undefined-reference',
      severity: 'error',
      description:
        'An @namespace.member reference could not be resolved (e.g., @variables.unknown, @actions.missing). Includes "did you mean?" suggestions.',
    },
  ],
  'type-map': [],
  'reasoning-actions': [
    {
      code: 'missing-action-reference',
      severity: 'error',
      description:
        'A reasoning action has no target reference (e.g. @actions.Name, @utils.transition, @utils.setVariables).',
    },
    {
      code: 'when-non-action-binding',
      severity: 'error',
      description:
        "A 'when' block appears on a reasoning action not bound to '@actions.<name>'.",
    },
  ],
  'connection-formats-index': [
    {
      code: 'response-format-reserved-name',
      severity: 'error',
      description:
        "A connection declares a 'response_formats:' entry using a reserved built-in name (e.g. 'json').",
    },
  ],
  'response-format-shape-index': [],
  'action-io': [
    {
      code: 'action-missing-input',
      severity: 'information',
      description:
        'An input marked `is_required: True` with no default value has no `with` clause. ' +
        'For @actions.X this is informational — the compiler auto-fills the slot into llm_inputs. ' +
        'For @connected_subagent.X it is reported as an error, since connected agents do not auto-fill.',
    },
    {
      code: 'action-unknown-input',
      severity: 'error',
      description:
        'A "with" clause references an input not defined on the action. Includes "did you mean?" suggestions.',
    },
    {
      code: 'action-unknown-output',
      severity: 'error',
      description:
        'A "set" clause references an output not defined on the action. Includes "did you mean?" suggestions.',
    },
  ],
  'variable-default-type-check': [
    {
      code: 'variable-default-type-mismatch',
      severity: 'warning',
      description:
        "A variable's default value literal does not match its declared type.",
    },
  ],
  'ask-for': [
    {
      code: 'collect-target-already-set',
      severity: 'warning',
      description:
        'An `ask for` target variable already holds a literal when it is reached, either from ' +
        'a literal default (e.g. `""`, `0`, `False`, `[]`) or a literal `set` earlier in the ' +
        'same procedure, so the user is never asked. ' +
        'Does not flag `= None`, no default, or linked variables.',
    },
    {
      code: 'collect-condition-contradicts',
      severity: 'warning',
      description:
        'An `ask for` sits inside an `if` whose condition can never be true while the target is None, ' +
        'which is the only time an `ask for` fires, so the user is never asked.',
    },
  ],
  'action-type-check': [
    {
      code: 'type-mismatch',
      severity: 'error',
      description:
        'Type incompatibility between a value and its target parameter (e.g., passing string to number input).',
    },
  ],
  'available-when-type-check': [
    {
      code: 'available-when-non-boolean',
      severity: 'warning',
      description:
        "An 'available when' condition does not resolve to a boolean expression or reference.",
    },
  ],
  'set-variables-io': [
    {
      code: 'set-variables-unknown-variable',
      severity: 'error',
      description:
        'A \'with\' clause param in @utils.setVariables does not reference a defined variable. Includes "did you mean?" suggestions.',
    },
    {
      code: 'set-variables-immutable-target',
      severity: 'error',
      description:
        "A 'with' clause param in @utils.setVariables targets a variable that is not mutable.",
    },
  ],
  'set-variables-chaining': [
    {
      code: 'set-variables-chained-action',
      severity: 'error',
      description:
        "A 'run' or 'transition to' clause (including one nested in an 'if') is chained onto @utils.setVariables; it is ignored at runtime.",
    },
  ],
  'render-rules': [
    {
      code: 'render-outside-when',
      severity: 'error',
      description:
        "A 'render:' clause appears outside a 'when @connection.<surface>' block.",
    },
    {
      code: 'show-and-return-outside-render',
      severity: 'error',
      description:
        "A 'show_and_return:' clause appears outside a 'render:' body.",
    },
    {
      code: 'when-non-connection-ref',
      severity: 'error',
      description: "A 'when' block's reference is not '@connection.<surface>'.",
    },
    {
      code: 'render-rule-duplicate-connection',
      severity: 'error',
      description:
        "Two 'when @connection.X' blocks under the same action target the same connection.",
    },
    {
      code: 'render-rule-multiple-render',
      severity: 'error',
      description:
        "A 'when @connection.X' block has more than one 'render:' clause.",
    },
    {
      code: 'render-rule-empty-when',
      severity: 'error',
      description: "A 'when @connection.X' block has no 'render:' clause.",
    },
    {
      code: 'render-rule-invalid-format-ref',
      severity: 'error',
      description:
        "A 'render:' value is not '@response_formats.<name>' or '@connection.<surface>.response_formats.<name>'.",
    },
    {
      code: 'render-rule-format-connection-mismatch',
      severity: 'error',
      description:
        "A longform format reference in 'render:' names a different connection than the enclosing 'when @connection.X:'.",
    },
    {
      code: 'render-rule-format-not-in-connection',
      severity: 'error',
      description:
        "A format reference in 'render:' names a response_format that is neither a reserved built-in ('json') nor declared in the enclosing connection's 'response_formats:' sub-map.",
    },
    {
      code: 'render-rule-multiple-show-and-return',
      severity: 'error',
      description:
        "A 'render:' body has more than one 'show_and_return:' clause.",
    },
    {
      code: 'render-rule-show-and-return-not-bool',
      severity: 'error',
      description: "A 'show_and_return:' value is not a boolean literal.",
    },
    {
      code: 'render-rule-unsupported-statement',
      severity: 'error',
      description:
        "A 'render:' body contains a statement other than 'with' bindings and 'show_and_return:'.",
    },
    {
      code: 'render-rule-unsupported-when-statement',
      severity: 'error',
      description:
        "A 'when @connection' body contains a statement other than 'render:'.",
    },
  ],
  'render-with-bindings': [
    {
      code: 'render-with-unknown-input',
      severity: 'error',
      description:
        "A render 'with' binding names an input the response_format does not declare.",
    },
    {
      code: 'render-with-missing-required-input',
      severity: 'error',
      description:
        "A required response_format input (no default) has no render 'with' binding.",
    },
    {
      code: 'render-with-required-none',
      severity: 'error',
      description:
        "A render 'with' binding sets a required input or field to None; only optional inputs may be None.",
    },
    {
      code: 'render-with-type-mismatch',
      severity: 'warning',
      description:
        "A render 'with' binding's value type does not match the declared input type.",
    },
    {
      code: 'render-with-constraint-violation',
      severity: 'warning',
      description:
        "A render 'with' binding's value violates an input constraint (enum, minimum/maximum, length, or item count).",
    },
    {
      code: 'render-with-nested-unknown-field',
      severity: 'error',
      description:
        "A render 'with' binding's nested object value sets a field the input does not declare.",
    },
    {
      code: 'render-with-ellipsis',
      severity: 'error',
      description:
        "A render 'with' binding leaves a value as `...`; every field must be bound explicitly.",
    },
    {
      code: 'render-with-nested-missing-required-field',
      severity: 'error',
      description:
        "A render 'with' binding's nested object value omits a required field of the input.",
    },
    {
      code: 'render-with-duplicate-input',
      severity: 'warning',
      description:
        "A render 'with' clause binds the same input more than once.",
    },
    {
      code: 'render-with-primitive-no-fields',
      severity: 'error',
      description:
        "A render 'with' binding targets a built-in primitive format (e.g. `json`), which returns the raw output and has no fields to map.",
    },
    {
      code: 'render-with-unknown-connection-input',
      severity: 'error',
      description:
        "A render 'with' binding's `@inputs.Y` value names an input the active connection does not declare.",
    },
    {
      code: 'render-with-input-connection-mismatch',
      severity: 'error',
      description:
        "A render 'with' binding's `@connection.X.inputs.Y` value names a connection other than the active one.",
    },
  ],
  'render-rule-scope': [
    {
      code: 'render-outside-when',
      severity: 'error',
      description:
        "A 'render:' statement appears outside a reasoning action body.",
    },
    {
      code: 'show-and-return-outside-render',
      severity: 'error',
      description:
        "A 'show_and_return:' statement appears outside a reasoning action body.",
    },
    {
      code: 'when-connection-outside-action',
      severity: 'error',
      description:
        "A 'when @connection.<surface>' statement appears outside a reasoning action body.",
    },
  ],
  'instruction-template-syntax': [
    {
      code: 'instruction-template-syntax',
      severity: 'information',
      description:
        'Instruction text uses incorrect template syntax (e.g. a missing `!` or a bare @variables/@actions reference outside {! ... }).',
    },
  ],
  'invalid-action-target': [
    {
      code: 'invalid-action-target',
      severity: 'error',
      description:
        'An action target URI is malformed or uses an unsupported scheme (e.g., not one of flow://, apex://, standardInvocableAction://).',
    },
    {
      code: 'placeholder-action-target',
      severity: 'warning',
      description:
        'An action target uses the placeholder:// scheme and should be replaced with a real implementation before committing.',
    },
  ],
  'invalid-skill-target': [
    {
      code: 'invalid-skill-shape',
      severity: 'error',
      description:
        "A skill does not define exactly one of 'instructions' (inline) or 'target' (stored), or an inline skill is missing 'description'.",
    },
    {
      code: 'invalid-skill-target',
      severity: 'error',
      description:
        "A stored skill's 'target' is malformed or does not use the skill:// scheme.",
    },
  ],
  'hyperclassifier-topics': [],
  'hyperclassifier-constraints': [
    {
      code: 'hyperclassifier-non-transition',
      severity: 'error',
      description:
        'A hyperclassifier/router topic defines a reasoning action other than @utils.transition.',
    },
    {
      code: 'hyperclassifier-before-reasoning',
      severity: 'error',
      description:
        "A hyperclassifier/router topic defines 'before_reasoning', which is not allowed for that model.",
    },
    {
      code: 'hyperclassifier-after-reasoning',
      severity: 'error',
      description:
        "A hyperclassifier/router topic defines 'after_reasoning', which is not allowed for that model.",
    },
  ],
  'connection-validation': [
    {
      code: 'connection-disallowed-field',
      severity: 'error',
      description:
        'A connection declares a field not supported by its connection type (e.g. a non-adaptive_response_allowed field on a slack connection).',
    },
    {
      code: 'connection-field-not-used',
      severity: 'warning',
      description:
        "A connection declares a field its connection type does not use (e.g. 'inputs' on messaging/customer_web_client).",
    },
    {
      code: 'connection-missing-required-fields',
      severity: 'error',
      description:
        'A connection declares none of its configuration fields (e.g. description).',
    },
    {
      code: 'connection-missing-paired-field',
      severity: 'error',
      description:
        "A connection declares only one of the paired 'outbound_route_name'/'outbound_route_type' fields.",
    },
    {
      code: 'connection-input-invalid-type',
      severity: 'error',
      description:
        'A connection input declares a type other than string, number, or boolean (or omits the type).',
    },
    {
      code: 'connection-input-invalid-property',
      severity: 'error',
      description: 'A connection input declares an unsupported property.',
    },
    {
      code: 'response-action-invalid-reference',
      severity: 'error',
      description:
        "A 'reasoning.response_actions' entry does not reference a response format using '@response_formats.format_name' syntax.",
    },
    {
      code: 'missing-required-field',
      severity: 'error',
      description: "A response_format is missing its required 'inputs' field.",
    },
    {
      code: 'response-format-inputs-ignored-for-target',
      severity: 'warning',
      description:
        "A response_format declares 'inputs' for a target that ignores an input schema.",
    },
    {
      code: 'response-format-invalid-target',
      severity: 'error',
      description:
        "A response_format's target is not in the 'type://Name' format.",
    },
    {
      code: 'response-format-unsupported-target-scheme',
      severity: 'error',
      description:
        "A response_format's target uses an invocation type not in the supported response-format target schemes.",
    },
    {
      code: 'response-format-unknown-system-target',
      severity: 'warning',
      description:
        "A response_format's 'system://' target does not name one of the known system target names.",
    },
    {
      code: 'response-format-schema-input-not-exclusive',
      severity: 'error',
      description:
        "A response_format input declaring a 'schema' field is mixed with other inputs; it must be the only input.",
    },
    {
      code: 'response-format-object-missing-fields',
      severity: 'warning',
      description:
        "An object-typed response_format input declares no 'fields:' block, so it has no shape.",
    },
    {
      code: 'response-format-fields-on-non-object',
      severity: 'error',
      description:
        "A response_format input declares a 'fields:' block but is not an object or list[object].",
    },
    {
      code: 'response-format-list-missing-value',
      severity: 'error',
      description:
        "A 'type: list' response_format input does not declare a 'value:' parameter.",
    },
    {
      code: 'response-format-messaging-component-missing-default',
      severity: 'error',
      description:
        'A messaging-component parameter does not declare a default value.',
    },
    {
      code: 'response-format-list-default-non-primitive',
      severity: 'error',
      description:
        'A list default value on a response_format input contains non-literal elements.',
    },
    {
      code: 'response-format-invalid-schema-uri',
      severity: 'error',
      description:
        "A response_format input's 'schema' URI is not in the 'type://target' format.",
    },
    {
      code: 'response-format-unsupported-schema-type',
      severity: 'error',
      description:
        "A response_format input's 'schema' URI uses an unsupported schema type (only messaging_component is supported).",
    },
    {
      code: 'response-format-messaging-component-wrong-surface',
      severity: 'error',
      description:
        'A messaging_component schema is used on a connection type other than messaging.',
    },
    {
      code: 'response-format-nested-schema',
      severity: 'error',
      description:
        'A messaging_component schema is used on a nested field; it is only valid on top-level input fields.',
    },
  ],
  'system-message-variables': [
    {
      code: 'system-message-mutable-variable',
      severity: 'error',
      description:
        'A system welcome/error message template references a variable that is not linked (or externally visible).',
    },
  ],
  'system-instructions': [
    {
      code: 'unsupported-system-instruction-statement',
      severity: 'error',
      description:
        'A system instruction procedure contains a statement other than instruction text or an if/else conditional.',
    },
  ],
  'connected-agent/bound-inputs': [
    {
      code: 'bound-input-required',
      severity: 'error',
      description:
        'A connected agent input has no default value binding it to a variable or literal.',
    },
    {
      code: 'bound-input-not-variable',
      severity: 'error',
      description:
        "A connected agent input's default value is not a simple @variables.X reference, a literal, or a list of literals.",
    },
    {
      code: 'bound-input-not-linked-or-mutable',
      severity: 'error',
      description:
        'A connected agent input is bound to a variable that is neither linked nor mutable.',
    },
  ],
  'connected-agent-target': [
    {
      code: 'connected-agent-unsupported-scheme',
      severity: 'error',
      description:
        'Connected agent target uses an unsupported URI scheme (only agent:// and agentforce:// are currently supported).',
    },
  ],
  'template-reference-validation': [
    {
      code: 'invalid-connected-subagent-reference',
      severity: 'error',
      description:
        'An instruction template references a connected subagent that is not defined, or references it in an unsupported way.',
    },
  ],
  'config-validation': [
    {
      code: 'config-missing-agent-name',
      severity: 'error',
      description: "The 'config' block is missing a required 'name' field.",
    },
    {
      code: 'config-duplicate-agent-name',
      severity: 'error',
      description: 'Multiple agents declare the same name.',
    },
    {
      code: 'config-default-agent-user-conflict',
      severity: 'warning',
      description:
        "A 'default_agent_user' is set but conflicts with other access configuration.",
    },
    {
      code: 'agent-type-not-allowed',
      severity: 'error',
      description:
        "The declared 'agent_type' is not one of the allowed agent types.",
    },
    {
      code: 'config-invalid-default-agent-user-none',
      severity: 'error',
      description:
        "'default_agent_user' is set to 'none' for an agent type that requires a default user.",
    },
    {
      code: 'recommended-prompts-agent-type',
      severity: 'error',
      description:
        "'recommended_prompts' is declared on an agent type that does not support it.",
    },
    {
      code: 'access-sharing-policy-not-allowed',
      severity: 'error',
      description:
        "An 'access' sharing policy is declared that is not allowed for the agent's type.",
    },
    {
      code: 'access-verified-customer-record-access-not-allowed',
      severity: 'error',
      description:
        "'verified_customer_record_access' is declared but not allowed for the agent's type.",
    },
    {
      code: 'config-missing-default-agent-user',
      severity: 'error',
      description:
        "The agent type requires a 'default_agent_user' but none is declared.",
    },
    {
      code: 'runtime-user-skills-agent-type',
      severity: 'error',
      description:
        "'runtime.user_skills' is declared on an agent type that does not support it.",
    },
    {
      code: 'billing-agent-type',
      severity: 'error',
      description:
        "A 'billing' block is declared on an agent type that does not support it.",
    },
  ],
  'variable-validation': [
    {
      code: 'invalid-variable-name',
      severity: 'error',
      description: 'A variable name does not meet naming requirements.',
    },
    {
      code: 'mutable-variable-cannot-have-source',
      severity: 'error',
      description:
        "A 'mutable' variable also declares a 'source', which is not allowed.",
    },
    {
      code: 'linked-variable-missing-source',
      severity: 'error',
      description: "A 'linked' variable does not declare a 'source'.",
    },
    {
      code: 'linked-variable-cannot-be-list',
      severity: 'error',
      description: "A 'linked' variable's type cannot be a list.",
    },
    {
      code: 'linked-variable-cannot-be-object',
      severity: 'error',
      description: "A 'linked' variable's type cannot be an object.",
    },
    {
      code: 'linked-variable-cannot-have-default',
      severity: 'error',
      description: "A 'linked' variable cannot declare a default value.",
    },
  ],
  'complex-data-type-warning': [
    {
      code: 'complex-data-type-on-primitive',
      severity: 'warning',
      description:
        'A complex data type (list/object) is used where a primitive type was expected.',
    },
    {
      code: 'object-type-missing-schema',
      severity: 'warning',
      description: "An object-typed field does not declare a 'schema'.",
    },
  ],
  'custom-subagent-validation': [
    {
      code: 'custom-subagent-validation',
      severity: 'error',
      description:
        'A custom subagent declaration is invalid (missing or malformed required fields).',
    },
    {
      code: 'byon-not-for-production',
      severity: 'warning',
      description:
        'A BYON (bring-your-own-network) subagent is used, which is not recommended for production.',
    },
  ],
  'adaptive-language-validation': [
    {
      code: 'adaptive-language-overrides',
      severity: 'warning',
      description:
        'Adaptive language settings override other language configuration in a way that may be unintended.',
    },
    {
      code: 'voice-adaptive-conflict',
      severity: 'warning',
      description:
        'Adaptive language settings conflict with voice modality configuration.',
    },
  ],
  'governed-additional-parameters': [
    {
      code: 'disabled-additional-parameter',
      severity: 'error',
      description:
        'A forbidden additional_parameter__ field is declared (e.g. disable_graph_runtime); it has no runtime replacement and is not permitted.',
    },
    {
      code: 'deprecated-additional-parameter',
      severity: 'warning',
      description:
        'A deprecated additional_parameter__ field is declared; use the corresponding config.runtime.* field instead.',
    },
  ],
  'voice-language-validation': [
    {
      code: 'voice-language-missing-language-block',
      severity: 'warning',
      description:
        'A voice modality declares a language but the corresponding language block is missing.',
    },
    {
      code: 'voice-language-not-declared',
      severity: 'error',
      description:
        'A voice modality references a language that is not declared.',
    },
    {
      code: 'voice-language-settings-not-declared',
      severity: 'error',
      description:
        'Voice language settings reference a language that is not declared.',
    },
  ],
  'voice-version-mixing': [
    {
      code: 'voice-version-mixing',
      severity: 'error',
      description:
        'A voice modality mixes fields from different voice config versions, which is not allowed.',
    },
  ],
  'empty-block-agentforce': [
    {
      code: 'empty-block',
      severity: 'error',
      description:
        "A top-level block (system, variables, model_config, knowledge, connection, modality, access, context) or a 'modality' entry has no authored content.",
    },
  ],
  'recommended-prompts-validation': [
    {
      code: 'recommended-prompts-welcome-screen',
      severity: 'error',
      description:
        "'starter_prompts' is declared but 'welcome_screen' is not True.",
    },
    {
      code: 'recommended-prompts-min-entries',
      severity: 'error',
      description: "'starter_prompts' has fewer than the minimum 3 entries.",
    },
    {
      code: 'recommended-prompts-max-entries',
      severity: 'error',
      description: "'starter_prompts' has more than the maximum 20 entries.",
    },
    {
      code: 'recommended-prompts-length',
      severity: 'error',
      description: 'A starter prompt is not between 1 and 50 characters.',
    },
    {
      code: 'recommended-prompts-type',
      severity: 'error',
      description: 'A starter prompt entry is not a text value.',
    },
  ],
  'function-argument-type-check': [
    {
      code: 'function-argument-type',
      severity: 'warning',
      description:
        'A built-in function call (e.g. len, max, json_path) is passed an argument whose type does not match the expected parameter type.',
    },
  ],
  'gba-only-blocks': [
    {
      code: 'gba-only-bundles',
      severity: 'error',
      description:
        "A 'bundles' block is used but the agent_type is not GoalBasedAgent.",
    },
    {
      code: 'gba-only-workflows',
      severity: 'error',
      description:
        "A 'workflows' block is used but the agent_type is not GoalBasedAgent.",
    },
    {
      code: 'gba-only-trigger',
      severity: 'error',
      description:
        "A 'trigger' block is used but the agent_type is not GoalBasedAgent.",
    },
    {
      code: 'gba-only-actions',
      severity: 'error',
      description:
        "An 'actions' block is used but the agent_type is not GoalBasedAgent.",
    },
    {
      code: 'gba-only-orchestrator',
      severity: 'error',
      description:
        "An 'orchestrator' block is used but the agent_type is not GoalBasedAgent.",
    },
    {
      code: 'gba-only-context-salesforce',
      severity: 'error',
      description:
        "'context.salesforce' is used but the agent_type is not GoalBasedAgent.",
    },
    {
      code: 'gba-only-context-data_cloud',
      severity: 'error',
      description:
        "'context.data_cloud' is used but the agent_type is not GoalBasedAgent.",
    },
    {
      code: 'gba-only-context-search',
      severity: 'error',
      description:
        "'context.search' is used but the agent_type is not GoalBasedAgent.",
    },
    {
      code: 'gba-forbidden-subagent',
      severity: 'error',
      description:
        "A 'subagent' block is not allowed in a GoalBasedAgent script; use 'orchestrator' as the entry point.",
    },
    {
      code: 'gba-forbidden-start_agent',
      severity: 'error',
      description:
        "A 'start_agent' block is not allowed in a GoalBasedAgent script; use 'orchestrator' as the entry point.",
    },
  ],
  // Pure transformation pass: marks render: targets as pre-validated for the
  // undefined-reference pass and emits no diagnostics of its own.
  'render-target-exemption': [],
};

function buildLintRules(): SerializedLintRule[] {
  const rules = agentforceRules();
  return rules.map(pass => ({
    id: pass.id,
    description: pass.description,
    diagnosticCodes: DIAGNOSTIC_CODES[pass.id] ?? [],
  }));
}

function serializeGlobalMembers(
  members: ReadonlyMap<string, GlobalScopeMember>
): Record<string, SerializedGlobalScopeMember> {
  const result: Record<string, SerializedGlobalScopeMember> = {};
  for (const [name, member] of members) {
    const serialized: SerializedGlobalScopeMember = {};
    if (member.type !== undefined) serialized.type = member.type;
    if (member.capability !== undefined)
      serialized.capability = member.capability;
    if (member.subMembers !== undefined) {
      serialized.subMembers = serializeGlobalMembers(member.subMembers);
    }
    result[name] = serialized;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build a serialized representation of the Agentforce dialect schema.
 *
 * Returns a JSON-serializable object containing root blocks, global scopes,
 * lint rules, and action target URI schemes.
 */
export function buildSerializedSchema(): SerializedSchema {
  const dialect = 'agentforce';
  const schemaInfo = AgentforceSchemaInfo;
  const schema = AgentforceSchema;

  const rootBlocks: Record<string, SerializedField> = {};
  for (const [key, field] of Object.entries(
    schema as Record<string, unknown>
  )) {
    rootBlocks[key] = serializeField(field as Record<string, unknown>);
  }

  // Serialize from the normalized SchemaContext so every member carries its
  // typed declaration (type/capability/subMembers) to arbitrary depth.
  const globalScopes: Record<string, SerializedGlobalScope> = {};
  for (const [name, members] of getGlobalScopes(agentforceSchemaContext)) {
    globalScopes[name] = { members: serializeGlobalMembers(members) };
  }

  return {
    dialect,
    rootBlocks,
    aliases: { ...schemaInfo.aliases },
    globalScopes,
    lintRules: buildLintRules(),
    actionTargetSchemes: [...VALID_SCHEMES],
    agentTypes: [...ALLOWED_AGENT_TYPES],
    connectedAgentSchemes: [...CONNECTED_AGENT_SCHEMES],
    responseFormatTargetSchemes: [...RESPONSE_FORMAT_TARGET_SCHEMES],
    connectionInputTypes: [...ALLOWED_CONNECTION_INPUT_TYPES],
  };
}
