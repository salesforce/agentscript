/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import { useAppStore } from '~/store';

const CHEVRON_COUNT = 2;
const DURATION = 2.4;
const HIGHLIGHT_COLOR = '#3b82f6';
const SPINE_COLOR = '#6366f1'; // indigo-500
const SECONDARY_COLOR = '#64748b'; // slate-500 — visible on #141414 canvas

/**
 * Default edge with animated chevrons flowing source→target.
 * Uses ELK-computed routes when available for proper edge spacing.
 * Reads highlight state from the Zustand store (bypasses React Flow memoization).
 */
export function AnimatedEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  data,
}: EdgeProps) {
  // Always use getSmoothStepPath for guaranteed right-angle (orthogonal) routing
  const [edgePath] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  // Determine edge role for visual hierarchy
  const edgeData = data as Record<string, unknown> | undefined;
  const edgeRole = edgeData?.edgeRole as string | undefined;
  const isSpine = edgeRole === 'spine';

  const highlightedEdgeIds = useAppStore(
    state => state.layout.highlightedEdgeIds
  );
  const isHighlighted = highlightedEdgeIds?.has(id) ?? false;
  const isDimmed = highlightedEdgeIds != null && !isHighlighted;

  // Visual hierarchy: two tiers — primary (spine) and secondary (everything else)
  let strokeColor: string;
  let strokeWidth: number;
  let chevronColor: string;
  let chevronOpacity: number;
  let chevronSize: string;
  let glowFilter: string | undefined;

  if (isHighlighted) {
    strokeColor = HIGHLIGHT_COLOR;
    strokeWidth = 3;
    chevronColor = HIGHLIGHT_COLOR;
    chevronOpacity = 0.9;
    chevronSize = '0,-5 8,0 0,5';
    glowFilter = 'url(#edge-glow)';
  } else if (isSpine) {
    strokeColor = SPINE_COLOR;
    strokeWidth = 2;
    chevronColor = SPINE_COLOR;
    chevronOpacity = 0.7;
    chevronSize = '0,-4 7,0 0,4';
  } else {
    strokeColor = (style?.stroke as string) ?? SECONDARY_COLOR;
    strokeWidth = 2;
    chevronColor = SECONDARY_COLOR;
    chevronOpacity = 0.6;
    chevronSize = '0,-4 7,0 0,4';
  }

  const groupOpacity = isDimmed ? 0.1 : 1;

  return (
    <g
      style={{
        opacity: groupOpacity,
        transition: 'opacity 0.3s ease',
      }}
    >
      {/* Glow filter definition for highlighted edges */}
      <defs>
        <filter id="edge-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <BaseEdge
        path={edgePath}
        markerEnd={markerEnd}
        style={{
          ...style,
          stroke: strokeColor,
          strokeWidth,
          filter: glowFilter,
        }}
      />
      {Array.from({ length: CHEVRON_COUNT }, (_, i) => (
        <polygon
          key={i}
          points={chevronSize}
          fill={chevronColor}
          opacity={chevronOpacity}
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
    </g>
  );
}
