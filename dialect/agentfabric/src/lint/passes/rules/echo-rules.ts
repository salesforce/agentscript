/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { isNamedMap } from '@agentscript/language';
import { normalizeId } from '../../../utils.js';
import { A2A_TASK_STATES, A2A_TERMINAL_STATES } from '../../../schema.js';
import { attachError, extractStringValue, type AstLike } from './shared.js';

const VALID_STATES = new Set<string>(A2A_TASK_STATES);

export { A2A_TERMINAL_STATES as TERMINAL_STATES };

export function checkEchoRules(root: Record<string, unknown>): void {
  const echos = root.echo;
  if (!isNamedMap(echos)) return;

  for (const [name, entry] of echos) {
    if (entry == null || typeof entry !== 'object') continue;
    const echoEntry = entry as Record<string, unknown>;
    const normalizedName = normalizeId(name);
    const kind = extractStringValue(echoEntry.kind);

    if (kind === 'a2a:status_update_event') {
      validateStatusUpdateEvent(echoEntry, normalizedName);
    } else if (kind === 'a2a:artifact_update_event') {
      validateArtifactUpdateEvent(echoEntry, normalizedName);
    }
  }
}

function validateStatusUpdateEvent(
  entry: Record<string, unknown>,
  name: string
): void {
  const state = extractStringValue(entry.state);
  if (state !== undefined && !VALID_STATES.has(state)) {
    attachError(
      entry as AstLike,
      `echo '${name}' has invalid state '${state}'. Valid states: ${[...VALID_STATES].join(', ')}.`,
      'echo-invalid-state'
    );
  }
}

function validateArtifactUpdateEvent(
  entry: Record<string, unknown>,
  _name: string
): void {
  // artifact is marked as required in the schema, so missing-field
  // validation is handled by the schema layer. No additional custom
  // rules needed here at this time.
  void _name;
  void entry;
}
