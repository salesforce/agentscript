/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
import { ArrowDown, RotateCw } from 'lucide-react';
import type { GraphNodeData } from '~/lib/ast-to-graph';

/**
 * Visual container node for phase groups (uses React Flow parentId nesting).
 *
 * All variants have invisible React Flow handles (t-c, enter-out, exit-in, b-c)
 * so spine edges can route through the group boundary.
 *
 * Reasoning Loop: prominent solid border, gradient bg, "iterates" badge,
 *   "Enter Loop" handle/badge at top, "Exit" handle/badge at bottom.
 * Before/After Reasoning: lighter gray container for subtle grouping.
 *   Empty state: dashed border, muted, no content.
 *
 * Dimensions come from node.style (set by the layout engine). The component
 * fills its container with `width: 100%, height: 100%`.
 *
 * Non-interactive — purely visual grouping.
 */
export function ReasoningGroupNode({ data }: NodeProps<GraphNodeData>) {
  const isLoop = data.label === 'Reasoning Loop';
  const isEmpty = data.isEmpty === true;

  const containerStyle: React.CSSProperties = {
    width: '100%',
    height: '100%',
  };

  /** Invisible handle style — handles are hidden, edges connect through them */
  const hiddenHandle: React.CSSProperties = {
    width: 1,
    height: 1,
    opacity: 0,
    pointerEvents: 'none',
  };

  // Shared handles for ALL group variants (spine edges route through these)
  const groupHandles = (
    <>
      {/* External target at top */}
      <Handle
        type="target"
        position={Position.Top}
        id="top"
        isConnectable={false}
        style={{ ...hiddenHandle, left: '50%' }}
      />
      {/* Internal source at top — edge goes DOWN to first child */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="enter-out"
        isConnectable={false}
        style={{ ...hiddenHandle, left: '50%', top: 0 }}
      />
      {/* Internal target at bottom — edge arrives from last child */}
      <Handle
        type="target"
        position={Position.Top}
        id="exit-in"
        isConnectable={false}
        style={{ ...hiddenHandle, left: '50%', top: '100%' }}
      />
      {/* External source at bottom */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="bottom"
        isConnectable={false}
        style={{ ...hiddenHandle, left: '50%' }}
      />
    </>
  );

  // Empty before/after reasoning: dashed container with visible border
  if (isEmpty && !isLoop) {
    return (
      <div
        className="relative rounded-2xl border border-dashed border-gray-300/60 bg-gray-50/10 dark:border-slate-400/30 dark:bg-slate-400/5"
        style={containerStyle}
      >
        {groupHandles}
        <div className="flex items-center gap-2 px-4 pt-3 pb-2">
          <RotateCw size={11} className="text-gray-400 dark:text-slate-400" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-400">
            {data.label}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative rounded-2xl border ${
        isLoop
          ? 'border-indigo-200/40 bg-linear-to-b from-indigo-50/20 to-transparent dark:border-indigo-400/35 dark:from-indigo-950/15 dark:to-transparent'
          : 'border-gray-300/40 bg-gray-50/10 dark:border-slate-400/30 dark:bg-slate-400/5'
      }`}
      style={containerStyle}
    >
      {groupHandles}

      {/* Enter Loop badge — top center (Reasoning Loop only) */}
      {isLoop && (
        <div className="absolute left-1/2 z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full bg-indigo-500/80 px-3 py-1 text-[11px] font-semibold text-white shadow-sm dark:bg-indigo-600/80">
          <ArrowDown size={10} />
          Enter Loop
        </div>
      )}

      {/* Exit badge — bottom center (Reasoning Loop only) */}
      {isLoop && (
        <div className="absolute bottom-0 left-1/2 z-10 flex -translate-x-1/2 translate-y-1/2 items-center gap-1 rounded-full bg-gray-500/80 px-3 py-1 text-[11px] font-semibold text-white shadow-sm dark:bg-gray-600/80">
          <ArrowDown size={10} />
          Exit
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-1.5">
        <div className="flex items-center gap-2">
          <RotateCw
            size={isLoop ? 13 : 11}
            className={
              isLoop
                ? 'text-indigo-500 dark:text-indigo-400'
                : 'text-gray-400 dark:text-slate-400'
            }
          />
          <span
            className={`font-semibold uppercase tracking-wider ${
              isLoop
                ? 'text-[11px] text-indigo-500 dark:text-indigo-400'
                : 'text-[11px] text-gray-400 dark:text-slate-400'
            }`}
          >
            {data.label}
          </span>
        </div>
        {isLoop && (
          <span className="rounded-full bg-indigo-100/50 px-2 py-0.5 text-[11px] font-medium text-indigo-600/60 dark:bg-indigo-500/10 dark:text-indigo-400/50">
            iterates
          </span>
        )}
      </div>
    </div>
  );
}
