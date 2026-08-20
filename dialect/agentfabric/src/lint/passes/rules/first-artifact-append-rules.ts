/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { isNamedMap } from '@agentscript/language';
import { extractGraph } from '../../../graph/extractor.js';
import { AgentFabricSchemaInfo } from '../../../schema.js';
import { Namespace } from '../../../constants.js';
import { attachError, extractStringValue, type AstLike } from './shared.js';

const ARTIFACT_KIND = 'a2a:artifact_update_event';
const DIAGNOSTIC_CODE = 'echo-first-artifact-append';

/**
 * Expression kinds whose source text is a stable identifier for the artifact
 * (e.g. `@variables.aid`, a bare identifier, a subscript). Two echos citing
 * the same reference target the same artifact.
 */
const REFERENCE_KINDS = new Set([
  'MemberExpression',
  'Identifier',
  'SubscriptExpression',
]);

/**
 * The resolved identity of an artifact echo's `artifactId`:
 *  - `resolved`: keyed by a static string literal (`lit:<value>`) or a
 *    reference's source text (`ref:<text>`); two echos with the same `key`
 *    emit the same artifact. `label` is the human-readable form.
 *  - `dynamic`: the id is a generated / computed value (e.g. `uuid()`), an
 *    unsupported expression, or absent. A fresh id per run means there is
 *    never an existing artifact to append to.
 */
type Identity =
  | { kind: 'resolved'; key: string; label: string }
  | { kind: 'dynamic' };

function isObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object';
}

/** Whether an echo's `append` field resolves to boolean `true`. */
function appendIsTrue(entry: Record<string, unknown>): boolean {
  const append = entry.append;
  if (typeof append === 'boolean') return append;
  if (isObject(append)) return append.value === true;
  return false;
}

/**
 * Extract the DictLiteral argument from an `a2a.artifact({...})` call.
 */
function extractArtifactDictLiteral(
  entry: Record<string, unknown>
): Record<string, unknown> | null {
  const artifact = entry.artifact;
  if (!isObject(artifact) || artifact.__kind !== 'CallExpression') {
    return null;
  }
  const args = artifact.args;
  if (!Array.isArray(args)) return null;

  const dict = args.find(
    (arg): arg is Record<string, unknown> =>
      isObject(arg) && arg.__kind === 'DictLiteral'
  );
  if (!dict || !Array.isArray(dict.entries)) return null;
  return dict;
}

/**
 * Find the `artifactId` value node within a DictLiteral's entries.
 */
function findArtifactIdValue(
  dict: Record<string, unknown>
): Record<string, unknown> | null {
  if (!Array.isArray(dict.entries)) return null;

  for (const kv of dict.entries) {
    if (!isObject(kv)) continue;
    const key = kv.key;
    if (!isObject(key) || key.__kind !== 'Identifier') continue;
    if (key.name !== 'artifactId') continue;

    const value = kv.value;
    if (!isObject(value)) return null;
    return value;
  }
  return null;
}

/**
 * Classify an `artifactId` value node into an Identity. String literals and
 * reference expressions (member, identifier, subscript) are resolvable;
 * everything else (computed values, function calls) is dynamic.
 */
function classifyArtifactIdValue(value: Record<string, unknown>): Identity {
  if (value.__kind === 'StringLiteral' && typeof value.value === 'string') {
    return {
      kind: 'resolved',
      key: `lit:${value.value}`,
      label: `"${value.value}"`,
    };
  }
  if (typeof value.__kind === 'string' && REFERENCE_KINDS.has(value.__kind)) {
    const text = (value as { __cst?: { node?: { text?: string } } }).__cst?.node
      ?.text;
    if (typeof text === 'string' && text.length > 0) {
      return { kind: 'resolved', key: `ref:${text}`, label: text };
    }
  }
  return { kind: 'dynamic' };
}

/**
 * Resolve the `artifactId` of an `a2a.artifact({...})` expression into a
 * comparable identity. Reads the `DictLiteral` argument and inspects the
 * `artifactId` entry's value node.
 */
function resolveArtifactIdentity(entry: Record<string, unknown>): Identity {
  const dict = extractArtifactDictLiteral(entry);
  if (!dict) return { kind: 'dynamic' };

  const value = findArtifactIdValue(dict);
  if (!value) return { kind: 'dynamic' };

  return classifyArtifactIdValue(value);
}

/**
 * Breadth-first forward reachability from `seeds`, skipping any node in
 * `removed` (both as a seed and as a traversal target). Used to test whether
 * an echo can be reached without first passing through a same-artifact emit.
 */
function reachableFrom(
  seeds: string[],
  adjacency: Map<string, string[]>,
  removed: Set<string>
): Set<string> {
  const visited = new Set<string>();
  const queue: string[] = [];
  for (const seed of seeds) {
    if (removed.has(seed) || visited.has(seed)) continue;
    visited.add(seed);
    queue.push(seed);
  }
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of adjacency.get(current) ?? []) {
      if (removed.has(next) || visited.has(next)) continue;
      visited.add(next);
      queue.push(next);
    }
  }
  return visited;
}

/**
 * Prefer squiggling the `append` field itself (precise range); fall back to
 * the echo block instance when the field node can't carry diagnostics.
 */
function attachTarget(entry: Record<string, unknown>): AstLike {
  const append = entry.append;
  if (isObject(append) && Array.isArray(append.__diagnostics)) {
    return append as AstLike;
  }
  return entry as AstLike;
}

function resolvedMessage(name: string, label: string): string {
  return (
    `echo '${name}' sets append:True but is the first artifact_update_event ` +
    `for artifact ${label} on at least one execution path — there is no ` +
    `existing artifact to append to. Set append:False for the first emit.`
  );
}

function dynamicMessage(name: string): string {
  return (
    `echo '${name}' sets append:True but its artifactId is not statically ` +
    `resolvable (e.g. a generated or computed value), so append:True cannot ` +
    `be guaranteed to target an existing artifact. Set append:False for the ` +
    `first emit, or use a stable artifactId (a string literal or a variable ` +
    `reference).`
  );
}

/**
 * Build an adjacency-list representation of the agent graph for reachability
 * queries. Returns the adjacency map and the list of trigger node ids.
 */
function buildGraphAdjacency(root: Record<string, unknown>): {
  adjacency: Map<string, string[]>;
  triggerIds: string[];
} {
  const { nodes, edges } = extractGraph(root, AgentFabricSchemaInfo);
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) adjacency.set(node.id, []);
  for (const edge of edges) {
    if (!adjacency.has(edge.from)) continue;
    adjacency.get(edge.from)!.push(edge.to);
  }

  const triggerIds = nodes
    .filter(node => node.namespace === Namespace.Trigger)
    .map(node => node.id);

  return { adjacency, triggerIds };
}

/**
 * Resolve every artifact echo's identity and build indexes:
 *  - `identityByNodeId`: maps node id → Identity
 *  - `nodesByIdentity`: maps resolved identity key → set of node ids
 */
function buildIdentityIndexes(echos: Iterable<[string, unknown]>): {
  identityByNodeId: Map<string, Identity>;
  nodesByIdentity: Map<string, Set<string>>;
} {
  const identityByNodeId = new Map<string, Identity>();
  const nodesByIdentity = new Map<string, Set<string>>();

  for (const [name, entry] of echos) {
    if (!isObject(entry)) continue;
    if (extractStringValue(entry.kind) !== ARTIFACT_KIND) continue;
    const nodeId = `echo.${name}`;
    const identity = resolveArtifactIdentity(entry);
    identityByNodeId.set(nodeId, identity);
    if (identity.kind === 'resolved') {
      let set = nodesByIdentity.get(identity.key);
      if (!set) {
        set = new Set();
        nodesByIdentity.set(identity.key, set);
      }
      set.add(nodeId);
    }
  }

  return { identityByNodeId, nodesByIdentity };
}

/**
 * Context for checking echo append rules, passed to avoid parameter clutter.
 */
interface EchoCheckContext {
  reachable: Set<string>;
  adjacency: Map<string, string[]>;
  triggerIds: string[];
  identityByNodeId: Map<string, Identity>;
  nodesByIdentity: Map<string, Set<string>>;
}

/**
 * Check whether an echo with `append:True` violates the first-artifact rule.
 * If so, attach a diagnostic to the echo. For dynamic identities, always emit;
 * for resolved identities, emit only when the echo is reachable without first
 * passing through another echo emitting the same artifact.
 */
function checkEchoAppendRule(
  name: string,
  entry: Record<string, unknown>,
  nodeId: string,
  ctx: EchoCheckContext
): void {
  if (!ctx.reachable.has(nodeId)) return; // orphan — skip

  const identity = ctx.identityByNodeId.get(nodeId) ?? { kind: 'dynamic' };

  if (identity.kind === 'dynamic') {
    attachError(attachTarget(entry), dynamicMessage(name), DIAGNOSTIC_CODE);
    return;
  }

  // Remove every OTHER echo emitting the same artifact, then test whether
  // this echo is still reachable from a trigger. If so, some path reaches it
  // with no prior same-artifact emit — the append targets nothing.
  const blockers = new Set(ctx.nodesByIdentity.get(identity.key));
  blockers.delete(nodeId);
  const withoutBlockers = reachableFrom(
    ctx.triggerIds,
    ctx.adjacency,
    blockers
  );
  if (withoutBlockers.has(nodeId)) {
    attachError(
      attachTarget(entry),
      resolvedMessage(name, identity.label),
      DIAGNOSTIC_CODE
    );
  }
}

/**
 * The first `a2a:artifact_update_event` echo on any execution path has no
 * existing artifact to append to, so `append:True` there is an error.
 *
 * Artifacts are keyed by their `artifactId`:
 *  - A statically-resolvable id (string literal or variable reference) is an
 *    error when the echo is reachable from a trigger WITHOUT first passing
 *    through another echo emitting the same id (strict, all-paths). This
 *    naturally flags the first iteration of a self-loop.
 *  - A dynamic / absent id (e.g. `uuid()`) generates a fresh artifact every
 *    run, so `append:True` never targets an existing artifact — always an
 *    error when reachable.
 *
 * Echos unreachable from any trigger are dead code (surfaced by the
 * unused-node rule) and are skipped here regardless of id resolvability.
 */
export function checkFirstArtifactAppendRules(
  root: Record<string, unknown>
): void {
  const echos = root.echo;
  if (!isNamedMap(echos)) return;

  const { adjacency, triggerIds } = buildGraphAdjacency(root);
  if (adjacency.size === 0) return;

  const reachable = reachableFrom(triggerIds, adjacency, new Set());

  const { identityByNodeId, nodesByIdentity } = buildIdentityIndexes(echos);

  const ctx: EchoCheckContext = {
    reachable,
    adjacency,
    triggerIds,
    identityByNodeId,
    nodesByIdentity,
  };

  for (const [name, entry] of echos) {
    if (!isObject(entry)) continue;
    if (extractStringValue(entry.kind) !== ARTIFACT_KIND) continue;
    if (!appendIsTrue(entry)) continue;

    const nodeId = `echo.${name}`;
    checkEchoAppendRule(name, entry, nodeId, ctx);
  }
}
