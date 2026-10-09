/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { DelegationResult } from './types.js';

/**
 * Registry of every delegation the runtime has spawned during a session. The reference agent
 * keeps a flat handle table on the Session so UIs can inspect, list, and
 * expand any child agent by a stable id — the alternative (identifying a
 * child by `(parentNode, childNode, depth)`) breaks the moment two sibling
 * delegations pick the same child node.
 *
 * The registry is session-scoped, not turn-scoped: expansion of a completed
 * child's transcript from a previous turn is a valid use case.
 */
export interface AgentHandle {
  /** Stable id assigned when the delegation starts. `agent-1`, `agent-2`, … */
  agentId: string;
  /** Parent handle's id, or undefined for a top-level (parent-node) delegation. */
  parentAgentId?: string;
  /** Node the parent was on when it delegated. */
  parentNode: string;
  /** Child node running under this handle. */
  childNode: string;
  /** Depth in the delegation stack (1 = top-level). */
  depth: number;
  /** Whether this delegation was dispatched via `delegateMultiple` (parallel). */
  parallel: boolean;
  /**
   * Where this handle sits in its lifecycle. `running` → `ok`/`error`.
   * Kept as a plain string so the enum stays open to future states without a
   * type break.
   */
  status: 'running' | 'ok' | 'error';
  /** Final result once status is 'ok'. Absent while running / on error. */
  result?: DelegationResult;
  /** Error message once status is 'error'. Absent while running / on ok. */
  error?: string;
}

export type AgentRegistryEvent =
  | { kind: 'agent-start'; handle: AgentHandle }
  | { kind: 'agent-end'; handle: AgentHandle };

export type AgentRegistryListener = (event: AgentRegistryEvent) => void;

/**
 * Session-scoped registry. Not thread-safe; the Runtime is the sole writer.
 * Readers (TUI, tests) may hold a reference and iterate freely — {@link list}
 * returns a fresh array snapshot.
 */
export class AgentRegistry {
  private handles = new Map<string, AgentHandle>();
  private order: string[] = [];
  private counter = 0;
  private listeners = new Set<AgentRegistryListener>();

  /** Mint a new id + record. Emits `agent-start`. */
  register(input: Omit<AgentHandle, 'agentId' | 'status'>): AgentHandle {
    this.counter += 1;
    const handle: AgentHandle = {
      ...input,
      agentId: `agent-${this.counter}`,
      status: 'running',
    };
    this.handles.set(handle.agentId, handle);
    this.order.push(handle.agentId);
    for (const l of this.listeners) l({ kind: 'agent-start', handle });
    return handle;
  }

  /** Mark a handle finished. Emits `agent-end` with the settled record. */
  settle(
    agentId: string,
    outcome:
      | { kind: 'ok'; result: DelegationResult }
      | { kind: 'error'; error: string }
  ): AgentHandle | undefined {
    const handle = this.handles.get(agentId);
    if (!handle) return undefined;
    if (outcome.kind === 'ok') {
      handle.status = 'ok';
      handle.result = outcome.result;
    } else {
      handle.status = 'error';
      handle.error = outcome.error;
    }
    for (const l of this.listeners) l({ kind: 'agent-end', handle });
    return handle;
  }

  get(agentId: string): AgentHandle | undefined {
    return this.handles.get(agentId);
  }

  /** Snapshot every handle in registration order. */
  list(): AgentHandle[] {
    return this.order
      .map(id => this.handles.get(id))
      .filter((h): h is AgentHandle => !!h);
  }

  /** Children of a given handle (or all top-level handles if `parentId` is undefined). */
  children(parentId?: string): AgentHandle[] {
    return this.list().filter(h => h.parentAgentId === parentId);
  }

  on(listener: AgentRegistryListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
