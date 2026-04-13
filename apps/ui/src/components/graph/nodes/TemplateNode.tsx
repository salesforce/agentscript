/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { NodeProps } from '@xyflow/react';
import { AlignLeft } from 'lucide-react';
import type { GraphNodeData } from '~/lib/ast-to-graph';
import { getNodeBorderClass } from './diagnosticBorder';
import { NodeHandles, DETAIL_SIDES } from './NodeHandles';

export function TemplateNode({ data, selected }: NodeProps<GraphNodeData>) {
  const text = data.label ?? '';
  const borderClass = getNodeBorderClass(selected, data.diagnostics);

  return (
    <div
      className={`min-w-45 max-w-75 rounded-xl border border-gray-200 bg-white shadow-md transition-colors duration-150 hover:border-gray-300 dark:border-[#505060] dark:bg-[#26262e] dark:hover:border-[#606070] ${borderClass}`}
    >
      <NodeHandles
        sides={DETAIL_SIDES}
        connectedHandles={data.connectedHandles}
        accentColor="#6b7280"
      />
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gray-100 dark:bg-gray-800">
          <AlignLeft size={16} className="text-gray-500 dark:text-gray-400" />
        </div>
        <div className="min-w-0">
          <div className="line-clamp-2 text-xs leading-relaxed text-gray-600 dark:text-gray-400">
            {text}
          </div>
        </div>
      </div>
    </div>
  );
}
