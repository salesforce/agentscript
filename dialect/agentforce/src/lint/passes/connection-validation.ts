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
  attachDiagnostic,
  lintDiagnostic,
} from '@agentscript/language';
import type { CstMeta } from '@agentscript/types';
import { DiagnosticSeverity } from '@agentscript/types';
import { ConnectionBlock } from '../../schema.js';

/** Known connection fields from the ConnectionBlock schema. */
const CONNECTION_FIELDS = Object.keys(ConnectionBlock.schema).filter(
  key => !key.startsWith('__')
);

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
  const cst = (node as Record<string, unknown>).__cst as CstMeta | undefined;
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
  const field = (node as Record<string, unknown>)[fieldName];
  if (!field || typeof field !== 'object') return;

  const fieldCst = (field as Record<string, unknown>).__cst as
    | CstMeta
    | undefined;
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
  const cst = (node as Record<string, unknown>).__cst as CstMeta | undefined;
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
    const cst = (node as Record<string, unknown>).__cst as CstMeta | undefined;
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
    const cst = (node as Record<string, unknown>).__cst as CstMeta | undefined;
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
  if (!inputs || !isNamedMap(inputs)) return;

  for (const [inputName, inputDecl] of inputs as NamedMap<unknown>) {
    if (!inputDecl || typeof inputDecl !== 'object') continue;
    const input = inputDecl as AstNodeLike;

    // Check type - extract from type expression
    const typeExpr = input.type as AstNodeLike | undefined;
    if (!typeExpr) {
      const cst = (input as Record<string, unknown>).__cst as
        | CstMeta
        | undefined;
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
        const cst = (input as Record<string, unknown>).__cst as
          | CstMeta
          | undefined;
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
        const cst = (input as Record<string, unknown>).__cst as
          | CstMeta
          | undefined;
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
          const cst = (propValue as { __cst?: CstMeta })?.__cst;
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
 * Validate response_formats
 * - must have either source OR inputs/target, but not both
 */
function validateResponseFormats(node: AstNodeLike): void {
  const responseFormats = node.response_formats;
  if (!responseFormats || !isNamedMap(responseFormats)) return;

  for (const [formatName, formatDecl] of responseFormats as NamedMap<unknown>) {
    if (!formatDecl || typeof formatDecl !== 'object') continue;
    const format = formatDecl as AstNodeLike;

    const hasInputs = format.inputs != null;
    const hasTarget = format.target != null;
    const hasSource = format.source != null;

    // Validate target format: should be "type://Name"
    if (hasTarget) {
      const targetNode = format.target as { value?: string; __cst?: CstMeta };
      const targetValue = targetNode?.value;
      if (targetValue !== undefined) {
        const parts = targetValue.split('://');
        if (parts.length !== 2 || !parts[0] || !parts[1]) {
          const cst = targetNode?.__cst;
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
        }
      }
    }

    // Must have source OR (inputs/target), but not both
    if (hasSource && (hasInputs || hasTarget)) {
      const conflictingField = hasInputs ? 'inputs' : 'target';
      const cst = (format[conflictingField] as { __cst?: CstMeta })?.__cst;
      if (cst) {
        attachDiagnostic(
          format,
          lintDiagnostic(
            cst.range,
            `Response format '${formatName}' cannot specify both 'source' and '${conflictingField}'. Use 'source' to reference an existing format, or 'inputs'/'target' to define a custom format.`,
            DiagnosticSeverity.Error,
            'response-format-conflicting-fields'
          )
        );
      }
    }

    // Must have at least one: source OR (inputs/target)
    if (!hasInputs && !hasTarget && !hasSource) {
      const cst = (format as Record<string, unknown>).__cst as
        | CstMeta
        | undefined;
      if (cst) {
        attachDiagnostic(
          format,
          lintDiagnostic(
            cst.range,
            `Response format '${formatName}' must specify either 'source' (to reference an existing format schema) or 'inputs'/'target' (to define a custom format schema)`,
            DiagnosticSeverity.Error,
            'response-format-missing-required-field'
          )
        );
      }
    }

    // Validate schema URIs on input declarations (recursive)
    if (hasInputs && isNamedMap(format.inputs)) {
      validateInputSchemaURIs(format.inputs as NamedMap<unknown>, format);
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
  formatNode: AstNodeLike
): void {
  for (const [paramName, paramDecl] of inputs) {
    if (!paramDecl || typeof paramDecl !== 'object') continue;
    const decl = paramDecl as AstNodeLike;
    const props = decl.properties as AstNodeLike | undefined;
    if (!props) continue;

    // Validate schema on top-level input
    validateSchemaField(props, paramName, formatNode, true);

    // Recurse into wildcard-matched nested sub-fields
    validateNestedSchemaFields(props, formatNode);
  }
}

/**
 * Walk wildcard-matched sub-fields and validate their schema URIs with isTopLevel=false.
 *
 * __children contains both property assignments and subfield declarations:
 * - Property assignments (e.g., `label: "text"`): value is StringLiteral, BooleanValue, etc.
 * - Subfield declarations (e.g., `title: string`): value is ParameterDeclarationNode
 *
 * We filter to only process ParameterDeclarationNodes (subfield declarations).
 */
function validateNestedSchemaFields(
  props: AstNodeLike,
  formatNode: AstNodeLike
): void {
  const children = (props as Record<string, unknown>).__children as
    | Array<{ __type: string; key: string; value: unknown }>
    | undefined;
  if (!Array.isArray(children)) return;

  for (const child of children) {
    if (child.__type !== 'field') continue;

    const decl = child.value;
    if (!decl || typeof decl !== 'object') continue;

    // Filter to only subfield declarations (not property assignments)
    const declNode = decl as AstNodeLike;
    if (declNode.__kind !== 'ParameterDeclaration') continue;

    // ParameterDeclarationNode: the properties block is under .properties
    const nestedProps = (decl as AstNodeLike).properties as
      | AstNodeLike
      | undefined;
    if (!nestedProps) continue;

    validateSchemaField(nestedProps, child.key, formatNode, false);

    // Recurse deeper for further nesting
    validateNestedSchemaFields(nestedProps, formatNode);
  }
}

// although we only support schema=messaging_component right now, we may expand in the future.
function validateSchemaField(
  props: AstNodeLike,
  paramName: string,
  formatNode: AstNodeLike,
  isTopLevel: boolean
): void {
  const schemaNode = props.schema as
    | { value?: string; __cst?: CstMeta }
    | undefined;
  if (schemaNode?.value === undefined) return;

  const cst = schemaNode.__cst;
  if (!cst) return;

  const parts = schemaNode.value.split('://');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    // Invalid structure — not in "type://target" format
    attachDiagnostic(
      formatNode,
      lintDiagnostic(
        cst.range,
        `Input '${paramName}' has invalid schema URI '${schemaNode.value}'. Expected format: 'type://target' (e.g., 'messaging_component://MyComponent')`,
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
    const rootObj = root as AstNodeLike;
    const connections = rootObj.connection;
    if (!connections || !isNamedMap(connections)) return;

    for (const [name, block] of connections as NamedMap<unknown>) {
      if (!block || typeof block !== 'object') continue;
      const node = block as AstNodeLike;
      const key = name.toLowerCase();

      // Validate connection-type-specific fields
      const validator = CONNECTION_VALIDATORS[key];
      if (validator) {
        validator(node);
      } else {
        validateUnknown(node, name);
      }

      // Validate connection inputs (applies to all connection types)
      validateConnectionInputs(node);

      // Validate response_formats (applies to all connection types)
      validateResponseFormats(node);
    }
  }
}

export function connectionValidationRule(): LintPass {
  return new ConnectionValidationPass();
}
