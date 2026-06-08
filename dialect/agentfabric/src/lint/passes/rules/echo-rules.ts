/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { isNamedMap } from '@agentscript/language';
import { normalizeId } from '../../utils.js';
import { attachError, hasOwnNonNull, type AstLike } from './shared.js';

export function checkEchoRules(root: Record<string, unknown>): void {
  const echos = root.echo;
  if (!isNamedMap(echos)) return;

  for (const [name, entry] of echos) {
    if (entry == null || typeof entry !== 'object') continue;
    const echoEntry = entry as Record<string, unknown>;
    const normalizedName = normalizeId(name);
    const hasTask = hasOwnNonNull(echoEntry, 'task');
    const hasMessage = hasOwnNonNull(echoEntry, 'message');

    if (!hasTask && !hasMessage) {
      attachError(
        echoEntry as AstLike,
        `echo '${normalizedName}' must define either 'task' or 'message'.`,
        'echo-task-or-message-required'
      );
    }
  }
}
