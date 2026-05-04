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
import { NodeHandles, DETAIL_SIDES } from './NodeHandles';

export function RunNode({ data, selected }: NodeProps<GraphNode>) {
  const borderClass = getNodeBorderClass(selected, data.diagnostics);

  return (
    <div
      className={`min-w-40 rounded-xl border border-gray-300 bg-white shadow-md transition-colors duration-150 hover:border-gray-400 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-zinc-600 ${borderClass}`}
    >
      <NodeHandles
        sides={DETAIL_SIDES}
        connectedHandles={data.connectedHandles}
        accentColor="#22c55e"
      />
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-green-100 dark:bg-green-900/40">
          <Play size={16} className="text-green-600 dark:text-green-400" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-gray-800 dark:text-gray-200">
            {data.label}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">Run</div>
        </div>
      </div>
    </div>
  );
}
