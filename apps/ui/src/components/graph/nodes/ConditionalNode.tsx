/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Diamond } from 'lucide-react';
import type { GraphNodeData } from '~/lib/ast-to-graph';

export function ConditionalNode({ data }: NodeProps<GraphNodeData>) {
  const conditionLabel = data.conditionLabel ?? data.conditionText ?? '';
  const fullCondition = data.conditionText ?? '';

  return (
    <div className="group/cond relative">
      <div className="min-w-50 rounded-lg border border-indigo-200/40 bg-white shadow-md transition-colors duration-150 hover:border-indigo-300/50 dark:border-indigo-500/50 dark:bg-[#26262e] dark:hover:border-indigo-400/60">
        {/* Single target handle — top center */}
        <Handle
          type="target"
          position={Position.Top}
          id="top"
          className="h-2! w-2! border-[1.5px]! border-white! bg-gray-400! dark:border-[#26262e]! dark:bg-gray-500!"
        />

        {/* Compact header row */}
        <div className="flex items-center gap-2 px-3 py-2">
          <Diamond
            size={12}
            className="shrink-0 fill-indigo-400 text-indigo-500 dark:fill-indigo-500 dark:text-indigo-400"
          />
          <span className="truncate text-[13px] font-medium text-gray-700 dark:text-gray-100">
            {conditionLabel}
          </span>
        </div>

        {/* If / else indicator row */}
        <div className="flex border-t border-gray-100 dark:border-gray-700/30">
          <span className="flex-1 text-center text-xs font-medium text-gray-600 py-1 dark:text-gray-200">
            if
          </span>
          <div className="w-px bg-gray-100 dark:bg-gray-700/30" />
          <span className="flex-1 text-center text-xs font-medium text-gray-600 py-1 dark:text-gray-200">
            else
          </span>
        </div>

        {/* "if" handle at 30% */}
        <Handle
          type="source"
          position={Position.Bottom}
          id="if"
          className="h-2! w-2! border-[1.5px]! border-white! bg-gray-400! dark:border-[#26262e]! dark:bg-gray-500!"
          style={{ left: '30%' }}
        />
        {/* "else" handle at 70% */}
        <Handle
          type="source"
          position={Position.Bottom}
          id="else"
          className="h-2! w-2! border-[1.5px]! border-white! bg-gray-400! dark:border-[#26262e]! dark:bg-gray-500!"
          style={{ left: '70%' }}
        />
      </div>

      {/* Hover tooltip — full condition text */}
      {fullCondition && (
        <div className="pointer-events-none absolute top-full left-1/2 z-50 mt-1.5 hidden w-max max-w-100 -translate-x-1/2 group-hover/cond:block">
          <div className="rounded-lg border border-gray-200 bg-white p-2.5 shadow-lg dark:border-gray-600 dark:bg-[#1e1e2e]">
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400">
              Condition
            </div>
            <div className="mt-0.5 font-mono text-xs leading-snug text-gray-700 dark:text-gray-200">
              If {fullCondition}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
