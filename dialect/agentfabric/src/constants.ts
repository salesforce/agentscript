/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Connection-kind vocabulary for the AgentFabric dialect, named after the
 * agentic-network entity a connection-target value points to (mirrors the
 * agent-network JSON-LD `@type`): an LLM provider, an MCP server, an agent,
 * or a broker. Consumed via the schema's `.connectionRef([...])` markers so
 * tooling (completion) can offer the available connections of the right kind
 * without sniffing the URI scheme or key name.
 *
 * The kind→URI-scheme mapping ({@link CONNECTION_KIND_SCHEME}) lives here too
 * (e.g. `agent` → `a2a://`) so a kind whose scheme differs from its name is
 * carried losslessly in one place.
 */
export const ConnectionKind = {
  LLM: 'llm',
  MCP: 'mcp',
  Agent: 'agent',
  Broker: 'broker',
} as const;

export type ConnectionKind =
  (typeof ConnectionKind)[keyof typeof ConnectionKind];

/**
 * Maps each {@link ConnectionKind} to the URI scheme its connection-target
 * values use in `.agent` source (e.g. `agent` → `a2a://...`). The scheme
 * is not always the kind name, so the mapping is carried explicitly here as
 * the single source of truth for both authoring (schema patterns) and tooling
 * (completion building `${scheme}://${name}`).
 */
export const CONNECTION_KIND_SCHEME: Record<ConnectionKind, string> = {
  [ConnectionKind.LLM]: 'llm',
  [ConnectionKind.MCP]: 'mcp',
  [ConnectionKind.Agent]: 'a2a',
  [ConnectionKind.Broker]: 'brokers',
};

/**
 * Top-level schema namespaces — the `@namespace` keys declared in
 * `AgentFabricSchema`. Centralized here so reference checks, transition-target
 * allowlists, and node enumeration share one vocabulary instead of repeating
 * bare strings. (Kept in lockstep with the schema keys by hand; deriving it
 * from the schema would create an import cycle since the schema imports this.)
 */
export const Namespace = {
  System: 'system',
  Config: 'config',
  Variables: 'variables',
  LLM: 'llm',
  Actions: 'actions',
  Trigger: 'trigger',
  Orchestrator: 'orchestrator',
  Subagent: 'subagent',
  Generator: 'generator',
  Executor: 'executor',
  Router: 'router',
  Echo: 'echo',
} as const;

export type Namespace = (typeof Namespace)[keyof typeof Namespace];

/**
 * Namespaces whose entry blocks declare the `transitionTarget` capability —
 * the valid targets of a router route / switch transition. Shared by the
 * schema's `allowedNamespaces(...)` markers and the lint rules' target checks.
 *
 * TODO: derive from the schema itself (every top-level namespace whose entry
 * block declares `'transitionTarget'`) so adding a node kind doesn't require
 * editing this list by hand. (Moved here from schema.ts's ROUTER_TARGET_NAMESPACES.)
 */
export const TRANSITION_TARGET_NAMESPACES: Namespace[] = [
  Namespace.Orchestrator,
  Namespace.Subagent,
  Namespace.Generator,
  Namespace.Executor,
  Namespace.Router,
  Namespace.Echo,
];

/**
 * Type keywords valid in an output-structure property's `type:` field —
 * the JSON-schema 6-subset that AgentFabric's reasoning/generator outputs
 * support. Shared by the schema's `.enum(...)` marker (drives value
 * completion at the type position) and the output-structure lint rule
 * (rejects anything outside the set), so the authored vocabulary and the
 * validated vocabulary cannot drift.
 */
export const OUTPUT_JSON_SCHEMA_TYPES = [
  'string',
  'number',
  'integer',
  'boolean',
  'array',
  'object',
] as const;

// Anchor-free identifier fragment for connection-target URIs; embed inside `^…$`.
export const AGENTFABRIC_IDENTIFIER_PATTERN =
  '[a-zA-Z][a-zA-Z0-9_.-]*[a-zA-Z0-9]';
