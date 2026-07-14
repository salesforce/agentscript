/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { CompilerContext } from '../compiler-context.js';
import type { ParsedAccess } from '../parsed-types.js';
import type { SecurityConfiguration } from '../types.js';
import {
  type Expression,
  type SequenceNode,
  MemberExpression,
  Identifier,
} from '@agentscript/language';
import {
  extractBooleanValue,
  extractStringValue,
  getCstRange,
} from '../ast-helpers.js';

/**
 * Compile access block from AST to AgentJSON format.
 * Currently only verified_customer_record_access is supported in the output schema.
 * sharing_policy and default_agent_user are parsed here too — default_agent_user
 * is read by compileAgentConfiguration; sharing_policy is not yet emitted.
 */
export function compileAccess(
  accessBlock: ParsedAccess | undefined,
  ctx: CompilerContext
): SecurityConfiguration | undefined {
  if (!accessBlock) return undefined;

  const result: SecurityConfiguration = {};

  if (accessBlock.verified_customer_record_access) {
    const vcra = accessBlock.verified_customer_record_access;
    const useDefault = extractBooleanValue(vcra.use_default_objects);

    if (useDefault === undefined) {
      ctx.error(
        'verified_customer_record_access requires use_default_objects to be set to True or False',
        getCstRange(vcra)
      );
    } else {
      result.verified_customer_record_access = {
        use_default_objects: useDefault,
      };

      if (vcra.additional_objects) {
        const additionalObjects = extractObjectList(
          vcra.additional_objects,
          ctx
        );
        if (additionalObjects && additionalObjects.length > 0) {
          result.verified_customer_record_access.additional_objects =
            additionalObjects;
        }
      }
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Extract a list of object references from a sequence node.
 * Handles both string literals and member expressions (e.g., CustomOrder.ShopperId).
 */
function extractObjectList(
  sequence: SequenceNode,
  ctx: CompilerContext
): string[] | undefined {
  if (!sequence || sequence.__kind !== 'Sequence') return undefined;

  const items: string[] = [];

  for (const item of sequence.items) {
    if (item.__kind === 'StringLiteral') {
      const value = extractStringValue(item);
      if (value) {
        items.push(value);
      } else {
        ctx.error('Empty string in access object list', item.__cst?.range);
      }
    } else if (item instanceof MemberExpression) {
      const serialized = serializeMemberExpression(item);
      if (serialized) {
        items.push(serialized);
      } else {
        ctx.error(
          'Failed to resolve member expression in access object list',
          item.__cst?.range
        );
      }
    } else {
      ctx.error(
        `Unsupported expression type in access object list: ${item.__kind}`,
        item.__cst?.range
      );
    }
  }

  return items.length > 0 ? items : undefined;
}

/**
 * Serialize a MemberExpression to dotted notation (e.g., "Account.ContactId")
 */
function serializeMemberExpression(expr: Expression): string | undefined {
  if (expr instanceof MemberExpression) {
    const objectPart = serializeMemberExpression(expr.object);
    if (objectPart) {
      return `${objectPart}.${expr.property}`;
    }
    if (expr.object instanceof Identifier) {
      return `${expr.object.name}.${expr.property}`;
    }
    return undefined;
  }

  if (expr instanceof Identifier) {
    return expr.name;
  }

  return undefined;
}
