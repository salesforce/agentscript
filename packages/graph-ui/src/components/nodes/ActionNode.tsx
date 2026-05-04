/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { NodeProps } from '@xyflow/react';
import { Play } from 'lucide-react';
import type { GraphNode } from '../../ast/ast-to-graph';
import { getNodeBorderClass } from './diagnosticBorder';
import { DiagnosticHoverCard } from './DiagnosticHoverCard';
import { NodeHandles, DETAIL_SIDES } from './NodeHandles';

export function ActionNode({ data, selected }: NodeProps<GraphNode>) {
  const borderClass = getNodeBorderClass(selected, data.diagnostics);

  return (
    <div
      className={`relative min-w-[160px] rounded-xl border border-gray-300 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-800 ${borderClass}`}
    >
      <NodeHandles
        sides={DETAIL_SIDES}
        connectedHandles={data.connectedHandles}
        accentColor="#3b82f6"
      />
      {data.diagnostics && data.diagnostics.length > 0 && (
        <div className="absolute -top-2.5 -right-2.5 z-10">
          <DiagnosticHoverCard diagnostics={data.diagnostics} />
        </div>
      )}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-100 dark:bg-blue-900/40">
          <Play size={14} className="text-blue-600 dark:text-blue-400" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-gray-800 dark:text-gray-200">
            {data.label}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Action</div>
        </div>
      </div>
    </div>
  );
}
