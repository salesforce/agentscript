/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { NodeProps } from '@xyflow/react';
import { ArrowRightCircle } from 'lucide-react';
import type { GraphNodeData } from '~/lib/ast-to-graph';
import { getNodeBorderClass } from './diagnosticBorder';
import { NodeHandles, TERMINAL_SIDES } from './NodeHandles';

export function TransitionNode({ data, selected }: NodeProps<GraphNodeData>) {
  const borderClass = getNodeBorderClass(selected, data.diagnostics);

  return (
    <div
      className={`min-w-40 rounded-xl border border-gray-200 bg-white shadow-md transition-colors duration-150 hover:border-gray-300 dark:border-[#505060] dark:bg-[#26262e] dark:hover:border-[#606070] ${borderClass}`}
    >
      <NodeHandles
        sides={TERMINAL_SIDES}
        connectedHandles={data.connectedHandles}
        accentColor="#f43f5e"
      />
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-rose-100 dark:bg-rose-900/40">
          <ArrowRightCircle
            size={16}
            className="text-rose-600 dark:text-rose-400"
          />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-gray-800 dark:text-gray-200">
            {data.label}
          </div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Transition
          </div>
        </div>
      </div>
    </div>
  );
}
