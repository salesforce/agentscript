/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Content panel for the action detail drawer.
 * Resolves a ReasoningActionBlock from the AST and displays its details:
 * action reference, description, parameters, conditions, and transitions.
 */

import { useAppStore } from '~/store';
import type { ActionDrawerData } from '~/lib/ast-to-graph';
import { isNamedMap, type Statement } from '@agentscript/language';
import type { AgentScriptAST } from '~/lib/parser';
import { Play, Settings2, Shield, ArrowRight, Equal } from 'lucide-react';

interface ActionDrawerContentProps {
  data: ActionDrawerData;
}

export function ActionDrawerContent({ data }: ActionDrawerContentProps) {
  const ast = useAppStore(state => state.source.ast) as AgentScriptAST | null;

  const actionBlock = resolveActionFromAst(ast, data);

  if (!actionBlock) {
    return (
      <div className="px-4 py-6 text-sm text-gray-400">
        Action details not available.
      </div>
    );
  }

  const statements = (actionBlock.statements ?? []) as Statement[];
  const description = actionBlock.description as { value?: string } | undefined;
  const value = actionBlock.value as
    | { object?: { name?: string }; property?: string }
    | undefined;

  // Categorize statements
  const withClauses = statements.filter(s => s.__kind === 'WithClause');
  const setClauses = statements.filter(s => s.__kind === 'SetClause');
  const toClauses = statements.filter(s => s.__kind === 'ToClause');
  const availableWhen = statements.filter(s => s.__kind === 'AvailableWhen');

  return (
    <div className="flex flex-col gap-4 px-4 pb-4 pt-2">
      {/* Action reference */}
      {value?.object?.name && value?.property && (
        <div className="rounded-lg bg-indigo-50 px-3 py-2 dark:bg-indigo-950/30">
          <div className="font-mono text-xs text-indigo-600 dark:text-indigo-400">
            @{value.object.name}.{value.property}
          </div>
        </div>
      )}

      {/* Description */}
      {description?.value && (
        <Section icon={<Play size={12} />} title="Description">
          <p className="text-xs leading-relaxed text-gray-600 dark:text-gray-400">
            {description.value}
          </p>
        </Section>
      )}

      {/* Parameters (WithClause) */}
      {withClauses.length > 0 && (
        <Section icon={<Settings2 size={12} />} title="Parameters">
          <div className="flex flex-col gap-1.5">
            {withClauses.map((clause, i) => (
              <ClauseRow key={i} clause={clause} />
            ))}
          </div>
        </Section>
      )}

      {/* Conditions (AvailableWhen) */}
      {availableWhen.length > 0 && (
        <Section icon={<Shield size={12} />} title="Available When">
          <div className="flex flex-col gap-1.5">
            {availableWhen.map((clause, i) => (
              <ClauseRow key={i} clause={clause} />
            ))}
          </div>
        </Section>
      )}

      {/* Assignments (SetClause) */}
      {setClauses.length > 0 && (
        <Section icon={<Equal size={12} />} title="Outputs">
          <div className="flex flex-col gap-1.5">
            {setClauses.map((clause, i) => (
              <ClauseRow key={i} clause={clause} />
            ))}
          </div>
        </Section>
      )}

      {/* Transitions (ToClause) */}
      {toClauses.length > 0 && (
        <Section icon={<ArrowRight size={12} />} title="Transitions">
          <div className="flex flex-col gap-1.5">
            {toClauses.map((clause, i) => (
              <ClauseRow key={i} clause={clause} />
            ))}
          </div>
        </Section>
      )}

      {/* Empty state */}
      {statements.length === 0 && !description?.value && (
        <div className="py-4 text-center text-xs text-gray-400">
          No additional configuration for this action.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

function ClauseRow({ clause }: { clause: Statement }) {
  const emitted = clause.__emit?.({ indent: 0 }) ?? '';
  return (
    <div className="rounded-md bg-gray-50 px-2.5 py-1.5 font-mono text-[11px] text-gray-700 dark:bg-gray-800/50 dark:text-gray-300">
      {emitted}
    </div>
  );
}

function resolveActionFromAst(
  ast: AgentScriptAST | null,
  data: ActionDrawerData
): Record<string, unknown> | null {
  if (!ast || !data.topicName) return null;
  const typedAst = ast as Record<string, unknown>;

  const startAgent = typedAst.start_agent;
  const topics = typedAst.topic;

  const topicBlock =
    (isNamedMap(startAgent)
      ? (startAgent.get(data.topicName) as Record<string, unknown> | undefined)
      : undefined) ??
    (isNamedMap(topics)
      ? (topics.get(data.topicName) as Record<string, unknown> | undefined)
      : undefined);

  if (!topicBlock) return null;

  const reasoning = topicBlock.reasoning as Record<string, unknown> | undefined;
  if (!reasoning) return null;

  const actions = reasoning.actions;
  if (!isNamedMap(actions)) return null;

  // Get action by index (Map iteration order is insertion order)
  let idx = 0;
  for (const [, entry] of actions) {
    if (idx === data.actionIndex) return entry as Record<string, unknown>;
    idx++;
  }

  return null;
}
