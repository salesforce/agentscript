/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react';
import { ShieldCheck } from 'lucide-react';
import { useAppStore } from '~/store';
import type { ConditionalEdgeData } from '~/lib/ast-to-graph';

const COLOR = '#6366f1'; // indigo — intelligence color for decision paths
const HIGHLIGHT_COLOR = '#3b82f6';
const CHEVRON_COUNT = 2;
const DURATION = 2.4;

/**
 * Conditional edge with flowing chevrons and a clickable gate icon.
 * Uses ELK-computed routes when available for proper edge spacing.
 * Hover over the gate icon to see condition text; click to open the drawer.
 * Reads highlight state from the Zustand store (bypasses React Flow memoization).
 */
export function ConditionalEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  style,
  markerEnd,
  data,
}: EdgeProps) {
  // Always use getSmoothStepPath for guaranteed right-angle (orthogonal) routing
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const highlightedEdgeIds = useAppStore(
    state => state.layout.highlightedEdgeIds
  );
  const isHighlighted = highlightedEdgeIds?.has(id) ?? false;
  const isDimmed = highlightedEdgeIds != null && !isHighlighted;

  const strokeColor = isHighlighted
    ? HIGHLIGHT_COLOR
    : ((style?.stroke as string) ?? COLOR);
  const strokeWidth = isHighlighted ? 3 : 1.5;
  const chevronColor = isHighlighted ? HIGHLIGHT_COLOR : COLOR;
  const groupOpacity = isDimmed ? 0.1 : 1;

  const openGraphDrawer = useAppStore(state => state.openGraphDrawer);

  const edgeData = data as
    | (ConditionalEdgeData & Record<string, unknown>)
    | undefined;

  const handleGateClick = () => {
    if (edgeData?.conditionText && edgeData?.sourceTopicName) {
      openGraphDrawer({
        type: 'conditional',
        data: {
          conditionText: edgeData.conditionText,
          sourceTopicName: edgeData.sourceTopicName,
          conditionalKey: edgeData.conditionalKey ?? edgeData.conditionText,
        },
      });
    }
  };

  return (
    <g
      style={{
        opacity: groupOpacity,
        transition: 'opacity 0.3s ease',
      }}
    >
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: strokeColor,
          ...(strokeWidth ? { strokeWidth } : {}),
        }}
      />

      {/* Flowing chevrons */}
      {Array.from({ length: CHEVRON_COUNT }, (_, i) => (
        <polygon
          key={i}
          points="0,-4 7,0 0,4"
          fill={chevronColor}
          opacity={isHighlighted ? 0.9 : 0.7}
        >
          <animateMotion
            dur={`${DURATION}s`}
            begin={`${(i * DURATION) / CHEVRON_COUNT}s`}
            repeatCount="indefinite"
            path={edgePath}
            rotate="auto"
          />
        </polygon>
      ))}

      {/* Gate icon with hover tooltip + click to open drawer */}
      {label && (
        <EdgeLabelRenderer>
          <div
            className="group/gate nodrag nopan"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
          >
            <div
              className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-indigo-300 bg-indigo-50 text-indigo-600 shadow-md transition-colors hover:bg-indigo-100 dark:border-indigo-400/60 dark:bg-indigo-500 dark:text-indigo-100 dark:hover:bg-indigo-400"
              onClick={handleGateClick}
            >
              <ShieldCheck size={18} />
            </div>
            <div className="pointer-events-none absolute left-1/2 top-full z-50 mt-1.5 hidden -translate-x-1/2 group-hover/gate:block">
              <div className="whitespace-nowrap rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-700 shadow-lg dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
                {label}
              </div>
            </div>
          </div>
        </EdgeLabelRenderer>
      )}
    </g>
  );
}
