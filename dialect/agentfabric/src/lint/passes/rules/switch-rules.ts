/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { isNamedMap } from '@agentscript/language';
import { normalizeId } from '../../../utils.js';
import type { PassStore } from '@agentscript/language';
import {
  asObjectList,
  attachError,
  extractSwitchTarget,
  extractWhenString,
  hasBooleanLiteralComparison,
  isBooleanLikeExpression,
  type AstLike,
} from './shared.js';

function validateSwitchRoutes(
  switchEntry: Record<string, unknown>,
  normalizedName: string
): void {
  const routes = asObjectList(switchEntry.routes);
  if (routes.length === 0) {
    attachError(
      switchEntry as AstLike,
      `router '${normalizedName}' must define at least one route under 'routes'.`,
      'switch-routes-required'
    );
    return;
  }
  for (const r of routes) {
    if (!extractSwitchTarget(r.target)) {
      attachError(
        switchEntry as AstLike,
        `router '${normalizedName}' has a route with invalid target. Use @<node_type>.<node_name>.`,
        'switch-route-target'
      );
    }
    if (!extractWhenString(r.when)) {
      attachError(
        switchEntry as AstLike,
        `router '${normalizedName}' has a route missing non-empty 'when'.`,
        'switch-route-when'
      );
    } else if (!isBooleanLikeExpression(r.when)) {
      attachError(
        r.when as AstLike,
        `router '${normalizedName}' route 'when' must be a boolean expression (comparison or logical operator).`,
        'switch-route-when-not-boolean'
      );
    } else if (hasBooleanLiteralComparison(r.when)) {
      attachError(
        r.when as AstLike,
        `router '${normalizedName}' route 'when' compares against a boolean literal, which does not evaluate correctly at runtime. Compare against a string value instead (e.g. '== "true"' or '== "false"').`,
        'switch-route-when-boolean-literal'
      );
    }
  }
}

function validateSwitchElse(
  switchEntry: Record<string, unknown>,
  normalizedName: string
): void {
  const otherwiseEntry = switchEntry.otherwise;
  if (!otherwiseEntry || typeof otherwiseEntry !== 'object') {
    attachError(
      switchEntry as AstLike,
      `router '${normalizedName}' must define required 'otherwise.target'.`,
      'switch-else-required'
    );
    return;
  }
  if (
    !extractSwitchTarget((otherwiseEntry as Record<string, unknown>).target)
  ) {
    attachError(
      switchEntry as AstLike,
      `router '${normalizedName}' has invalid otherwise.target. Use @<node_type>.<node_name>.`,
      'switch-else-target'
    );
  }
}

export function checkSwitchRules(
  _store: PassStore,
  root: Record<string, unknown>
): void {
  const switches = root.router;
  if (!isNamedMap(switches)) return;

  for (const [name, entry] of switches) {
    if (entry == null || typeof entry !== 'object') continue;
    const switchEntry = entry as Record<string, unknown>;
    const normalizedName = normalizeId(name);

    validateSwitchRoutes(switchEntry, normalizedName);
    validateSwitchElse(switchEntry, normalizedName);
  }
}
