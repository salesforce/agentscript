/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { NodeProps } from '@xyflow/react';
import { ChevronRight } from 'lucide-react';
import type { GraphNodeData } from '~/lib/ast-to-graph';
import { getBlockTypeConfig } from '~/lib/block-type-config';
import { GRAPH } from '~/lib/graph-tokens';
import { getNodeBorderClass } from './diagnosticBorder';
import { DiagnosticHoverCard } from './DiagnosticHoverCard';
import { NodeHandles, OVERVIEW_SIDES } from './NodeHandles';

export function TopicNode({ data, selected }: NodeProps<GraphNodeData>) {
  const isStartAgent = !!data.isStartAgent;
  const config = getBlockTypeConfig(data.blockType, {
    isStartAgent,
    iconSize: 20,
  });
  const diagnosticClass = getNodeBorderClass(selected, data.diagnostics);
  const hasDiagnosticBorder = diagnosticClass !== '';

  const accentColor = isStartAgent ? GRAPH.intelligence.accent : '#38bdf8'; // sky-400 — topics are inviting destinations

  // Start Agent: indigo-tinted — it routes conversations (intelligence color)
  // Regular Topic: warm neutral surface — clearly above the #141414 canvas
  // Tinted bg separates from canvas, but border/text stay neutral — icon badge is the sole color accent
  const variantClasses = isStartAgent
    ? 'bg-indigo-50 dark:bg-[#2a2a5c] border-indigo-200 dark:border-slate-400/20 dark:shadow-indigo-500/15 hover:border-indigo-300 dark:hover:border-slate-400/35'
    : 'bg-sky-50 dark:bg-[#1e3a58] border-sky-200 dark:border-slate-400/20 dark:shadow-sky-500/15 hover:border-sky-300 dark:hover:border-slate-400/35';

  return (
    <div
      className={`group relative min-w-60 cursor-pointer rounded-xl border shadow-lg transition-all duration-150 hover:shadow-xl ${variantClasses} ${hasDiagnosticBorder ? diagnosticClass : ''}`}
    >
      <NodeHandles
        sides={OVERVIEW_SIDES}
        connectedHandles={data.connectedHandles}
        accentColor={accentColor}
      />
      {data.diagnostics && data.diagnostics.length > 0 && (
        <div className="absolute -top-2.5 -right-2.5 z-10">
          <DiagnosticHoverCard diagnostics={data.diagnostics} />
        </div>
      )}
      <div className="flex items-center gap-3 px-5 py-4">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{ backgroundColor: config.iconBg }}
        >
          {config.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-gray-800 dark:text-white">
            {data.label}
          </div>
          <div className="text-xs text-gray-500 dark:text-slate-400">
            {data.subtitle ?? (isStartAgent ? 'Start Agent' : 'Topic')}
          </div>
        </div>
        <ChevronRight
          size={14}
          className="shrink-0 text-gray-400/40 dark:text-slate-500/60"
        />
      </div>
    </div>
  );
}
