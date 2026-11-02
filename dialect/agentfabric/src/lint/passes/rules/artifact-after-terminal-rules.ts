/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { isNamedMap } from '@agentscript/language';
import { A2A_TERMINAL_STATES } from '../../../schema.js';
import { Namespace } from '../../../constants.js';
import { attachWarning, extractStringValue, type AstLike } from './shared.js';
import {
  buildGraphAdjacency,
  reachableFrom,
} from '../../../graph/reachability.js';

const ARTIFACT_KIND = 'a2a:artifact_update_event';
const STATUS_KIND = 'a2a:status_update_event';
const DIAGNOSTIC_CODE = 'artifact-after-terminal-status';

/**
 * Artifact updates that run after a terminal A2A status echo are not
 * included in the A2A response — the task is already closed. Warn when
 * an `a2a:artifact_update_event` echo is reachable from a terminal
 * `a2a:status_update_event` echo on a live execution path.
 *
 * Cleanup nodes after a terminal status echo are still allowed; only
 * artifact echoes are flagged.
 */
export function checkArtifactAfterTerminalRules(
  root: Record<string, unknown>
): void {
  const echos = root.echo;
  if (!isNamedMap(echos)) return;

  const { terminalStatusIds, artifactIds, echoEntries } = classifyEchos(echos);
  if (terminalStatusIds.size === 0 || artifactIds.size === 0) return;

  const { adjacency, triggerIds } = buildGraphAdjacency(root);
  if (adjacency.size === 0) return;

  const live = reachableFrom(triggerIds, adjacency);
  const warned = new Set<string>();

  for (const terminalId of terminalStatusIds) {
    if (!live.has(terminalId)) continue;

    const afterTerminal = reachableFrom([terminalId], adjacency);
    for (const artifactId of artifactIds) {
      if (warned.has(artifactId)) continue;
      if (!afterTerminal.has(artifactId)) continue;
      if (!live.has(artifactId)) continue;

      const entry = echoEntries.get(artifactId);
      if (!entry) continue;

      warned.add(artifactId);
      attachWarning(
        entry,
        artifactAfterTerminalMessage(
          shortName(artifactId),
          shortName(terminalId)
        ),
        DIAGNOSTIC_CODE
      );
    }
  }
}

function artifactAfterTerminalMessage(
  artifactName: string,
  terminalName: string
): string {
  return (
    `echo '${artifactName}' emits an artifact update after terminal status ` +
    `echo '${terminalName}'. Artifacts must be sent before the task reaches ` +
    `a terminal state, or they will not be included in the A2A response.`
  );
}

function shortName(nodeId: string): string {
  return nodeId.split('.').pop() ?? nodeId;
}

function classifyEchos(echos: Iterable<[string, unknown]>): {
  terminalStatusIds: Set<string>;
  artifactIds: Set<string>;
  echoEntries: Map<string, AstLike>;
} {
  const terminalStatusIds = new Set<string>();
  const artifactIds = new Set<string>();
  const echoEntries = new Map<string, AstLike>();

  for (const [name, entry] of echos) {
    if (entry == null || typeof entry !== 'object') continue;
    const echoEntry = entry as Record<string, unknown>;
    const nodeId = `${Namespace.Echo}.${name}`;
    echoEntries.set(nodeId, echoEntry as AstLike);

    const kind = extractStringValue(echoEntry.kind);
    if (kind === ARTIFACT_KIND) {
      artifactIds.add(nodeId);
    } else if (kind === STATUS_KIND) {
      const state = extractStringValue(echoEntry.state);
      if (state !== undefined && A2A_TERMINAL_STATES.has(state)) {
        terminalStatusIds.add(nodeId);
      }
    }
  }

  return { terminalStatusIds, artifactIds, echoEntries };
}
