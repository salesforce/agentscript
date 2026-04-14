import { isNamedMap } from '@agentscript/language';
import { normalizeId } from '../../../compiler/utils.js';
import type { PassStore } from '@agentscript/language';
import {
  asObjectList,
  attachError,
  collectStatementKinds,
  extractSwitchTarget,
  extractWhenString,
  type AstLike,
} from './shared.js';

function reportDeprecatedSwitchChoices(
  switchEntry: Record<string, unknown>,
  normalizedName: string
): void {
  if (switchEntry.choices !== undefined) {
    attachError(
      switchEntry as AstLike,
      `router '${normalizedName}' uses deprecated 'choices'. Use 'routes' and required 'otherwise' instead.`,
      'switch-choices-deprecated'
    );
  }
}

function validateSwitchOnExit(switchEntry: Record<string, unknown>): void {
  const onExit = switchEntry.on_exit;
  if (onExit !== undefined && collectStatementKinds(onExit).length > 0) {
    attachError(
      switchEntry as AstLike,
      'router nodes must not define on_exit transitions.',
      'switch-on-exit'
    );
  }
}

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

    reportDeprecatedSwitchChoices(switchEntry, normalizedName);
    validateSwitchOnExit(switchEntry);
    validateSwitchRoutes(switchEntry, normalizedName);
    validateSwitchElse(switchEntry, normalizedName);
  }
}
