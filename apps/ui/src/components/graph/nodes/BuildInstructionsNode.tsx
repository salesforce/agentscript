/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { NodeProps } from '@xyflow/react';
import { Layers } from 'lucide-react';
import type { GraphNodeData } from '~/lib/ast-to-graph';
import { NodeHandles, BUILD_INSTRUCTIONS_SIDES } from './NodeHandles';

export function BuildInstructionsNode({ data }: NodeProps<GraphNodeData>) {
  return (
    <div className="relative min-w-[260px] rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50/60 to-white shadow-sm dark:border-indigo-700/60 dark:from-indigo-950/30 dark:to-[#2d2d2d]">
      <NodeHandles
        sides={BUILD_INSTRUCTIONS_SIDES}
        connectedHandles={data.connectedHandles}
        accentColor="#6366f1"
      />
      <div className="flex items-center gap-2.5 px-3 py-2">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-indigo-100 dark:bg-indigo-900/40">
          <Layers size={12} className="text-indigo-600 dark:text-indigo-400" />
        </div>
        <div className="truncate text-xs font-medium text-gray-800 dark:text-gray-200">
          {data.label}
        </div>
      </div>
    </div>
  );
}
