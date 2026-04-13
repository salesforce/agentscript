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
 *   - slack: no outbound_route_name, outbound_route_type, escalation_message;
 *           only slack supports the `empty` keyword (block with zero fields)
 *   - service_email: no escalation_message; paired outbound_route_name/outbound_route_type
 *   - messaging: all-or-nothing for routing fields
 *
 * Diagnostics: connection-disallowed-field, connection-missing-paired-field,
 *              connection-empty-not-supported
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

/** Known connection fields from the ConnectionBlock schema. */
const CONNECTION_FIELDS = [
  'adaptive_response_allowed',
  'escalation_message',
  'instructions',
  'outbound_route_type',
  'outbound_route_name',
  'response_actions',
];

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
  if (hasField(node, 'outbound_route_name')) {
    fieldError(node, 'Slack', 'outbound_route_name');
  }
  if (hasField(node, 'outbound_route_type')) {
    fieldError(node, 'Slack', 'outbound_route_type');
  }
  if (hasField(node, 'escalation_message')) {
    fieldError(node, 'Slack', 'escalation_message');
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
}

function validateUnknown(node: AstNodeLike, name: string): void {
  if (!hasAnyField(node)) {
    missingFieldsError(node, name);
  }
}

const CONNECTION_VALIDATORS: Record<string, (node: AstNodeLike) => void> = {
  slack: validateSlack,
  service_email: validateServiceEmail,
  messaging: validateMessaging,
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
      const validator = CONNECTION_VALIDATORS[key];
      if (validator) {
        validator(node);
      } else {
        validateUnknown(node, name);
      }
    }
  }
}

export function connectionValidationRule(): LintPass {
  return new ConnectionValidationPass();
}
