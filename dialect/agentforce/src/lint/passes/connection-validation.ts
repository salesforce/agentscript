/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Per-connection-type field validation.
 *
 * Matches Python's CONNECTION_VALIDATORS pattern — imperative checks per type:
 *   - slack: only adaptive_response_allowed field is allowed; all other fields disallowed
 *   - service_email: no escalation_message; paired outbound_route_name/outbound_route_type
 *   - messaging: all-or-nothing for routing fields; warns if inputs are defined
 *   - customer_web_client: warns if inputs are defined
 *
 * Diagnostics: connection-disallowed-field, connection-missing-paired-field,
 *              connection-missing-required-fields, connection-field-not-used
 */

import type { AstRoot, AstNodeLike, NamedMap } from '@agentscript/language';
import type { LintPass, PassStore } from '@agentscript/language';
import {
  storeKey,
  isNamedMap,
  isAstNodeLike,
  attachDiagnostic,
  lintDiagnostic,
} from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import { ConnectionBlock } from '../../schema.js';
import { VALID_SCHEMES } from './action-target.js';

/** Known connection fields from the ConnectionBlock schema. */
const CONNECTION_FIELDS = Object.keys(ConnectionBlock.schema).filter(
  key => !key.startsWith('__')
);

/**
 * Response format's target scheme shares some of Action's schemes {@link VALID_SCHEMES}
 */
const INVOCATION_TARGET_BASE_SCHEMES = [
  'apex',
  'flow',
  'standardInvocableAction',
  'prompt',
  'generatePromptResponse',
] satisfies readonly (typeof VALID_SCHEMES)[number][];

/** Response-format-only schemes:
 * - 'system': an invocation target that is defined in the consuming planner
 */
const RESPONSE_FORMAT_ONLY_TARGET_SCHEMES = ['system'] as const;

/** Allowed invocation target schemes for response formats (as authored). */
const RESPONSE_FORMAT_TARGET_SCHEMES: readonly string[] = [
  ...INVOCATION_TARGET_BASE_SCHEMES,
  ...RESPONSE_FORMAT_ONLY_TARGET_SCHEMES,
];

/**
 * Known `system://` response format targets defined by the consuming planner.
 * A `system://` target whose name isn't one of these likely won't resolve, so
 * we surface a non-blocking warning.
 */
const KNOWN_SYSTEM_TARGET_NAMES: readonly string[] = [
  'MessagingRichLink',
  'MessagingChoices',
  'MessagingChoicesWithImages',
  'MessagingTimePicker',
  'ESTypeMessage',
];

/**
 * formats/targets that do not require an `inputs` block:
 *
 * - `ESTypeMessage`: accepts a dynamic schema native to the agent response;
 *   it can't be expressed as a static structured schema.
 */
const SYSTEM_TARGETS_WITHOUT_INPUTS: ReadonlySet<string> = new Set([
  'ESTypeMessage',
]);

/** Allowed types for connection inputs (linting restriction) */
const ALLOWED_CONNECTION_INPUT_TYPES = ['string', 'number', 'boolean'];

/** Allowed properties for connection inputs (linting restriction) */
const ALLOWED_CONNECTION_INPUT_PROPERTIES = ['description'];

function hasField(node: AstNodeLike, field: string): boolean {
  return node[field] != null;
}

function hasAnyField(node: AstNodeLike): boolean {
  return CONNECTION_FIELDS.some(f => hasField(node, f));
}

function fieldError(
  node: AstNodeLike,
  connectionType: string,
  fieldName: string
): void {
  const cst = node.__cst;
  if (!cst) return;

  attachDiagnostic(
    node,
    lintDiagnostic(
      cst.range,
      `${connectionType} connections do not support ${fieldName}`,
      DiagnosticSeverity.Error,
      'connection-disallowed-field'
    )
  );
}

function fieldNotUsedWarning(
  node: AstNodeLike,
  connectionType: string,
  fieldName: string
): void {
  const field = node[fieldName];
  if (!isAstNodeLike(field)) return;

  const fieldCst = field.__cst;
  if (!fieldCst) return;

  attachDiagnostic(
    node,
    lintDiagnostic(
      fieldCst.range,
      `${connectionType} connections do not use ${fieldName}`,
      DiagnosticSeverity.Warning,
      'connection-field-not-used'
    )
  );
}

function missingFieldsError(node: AstNodeLike, connectionType: string): void {
  const cst = node.__cst;
  if (!cst) return;

  attachDiagnostic(
    node,
    lintDiagnostic(
      cst.range,
      `${connectionType} connections require configuration fields ` +
        `(e.g. escalation_message, outbound_route_type, outbound_route_name).`,
      DiagnosticSeverity.Error,
      'connection-missing-required-fields'
    )
  );
}

function validateSlack(node: AstNodeLike): void {
  // Slack connections only allow adaptive_response_allowed - all other fields disallowed
  for (const field of CONNECTION_FIELDS) {
    if (field === 'adaptive_response_allowed') continue;
    if (hasField(node, field)) {
      fieldError(node, 'Slack', field);
    }
  }
}

function validateServiceEmail(node: AstNodeLike): void {
  if (!hasAnyField(node)) {
    missingFieldsError(node, 'service_email');
    return;
  }
  if (hasField(node, 'escalation_message')) {
    fieldError(node, 'Service email', 'escalation_message');
  }
  const hasRouteName = hasField(node, 'outbound_route_name');
  const hasRouteType = hasField(node, 'outbound_route_type');
  if (hasRouteName !== hasRouteType) {
    const missing = hasRouteName
      ? 'outbound_route_type'
      : 'outbound_route_name';
    const cst = node.__cst;
    if (cst) {
      attachDiagnostic(
        node,
        lintDiagnostic(
          cst.range,
          `Service email connections require both outbound_route_name and outbound_route_type, but ${missing} is missing`,
          DiagnosticSeverity.Error,
          'connection-missing-paired-field'
        )
      );
    }
  }
}

function validateMessaging(node: AstNodeLike): void {
  if (!hasAnyField(node)) {
    missingFieldsError(node, 'messaging');
    return;
  }
  const hasRouteName = hasField(node, 'outbound_route_name');
  const hasRouteType = hasField(node, 'outbound_route_type');
  if (hasRouteName !== hasRouteType) {
    const missing = hasRouteName
      ? 'outbound_route_type'
      : 'outbound_route_name';
    const cst = node.__cst;
    if (cst) {
      attachDiagnostic(
        node,
        lintDiagnostic(
          cst.range,
          `Messaging connections require both outbound_route_name and outbound_route_type, but ${missing} is missing`,
          DiagnosticSeverity.Error,
          'connection-missing-paired-field'
        )
      );
    }
  }

  // Warn if inputs field is defined - messaging connections don't use inputs
  if (hasField(node, 'inputs')) {
    fieldNotUsedWarning(node, 'Messaging', 'inputs');
  }
}

function validateCustomerWebClient(node: AstNodeLike): void {
  if (!hasAnyField(node)) {
    missingFieldsError(node, 'customer_web_client');
    return;
  }
  // Warn if inputs field is defined - customer_web_client connections don't use inputs
  if (hasField(node, 'inputs')) {
    fieldNotUsedWarning(node, 'Customer Web Client', 'inputs');
  }
}

function validateUnknown(node: AstNodeLike, name: string): void {
  if (!hasAnyField(node)) {
    missingFieldsError(node, name);
  }
}

/**
 * Validate connection inputs - enforce restrictions:
 * - Only string, number, boolean types allowed
 */
function validateConnectionInputs(node: AstNodeLike): void {
  const inputs = node.inputs;
  if (!isNamedMap(inputs)) return;

  for (const [inputName, inputDecl] of inputs) {
    if (!isAstNodeLike(inputDecl)) continue;
    const input = inputDecl;

    // Check type - extract from type expression
    const typeExpr = input.type as AstNodeLike | undefined;
    if (!typeExpr) {
      const cst = input.__cst;
      if (cst) {
        const allowedTypes = ALLOWED_CONNECTION_INPUT_TYPES.join(', ');
        attachDiagnostic(
          input,
          lintDiagnostic(
            cst.range,
            `Connection inputs require type definition. Supported types: ${allowedTypes}.`,
            DiagnosticSeverity.Error,
            'connection-input-invalid-type'
          )
        );
      }
    } else {
      let typeName: string | undefined;

      // Handle simple Identifier (e.g., `string`)
      if (typeExpr.__kind === 'Identifier') {
        typeName = (typeExpr as { name?: string }).name;
      }
      // Handle SubscriptExpression (e.g., `list[string]`)
      else if (typeExpr.__kind === 'SubscriptExpression') {
        const cst = input.__cst;
        if (cst) {
          const allowedTypes = ALLOWED_CONNECTION_INPUT_TYPES.join(', ');
          attachDiagnostic(
            input,
            lintDiagnostic(
              cst.range,
              `Connection inputs do not support list types. Supported types: ${allowedTypes}.`,
              DiagnosticSeverity.Error,
              'connection-input-invalid-type'
            )
          );
        }
        continue;
      }

      if (typeName && !ALLOWED_CONNECTION_INPUT_TYPES.includes(typeName)) {
        const cst = input.__cst;
        if (cst) {
          const allowedTypes = ALLOWED_CONNECTION_INPUT_TYPES.join(', ');
          attachDiagnostic(
            input,
            lintDiagnostic(
              cst.range,
              `Connection input '${inputName}' has invalid type '${typeName}'. Supported types: ${allowedTypes}.`,
              DiagnosticSeverity.Error,
              'connection-input-invalid-type'
            )
          );
        }
      }
    }

    // Check properties - only allowed properties
    const properties = input.properties as AstNodeLike | undefined;
    if (properties && typeof properties === 'object') {
      for (const propName of Object.keys(properties)) {
        if (!ALLOWED_CONNECTION_INPUT_PROPERTIES.includes(propName)) {
          const propValue = properties[propName];
          if (!isAstNodeLike(propValue)) continue;
          const cst = propValue.__cst;
          if (cst) {
            const allowedProps = ALLOWED_CONNECTION_INPUT_PROPERTIES.join(', ');
            attachDiagnostic(
              input,
              lintDiagnostic(
                cst.range,
                `Connection input '${inputName}' has unsupported property '${propName}'. Supported properties: ${allowedProps}.`,
                DiagnosticSeverity.Error,
                'connection-input-invalid-property'
              )
            );
          }
        }
      }
    }
  }
}

/**
 * Validate reasoning.response_actions references
 * - Each action must reference a response_format using @response_formats.format_name syntax
 */
function validateReasoningResponseActions(node: AstNodeLike): void {
  const reasoning = node.reasoning as AstNodeLike | undefined;
  if (!reasoning) return;

  const responseActions = reasoning.response_actions;
  if (!isNamedMap(responseActions)) return;

  for (const [
    actionName,
    actionValue,
  ] of responseActions as NamedMap<unknown>) {
    if (!isAstNodeLike(actionValue)) continue;

    const expr = actionValue.value as AstNodeLike | undefined;
    if (!expr) continue;

    const isResponseFormatRef =
      expr.__kind === 'MemberExpression' &&
      (expr.object as AstNodeLike | undefined)?.name === 'response_formats';

    if (!isResponseFormatRef) {
      const cst = actionValue.__cst;
      if (cst) {
        attachDiagnostic(
          actionValue,
          lintDiagnostic(
            cst.range,
            `Response action '${actionName}' must reference a response format using '@response_formats.format_name' syntax`,
            DiagnosticSeverity.Error,
            'response-action-invalid-reference'
          )
        );
      }
    }
  }
}

function targetSkipsInputs(format: AstNodeLike): boolean {
  const targetNode = format.target;
  if (!isAstNodeLike(targetNode)) return false;
  const value = targetNode.value as string | undefined;
  if (value === undefined) return false;
  const parts = value.split('://');
  return (
    parts[0] === 'system' &&
    parts[1] !== undefined &&
    SYSTEM_TARGETS_WITHOUT_INPUTS.has(parts[1])
  );
}

/**
 * Validate response_formats
 * - Requires `inputs` (except for {@link SYSTEM_TARGETS_WITHOUT_INPUTS})
 * - Validates target URI format
 * - Validates schema URIs on input declarations
 */
function validateResponseFormats(
  node: AstNodeLike,
  connectionType: string
): void {
  const responseFormats = node.response_formats;
  if (!isNamedMap(responseFormats)) return;

  for (const [formatName, formatDecl] of responseFormats) {
    if (!isAstNodeLike(formatDecl)) continue;
    const format = formatDecl;

    const hasTarget = format.target != null;

    const skipsInputs = targetSkipsInputs(format);
    if (format.inputs == null && !skipsInputs) {
      const cst = format.__cst;
      if (cst) {
        attachDiagnostic(
          format,
          lintDiagnostic(
            cst.range,
            `Missing required field 'inputs'`,
            DiagnosticSeverity.Error,
            'missing-required-field'
          )
        );
      }
    } else if (format.inputs != null && skipsInputs) {
      // Authored `inputs:` are ignored for certain targets. Warn so user is aware.
      const inputsNode = format.inputs;
      const cst = isAstNodeLike(inputsNode) ? inputsNode.__cst : format.__cst;
      const targetName =
        (isAstNodeLike(format.target)
          ? (format.target.value as string | undefined)
          : undefined) ?? '';
      if (cst) {
        attachDiagnostic(
          format,
          lintDiagnostic(
            cst.range,
            `Target '${targetName}' does not use input schema.`,
            DiagnosticSeverity.Warning,
            'response-format-inputs-ignored-for-target'
          )
        );
      }
    }

    // Validate target format: should be "type://Name"
    if (hasTarget && isAstNodeLike(format.target)) {
      const targetNode = format.target;
      const targetValue = targetNode.value as string | undefined;
      if (targetValue !== undefined) {
        const cst = targetNode.__cst;
        const parts = targetValue.split('://');
        if (parts.length !== 2 || !parts[0] || !parts[1]) {
          if (cst) {
            attachDiagnostic(
              format,
              lintDiagnostic(
                cst.range,
                `Response format '${formatName}' target must be in the format 'type://Name' (e.g., 'apex://MyApexClass')`,
                DiagnosticSeverity.Error,
                'response-format-invalid-target'
              )
            );
          }
        } else if (!RESPONSE_FORMAT_TARGET_SCHEMES.includes(parts[0])) {
          if (cst) {
            attachDiagnostic(
              format,
              lintDiagnostic(
                cst.range,
                `Response format '${formatName}' target has unsupported invocation type '${parts[0]}'. Supported types: ${RESPONSE_FORMAT_TARGET_SCHEMES.map(s => `${s}`).join(', ')}`,
                DiagnosticSeverity.Error,
                'response-format-unsupported-target-scheme'
              )
            );
          }
        } else if (
          parts[0] === 'system' &&
          !KNOWN_SYSTEM_TARGET_NAMES.includes(parts[1])
        ) {
          if (cst) {
            attachDiagnostic(
              format,
              lintDiagnostic(
                cst.range,
                `Response format '${formatName}' uses an unrecognized system target '${parts[1]}'. Known system targets: ${KNOWN_SYSTEM_TARGET_NAMES.join(', ')}.`,
                DiagnosticSeverity.Warning,
                'response-format-unknown-system-target'
              )
            );
          }
        }
      }
    }

    // Validate schema URIs on input declarations (recursive)
    if (isNamedMap(format.inputs)) {
      validateInputSchemaURIs(
        format.inputs as NamedMap<unknown>,
        format,
        connectionType
      );
    }
  }
}

/**
 * Validate `schema` URIs on response format input declarations.
 * The `messaging_component://` schema type is only allowed at the
 * top level of inputs (not on nested sub-fields).
 */
function validateInputSchemaURIs(
  inputs: NamedMap<unknown>,
  formatNode: AstNodeLike,
  connectionType: string
): void {
  const topLevelEntries: Array<[string, AstNodeLike]> = [];

  for (const [paramName, paramDecl] of inputs) {
    if (!isAstNodeLike(paramDecl)) continue;
    const decl = paramDecl;
    topLevelEntries.push([paramName, decl]);

    // List default values (e.g. `= [...]`) may only contain primitive literals
    // (this input and any nested parameter declarations). Checked before the
    // `props` guard below, since a bare `field = [...]` has no properties block.
    validateListDefaultValues(decl, paramName, formatNode);

    const props = decl.properties as AstNodeLike | undefined;

    // An object/list[object] declares its nested fields under `fields:`
    // - `fields:` on a non-object is meaningless
    // - an object without fields is valid syntax but flagged with "Are you sure this is what you want?"
    validateFieldsPlacement(paramName, decl, props, formatNode);

    // type: list requires a value: parameter
    validateListHasValue(paramName, decl, props, formatNode);

    if (!props) continue;

    // Validate schema on top-level input
    validateSchemaField(props, paramName, formatNode, true, connectionType);

    // Messaging component parameters must declare a default value (e.g. `field: type = @variables.x`).
    if (isMessagingComponentInput(props)) {
      validateMessagingComponentDefaults(props, formatNode);
    }

    // Recurse into the nested sub-fields under `fields:`
    validateNestedSchemaFields(props, formatNode, connectionType);
  }

  // An input block with a `schema` field must be the only input block in the format.
  validateSchemaInputIsExclusive(topLevelEntries, formatNode);
}

/**
 * When any top-level input declares a `schema` field (e.g. a messaging
 * component), it must be the sole input of the format — mixing it with other
 * input params is not supported (yet)
 */
function validateSchemaInputIsExclusive(
  entries: Array<[string, AstNodeLike]>,
  formatNode: AstNodeLike
): void {
  if (entries.length <= 1) return;

  for (const [paramName, decl] of entries) {
    const props = decl.properties as AstNodeLike | undefined;
    if (!props || props.schema == null) continue;

    const cst = decl.__cst;
    if (!cst) continue;

    attachDiagnostic(
      formatNode,
      lintDiagnostic(
        cst.range,
        `Input '${paramName}' declares a schema and must the only input in this response format.`,
        DiagnosticSeverity.Error,
        'response-format-schema-input-not-exclusive'
      )
    );
  }
}

/**
 * True when an input's `schema` field is a `messaging_component://<name>` URI.
 * Requires a non-empty path, matching how the compiler detects messaging
 * components (scheme `messaging_component` + a definition name).
 */
function isMessagingComponentInput(props: AstNodeLike): boolean {
  if (!isAstNodeLike(props.schema)) return false;
  const value = props.schema.value;
  if (typeof value !== 'string') return false;

  const parts = value.split('://');
  return parts[0] === 'messaging_component' && !!parts[1];
}

/**
 * Resolve the `fields` NamedMap from input properties, checking:
 * 1. props.type.properties.fields (for type: object)
 * 2. props.type.properties.value.properties.fields (for type: list > value: object)
 */
function resolveFieldsMap(props: AstNodeLike): NamedMap<unknown> | undefined {
  const propsRecord = props as Record<string, unknown>;

  const typeDesc = propsRecord.type as
    | { properties?: Record<string, unknown> }
    | undefined;
  if (typeDesc?.properties) {
    const fields = typeDesc.properties['fields'];
    if (isNamedMap(fields)) return fields as NamedMap<unknown>;

    // list > value: object > fields
    const valueDesc = typeDesc.properties['value'] as
      | { properties?: Record<string, unknown> }
      | undefined;
    if (valueDesc?.properties) {
      const nestedFields = valueDesc.properties['fields'];
      if (isNamedMap(nestedFields)) return nestedFields as NamedMap<unknown>;
    }
  }

  return undefined;
}

/**
 * Iterate the nested parameter declarations of a response-format input,
 * declared under its `fields:` block, as `[key, declaration]` pairs.
 */
function* iterateFieldDeclarations(
  props: AstNodeLike
): Iterable<[string, AstNodeLike]> {
  const fields = resolveFieldsMap(props);
  if (!fields) return;
  for (const [key, decl] of fields) {
    if (!isAstNodeLike(decl)) continue;
    if (decl.__kind !== 'ParameterDeclaration') continue;
    yield [key, decl];
  }
}

/**
 * Resolve the base type of a parameter declaration. For `list[X]` this is the
 * element type `X`; for a bare type it is the type name itself.
 */
function getBaseTypeName(decl: AstNodeLike): string | undefined {
  const type = decl.type as AstNodeLike | undefined;
  if (!type) return undefined;
  if (type.__kind === 'Identifier') return type.name as string;
  if (type.__kind === 'SubscriptExpression') {
    const index = type.index as AstNodeLike | undefined;
    if (index?.__kind === 'Identifier') return index.name as string;
    const object = type.object as AstNodeLike | undefined;
    if (object?.__kind === 'Identifier') return object.name as string;
  }
  return undefined;
}

/**
 * Validate a parameter's type structure placement.
 * `fields:` is only valid under `type: object` in the TypeDescriptor.
 * An object without fields (and without `schema:`) is valid but not useful → warning.
 */
function validateFieldsPlacement(
  paramName: string,
  decl: AstNodeLike,
  props: AstNodeLike | undefined,
  formatNode: AstNodeLike
): void {
  const acceptsFields = declAcceptsFields(decl, props);
  const cst = decl.__cst;
  if (!cst) return;

  // Check if fields exist via the TypeDescriptor path
  const fieldsMap = props ? resolveFieldsMap(props) : undefined;
  const hasFields = isNamedMap(fieldsMap) && fieldsMap.size > 0;

  if (acceptsFields) {
    // Messaging components describe their shape via `schema:` instead of `fields:`.
    if (props && isMessagingComponentInput(props)) return;
    if (!hasFields) {
      attachDiagnostic(
        formatNode,
        lintDiagnostic(
          cst.range,
          `Input '${paramName}' is an object but declares no 'fields:' block, so it has no shape.`,
          DiagnosticSeverity.Warning,
          'response-format-object-missing-fields'
        )
      );
    }
    return;
  }

  if (hasFields) {
    attachDiagnostic(
      formatNode,
      lintDiagnostic(
        cst.range,
        `Input '${paramName}' declares a 'fields:' block but is not an object or list[object].`,
        DiagnosticSeverity.Error,
        'response-format-fields-on-non-object'
      )
    );
  }
}

/**
 * True when a declaration's type can carry a `fields:` block: i.e. object and list of objects
 */
function declAcceptsFields(
  decl: AstNodeLike,
  props: AstNodeLike | undefined
): boolean {
  const base = getBaseTypeName(decl);
  if (base === 'object') return true;
  if (base !== 'list') return false;

  const propsRecord = props as Record<string, unknown> | undefined;
  const typeDesc = propsRecord?.type as
    | { properties?: Record<string, unknown> }
    | undefined;
  const value = typeDesc?.properties?.['value'];
  if (!isAstNodeLike(value)) return false;
  // `value:` is a TypeDescriptor, not a ParameterDeclaration — its type keyword
  // lives on `.typeName`. (`getBaseTypeName` reads `.type`, so it won't work here.)
  const typeName = value.typeName as AstNodeLike | undefined;
  if (typeName?.__kind === 'Identifier') {
    return (typeName.name as string) === 'object';
  }
  return false;
}

/**
 * Validate that a `type: list` declaration includes a `value:` parameter.
 * A list type without value is invalid — you must specify the element type.
 */
function validateListHasValue(
  paramName: string,
  decl: AstNodeLike,
  props: AstNodeLike | undefined,
  formatNode: AstNodeLike
): void {
  const typeName = getBaseTypeName(decl);
  if (typeName !== 'list') return;

  const propsRecord = props as Record<string, unknown> | undefined;
  const typeDesc = propsRecord?.type as
    | { properties?: Record<string, unknown> }
    | undefined;
  // Short-form list[X] has no type descriptor — element type is already inline
  if (!typeDesc?.properties) return;

  const hasValue = typeDesc.properties['value'] != null;
  if (hasValue) return;

  const cst = decl.__cst;
  if (!cst) return;

  attachDiagnostic(
    formatNode,
    lintDiagnostic(
      cst.range,
      `Input '${paramName}' is a list but does not declare a 'value:' parameter. Specify the element type (e.g., 'value: string' or 'value: object').`,
      DiagnosticSeverity.Error,
      'response-format-list-missing-value'
    )
  );
}

/**
 * Validate that every parameter of a messaging-component input declares a
 * default value. The default supplies the value passed to the component, so a
 * parameter without one (e.g. `field: date`) is an error.
 */
function validateMessagingComponentDefaults(
  props: AstNodeLike,
  formatNode: AstNodeLike
): void {
  for (const [key, decl] of iterateFieldDeclarations(props)) {
    if (decl.defaultValue != null) continue;

    const cst = decl.__cst;
    if (!cst) continue;

    attachDiagnostic(
      formatNode,
      lintDiagnostic(
        cst.range,
        `Messaging component parameter '${key}' must have a default value (e.g. '${key}: <type> = <value>').`,
        DiagnosticSeverity.Error,
        'response-format-messaging-component-missing-default'
      )
    );
  }
}

/** Expression kinds accepted as primitive literals inside a list default. */
const PRIMITIVE_LITERAL_KINDS = new Set([
  'StringLiteral',
  'NumberLiteral',
  'BooleanLiteral',
  'NoneLiteral',
]);

/** True when an expression is a primitive literal */
function isPrimitiveLiteral(expr: AstNodeLike): boolean {
  if (expr.__kind && PRIMITIVE_LITERAL_KINDS.has(expr.__kind)) return true;
  if (expr.__kind === 'UnaryExpression') {
    const operand = expr.operand as AstNodeLike | undefined;
    return !!operand && operand.__kind === 'NumberLiteral';
  }
  return false;
}

/**
 * Validate a parameter declaration's default value (and those of its nested
 * sub-fields): a list literal default (`= [...]`) may only contain primitive
 * literals. References such as `= [@variables.A, @variables.B]` are unsupported.
 */
function validateListDefaultValues(
  decl: AstNodeLike,
  paramName: string,
  formatNode: AstNodeLike
): void {
  const defaultValue = decl.defaultValue as AstNodeLike | undefined;
  if (defaultValue?.__kind === 'ListLiteral') {
    const elements = (defaultValue.elements as AstNodeLike[] | undefined) ?? [];
    const hasNonPrimitive = elements.some(el => !isPrimitiveLiteral(el));
    if (hasNonPrimitive) {
      const cst = defaultValue.__cst;
      if (cst) {
        attachDiagnostic(
          formatNode,
          lintDiagnostic(
            cst.range,
            `Input '${paramName}' has a list default value that contains non-literal elements. List defaults may only contain primitive literals (e.g. [1, 2, 3] or ["a", "b"]).`,
            DiagnosticSeverity.Error,
            'response-format-list-default-non-primitive'
          )
        );
      }
    }
  }

  // Recurse into nested parameter declarations (e.g. fields of a list[object]).
  const props = decl.properties as AstNodeLike | undefined;
  if (props) {
    for (const [key, nested] of iterateFieldDeclarations(props)) {
      validateListDefaultValues(nested, key, formatNode);
    }
  }
}

/**
 * Walk nested sub-field declarations to validate `fields:` placement and their
 * schema URIs with isTopLevel=false (messaging_component:// is only valid at
 * the top level).
 */
function validateNestedSchemaFields(
  props: AstNodeLike,
  formatNode: AstNodeLike,
  connectionType: string
): void {
  for (const [key, decl] of iterateFieldDeclarations(props)) {
    // ParameterDeclarationNode: the properties block is under .properties
    const nestedProps = decl.properties as AstNodeLike | undefined;

    validateFieldsPlacement(key, decl, nestedProps, formatNode);

    if (!nestedProps) continue;

    validateSchemaField(nestedProps, key, formatNode, false, connectionType);

    // Recurse deeper for further nesting
    validateNestedSchemaFields(nestedProps, formatNode, connectionType);
  }
}

// although we only support schema=messaging_component right now, we may expand in the future.
function validateSchemaField(
  props: AstNodeLike,
  paramName: string,
  formatNode: AstNodeLike,
  isTopLevel: boolean,
  connectionType: string
): void {
  if (!isAstNodeLike(props.schema)) return;
  const schemaValue = props.schema.value as string | undefined;
  if (schemaValue === undefined) return;

  const cst = props.schema.__cst;
  if (!cst) return;

  const parts = schemaValue.split('://');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    // Invalid structure — not in "type://target" format
    attachDiagnostic(
      formatNode,
      lintDiagnostic(
        cst.range,
        `Input '${paramName}' has invalid schema URI '${schemaValue}'. Expected format: 'type://target' (e.g., 'messaging_component://MyComponent')`,
        DiagnosticSeverity.Error,
        'response-format-invalid-schema-uri'
      )
    );
    return;
  }

  // Only messaging_component is currently supported
  if (parts[0] !== 'messaging_component') {
    attachDiagnostic(
      formatNode,
      lintDiagnostic(
        cst.range,
        `Input '${paramName}' has unsupported schema type '${parts[0]}'. Only 'messaging_component' is currently supported.`,
        DiagnosticSeverity.Error,
        'response-format-unsupported-schema-type'
      )
    );
    return;
  }

  // messaging_component schemas are only valid on the messaging connection surface
  if (connectionType !== 'messaging') {
    attachDiagnostic(
      formatNode,
      lintDiagnostic(
        cst.range,
        `Messaging components can only be used in a messaging connection.`,
        DiagnosticSeverity.Error,
        'response-format-messaging-component-wrong-surface'
      )
    );
    return;
  }

  // messaging_component schema is only valid at the top level of inputs
  if (!isTopLevel) {
    attachDiagnostic(
      formatNode,
      lintDiagnostic(
        cst.range,
        `Input '${paramName}' cannot use '${parts[0]}' schema on a nested field. '${parts[0]}://' is only valid on top-level input fields.`,
        DiagnosticSeverity.Error,
        'response-format-nested-schema'
      )
    );
  }
}

const CONNECTION_VALIDATORS: Record<string, (node: AstNodeLike) => void> = {
  slack: validateSlack,
  service_email: validateServiceEmail,
  messaging: validateMessaging,
  customer_web_client: validateCustomerWebClient,
};

class ConnectionValidationPass implements LintPass {
  readonly id = storeKey('connection-validation');
  readonly description = 'Validates per-connection-type field constraints';
  readonly requires = [];

  run(_store: PassStore, root: AstRoot): void {
    const connections = root.connection;
    if (!isNamedMap(connections)) return;

    for (const [name, block] of connections) {
      if (!isAstNodeLike(block)) continue;
      const key = name.toLowerCase();

      // Validate connection-type-specific fields
      const validator = CONNECTION_VALIDATORS[key];
      if (validator) {
        validator(block);
      } else {
        validateUnknown(block, name);
      }

      // Validate connection inputs (applies to all connection types)
      validateConnectionInputs(block);

      // Validate response_formats (applies to all connection types)
      validateResponseFormats(block, key);

      // Validate reasoning.response_actions (applies to all connection types)
      validateReasoningResponseActions(block);
    }
  }
}

export function connectionValidationRule(): LintPass {
  return new ConnectionValidationPass();
}
