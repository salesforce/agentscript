/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { NodeProps } from '@xyflow/react';
import { Play } from 'lucide-react';
import type { GraphNodeData } from '~/lib/ast-to-graph';
import { GRAPH } from '~/lib/graph-tokens';
import { NodeHandles, START_SIDES } from './NodeHandles';

export function StartNode({ data, selected }: NodeProps<GraphNodeData>) {
  return (
    <div
      className={`flex items-center gap-3 rounded-xl border bg-green-50 px-5 py-3.5 shadow-lg transition-all duration-150 dark:bg-[#1a3820] dark:shadow-green-500/20 ${
        selected
          ? 'border-blue-400 ring-2 ring-blue-400/20 shadow-xl shadow-blue-500/10 dark:ring-blue-400/15 dark:shadow-blue-500/8'
          : 'border-green-400 dark:border-green-500/50 hover:border-green-500 dark:hover:border-green-400/70 hover:shadow-xl'
      }`}
    >
      <NodeHandles
        sides={START_SIDES}
        connectedHandles={data.connectedHandles}
        accentColor={GRAPH.action.accent}
      />
      <div
        className="flex h-9 w-9 items-center justify-center rounded-lg"
        style={{ backgroundColor: GRAPH.action.bg }}
      >
        <Play
          size={18}
          className="fill-current text-green-600 dark:text-green-400"
        />
      </div>
      <span className="text-sm font-semibold text-green-700 dark:text-green-200">
        Start
      </span>
    </div>
  );
}
