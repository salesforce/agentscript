/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { NodeProps } from '@xyflow/react';
import { Sparkles, Play } from 'lucide-react';
import type { GraphNodeData } from '~/lib/ast-to-graph';
import { NodeHandles, LLM_SIDES } from './NodeHandles';
import { useAppStore } from '~/store';

export function LlmNode({ data }: NodeProps<GraphNodeData>) {
  const actionNames = data.actionNames as string[] | undefined;
  const hasActions = actionNames && actionNames.length > 0;
  const openActionDrawer = useAppStore(state => state.openActionDrawer);

  const handleActionClick = (
    e: React.MouseEvent,
    actionName: string,
    index: number
  ) => {
    e.stopPropagation();
    openActionDrawer({
      actionDisplayName: actionName,
      actionIndex: index,
      topicName: data.topicName as string | undefined,
    });
  };

  return (
    <div className="relative w-full overflow-hidden rounded-2xl border-2 border-indigo-300/60 shadow-lg shadow-indigo-500/10 dark:border-indigo-400/60">
      <NodeHandles
        sides={LLM_SIDES}
        connectedHandles={data.connectedHandles}
        accentColor="#818cf8"
      />
      {/* Gradient background */}
      <div className="bg-gradient-to-br from-indigo-50 via-purple-50/80 to-blue-50 dark:from-indigo-950/70 dark:via-purple-950/70 dark:to-blue-950/70">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-100 shadow-sm ring-1 ring-indigo-200/50 dark:bg-indigo-900/60 dark:ring-indigo-700/50">
            <Sparkles
              size={18}
              className="text-indigo-600 dark:text-indigo-400"
            />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-indigo-900 dark:text-indigo-100">
              {data.label}
            </div>
            {data.subtitle && (
              <div className="text-xs font-medium text-indigo-500/80 dark:text-indigo-400/80">
                {data.subtitle}
              </div>
            )}
          </div>
        </div>

        {/* Action pills — interactive */}
        {hasActions && (
          <div className="flex flex-wrap gap-2 border-t border-indigo-200/60 px-5 py-3 dark:border-indigo-700/50">
            {actionNames.map((name, index) => (
              <button
                key={name}
                type="button"
                onClick={e => handleActionClick(e, name, index)}
                className="nopan inline-flex cursor-pointer items-center gap-1.5 rounded-full bg-indigo-100/90 px-3.5 py-1.5 text-xs font-medium text-indigo-700 ring-1 ring-indigo-200/50 transition-colors duration-150 hover:bg-indigo-200/90 hover:shadow-sm dark:bg-indigo-900/60 dark:text-indigo-300 dark:ring-indigo-700/50 dark:hover:bg-indigo-800/70"
              >
                <Play
                  size={9}
                  className="text-indigo-500 dark:text-indigo-400"
                />
                {name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
