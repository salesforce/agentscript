/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Shared handle component for graph nodes.
 *
 * Renders one handle per side with connected/unconnected styling:
 *   - Unconnected: tiny, semi-transparent, barely visible
 *   - Connected: larger, filled with accent color, white border
 */

import { Handle, Position, type HandleType } from '@xyflow/react';

// ---------------------------------------------------------------------------
// Handle ID conventions
// ---------------------------------------------------------------------------

/** Single top handle at center */
const TOP_HANDLES = [{ id: 'top', left: '50%' }] as const;

/** Single bottom handle at center */
const BOTTOM_HANDLES = [{ id: 'bottom', left: '50%' }] as const;

/** Single left handle at center */
const LEFT_HANDLES = [{ id: 'left', top: '50%' }] as const;

/** Single right handle at center */
const RIGHT_HANDLES = [{ id: 'right', top: '50%' }] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type HandleSide = 'top' | 'bottom' | 'left' | 'right';

interface SideConfig {
  type: HandleType;
}

export interface NodeHandlesProps {
  /** Which sides to render and their handle type (source/target). */
  sides: Partial<Record<HandleSide, SideConfig>>;
  /** Set of handle IDs that have edges connected. */
  connectedHandles?: ReadonlySet<string>;
  /** CSS color for connected handle fill (e.g., '#3b82f6' for blue). */
  accentColor?: string;
}

// ---------------------------------------------------------------------------
// Styling
// ---------------------------------------------------------------------------

const UNCONNECTED =
  '!h-[5px] !w-[5px] !border !border-gray-300/50 !bg-transparent dark:!border-gray-600/50';
const CONNECTED_BASE =
  '!h-[7px] !w-[7px] !border-[1.5px] !border-white !shadow-sm dark:!border-[#2d2d2d]';

function handleClass(connected: boolean, _accentColor?: string): string {
  if (!connected) return UNCONNECTED;
  // When connected, the bg color is set via inline style, so just use the base class
  return CONNECTED_BASE;
}

function handleStyle(
  connected: boolean,
  accentColor?: string,
  positionOffset?: Record<string, string>
): React.CSSProperties {
  return {
    ...positionOffset,
    ...(connected && accentColor ? { backgroundColor: accentColor } : {}),
    ...(connected && !accentColor ? { backgroundColor: '#6b7280' } : {}),
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NodeHandles({
  sides,
  connectedHandles,
  accentColor,
}: NodeHandlesProps) {
  const isConnected = (id: string) => connectedHandles?.has(id) ?? false;

  return (
    <>
      {sides.top &&
        TOP_HANDLES.map(h => (
          <Handle
            key={h.id}
            id={h.id}
            type={sides.top!.type}
            position={Position.Top}
            className={handleClass(isConnected(h.id), accentColor)}
            style={handleStyle(isConnected(h.id), accentColor, {
              left: h.left,
            })}
          />
        ))}

      {sides.bottom &&
        BOTTOM_HANDLES.map(h => (
          <Handle
            key={h.id}
            id={h.id}
            type={sides.bottom!.type}
            position={Position.Bottom}
            className={handleClass(isConnected(h.id), accentColor)}
            style={handleStyle(isConnected(h.id), accentColor, {
              left: h.left,
            })}
          />
        ))}

      {sides.left &&
        LEFT_HANDLES.map(h => (
          <Handle
            key={h.id}
            id={h.id}
            type={sides.left!.type}
            position={Position.Left}
            className={handleClass(isConnected(h.id), accentColor)}
            style={handleStyle(isConnected(h.id), accentColor, { top: h.top })}
          />
        ))}

      {sides.right &&
        RIGHT_HANDLES.map(h => (
          <Handle
            key={h.id}
            id={h.id}
            type={sides.right!.type}
            position={Position.Right}
            className={handleClass(isConnected(h.id), accentColor)}
            style={handleStyle(isConnected(h.id), accentColor, { top: h.top })}
          />
        ))}
    </>
  );
}

/**
 * All available handle IDs for a given side.
 */
export function getHandleIdsForSide(side: HandleSide): string[] {
  return HANDLES_BY_SIDE[side].map(h => h.id);
}

/**
 * Standard handle sides for overview nodes (TB layout):
 * targets on top/left, sources on bottom/right.
 */
export const OVERVIEW_SIDES: Partial<Record<HandleSide, SideConfig>> = {
  top: { type: 'target' },
  bottom: { type: 'source' },
  left: { type: 'target' },
  right: { type: 'source' },
};

/**
 * Standard handle sides for detail nodes (LR layout):
 * targets on left/top, sources on right/bottom.
 */
export const DETAIL_SIDES: Partial<Record<HandleSide, SideConfig>> = {
  left: { type: 'target' },
  right: { type: 'source' },
  top: { type: 'target' },
  bottom: { type: 'source' },
};

/**
 * Start node: only source handles (bottom + right). No targets.
 */
export const START_SIDES: Partial<Record<HandleSide, SideConfig>> = {
  bottom: { type: 'source' },
  right: { type: 'source' },
};

/**
 * Terminal node (e.g., Transition): only target handles. No sources.
 */
export const TERMINAL_SIDES: Partial<Record<HandleSide, SideConfig>> = {
  top: { type: 'target' },
  left: { type: 'target' },
};

/**
 * Phase node handles (TB layout): target on top, source on bottom + right.
 */
export const PHASE_SIDES: Partial<Record<HandleSide, SideConfig>> = {
  top: { type: 'target' },
  bottom: { type: 'source' },
  right: { type: 'source' },
};

/**
 * LLM node handles: top target, bottom/right source, left source (loop-back).
 */
export const LLM_SIDES: Partial<Record<HandleSide, SideConfig>> = {
  top: { type: 'target' },
  bottom: { type: 'source' },
  left: { type: 'source' },
  right: { type: 'source' },
};

/**
 * Build Instructions: top target, bottom source.
 */
export const BUILD_INSTRUCTIONS_SIDES: Partial<Record<HandleSide, SideConfig>> =
  {
    top: { type: 'target' },
    bottom: { type: 'source' },
  };
