/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { BaseEdge, type EdgeProps } from '@xyflow/react';

const CHEVRON_COUNT = 4;
const DURATION = 4;
const COLOR = '#818cf8'; // indigo-400
const RADIUS = 16; // Corner radius
const CONTAINER_INSET = 14; // Px inside container left edge (aligns with decorative track)
const FALLBACK_OFFSET = 70; // Fallback left offset if no group data

/**
 * Loop-back edge for reasoning iterations.
 * Routes: source (left) → left to container edge → up → right → target (left).
 * Dashed indigo line with animated chevrons and "Next Iteration" label.
 */
export function LoopBackEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
}: EdgeProps) {
  const groupLeftX = (data as Record<string, unknown> | undefined)
    ?.groupLeftX as number | undefined;

  // X coordinate for the vertical segment — snap to container left edge
  const leftX =
    groupLeftX != null
      ? groupLeftX + CONTAINER_INSET
      : Math.min(sourceX, targetX) - FALLBACK_OFFSET;

  const r = RADIUS;

  const edgePath = [
    // Start at source (left-bottom handle of LLM node)
    `M ${sourceX} ${sourceY}`,
    // Go left to container edge
    `L ${leftX + r} ${sourceY}`,
    // Corner: left → up
    `Q ${leftX} ${sourceY} ${leftX} ${sourceY - r}`,
    // Go up to target level
    `L ${leftX} ${targetY + r}`,
    // Corner: up → right
    `Q ${leftX} ${targetY} ${leftX + r} ${targetY}`,
    // Go right to target (top-left handle of iteration phase node)
    `L ${targetX} ${targetY}`,
  ].join(' ');

  // Label at midpoint of the vertical segment
  const labelX = leftX;
  const labelY = (sourceY + targetY) / 2;

  return (
    <g>
      <BaseEdge
        path={edgePath}
        style={{
          stroke: COLOR,
          strokeWidth: 2.5,
          strokeDasharray: '8 5',
          fill: 'none',
        }}
      />
      {/* Arrow at target end — points right (→) */}
      <polygon
        points={`${targetX} ${targetY}, ${targetX - 8} ${targetY - 5}, ${targetX - 8} ${targetY + 5}`}
        fill={COLOR}
      />
      {/* Animated chevrons flowing along the path */}
      {Array.from({ length: CHEVRON_COUNT }, (_, i) => (
        <polygon key={i} points="0,-4 6,0 0,4" fill={COLOR} opacity={0.7}>
          <animateMotion
            dur={`${DURATION}s`}
            begin={`${(i * DURATION) / CHEVRON_COUNT}s`}
            repeatCount="indefinite"
            path={edgePath}
            rotate="auto"
          />
        </polygon>
      ))}
      {/* Label on the vertical segment */}
      <g transform={`translate(${labelX}, ${labelY})`}>
        <rect
          x={-48}
          y={-12}
          width={96}
          height={24}
          rx={12}
          className="fill-indigo-100 dark:fill-indigo-900/60"
          stroke={COLOR}
          strokeWidth={1}
        />
        <text
          textAnchor="middle"
          dominantBaseline="central"
          className="fill-indigo-600 dark:fill-indigo-400"
          style={{ fontSize: '10px', fontWeight: 600, letterSpacing: '0.02em' }}
        >
          Next Iteration
        </text>
      </g>
    </g>
  );
}
