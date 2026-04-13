/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { NodeProps } from '@xyflow/react';
import { PlayCircle, CheckCircle, BookOpen } from 'lucide-react';
import type { GraphNodeData, PhaseType } from '~/lib/ast-to-graph';
import { getNodeBorderClass } from './diagnosticBorder';
import { DiagnosticHoverCard } from './DiagnosticHoverCard';
import { NodeHandles, PHASE_SIDES, type HandleSide } from './NodeHandles';

interface PhaseConfig {
  icon: typeof PlayCircle;
  color: string;
  bgClass: string;
  iconClass: string;
}

const PHASE_CONFIGS: Record<string, PhaseConfig> = {
  'topic-header': {
    icon: PlayCircle,
    color: '#0ea5e9',
    bgClass: 'bg-sky-100 dark:bg-sky-900/40',
    iconClass: 'text-sky-600 dark:text-sky-400',
  },
  before_reasoning: {
    icon: PlayCircle,
    color: '#22c55e',
    bgClass: 'bg-green-100 dark:bg-green-900/40',
    iconClass: 'text-green-600 dark:text-green-400',
  },
  after_reasoning: {
    icon: CheckCircle,
    color: '#f59e0b',
    bgClass: 'bg-amber-100 dark:bg-amber-900/40',
    iconClass: 'text-amber-600 dark:text-amber-400',
  },
  before_reasoning_iteration: {
    icon: BookOpen,
    color: '#6366f1',
    bgClass: 'bg-indigo-100 dark:bg-indigo-900/40',
    iconClass: 'text-indigo-600 dark:text-indigo-400',
  },
};

const DEFAULT_CONFIG: PhaseConfig = {
  icon: PlayCircle,
  color: '#6b7280',
  bgClass: 'bg-gray-100 dark:bg-gray-800/40',
  iconClass: 'text-gray-600 dark:text-gray-400',
};

/** Loop-back target (before_reasoning_iteration): left side is a target for the upward arc */
const PHASE_LOOP_TARGET_SIDES: Partial<
  Record<HandleSide, { type: 'source' | 'target' }>
> = {
  top: { type: 'target' },
  bottom: { type: 'source' },
  right: { type: 'source' },
  left: { type: 'target' },
};

function getSidesForPhase(
  phaseType: PhaseType | undefined
): Partial<Record<HandleSide, { type: 'source' | 'target' }>> {
  if (phaseType === 'before_reasoning_iteration')
    return PHASE_LOOP_TARGET_SIDES;
  return PHASE_SIDES;
}

export function PhaseNode({ data, selected }: NodeProps<GraphNodeData>) {
  const phaseType = data.phaseType as PhaseType | undefined;
  const config = (phaseType && PHASE_CONFIGS[phaseType]) ?? DEFAULT_CONFIG;
  const Icon = config.icon;
  const borderClass = getNodeBorderClass(selected, data.diagnostics);
  const isLabel = data.nodeType === 'phase-label';
  const sides = getSidesForPhase(phaseType);
  const isEmpty = data.isEmpty === true;

  // Empty phase: dashed border, muted — shows lifecycle slot exists
  if (isEmpty) {
    return (
      <div className="relative min-w-65 rounded-xl border border-dashed border-gray-300/50 bg-white/50 shadow-none dark:border-[#505060]/50 dark:bg-[#26262e]/50">
        <NodeHandles
          sides={sides}
          connectedHandles={data.connectedHandles}
          accentColor={config.color}
        />
        <div className="flex items-center gap-2.5 px-4 py-3">
          <div
            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${config.bgClass}`}
          >
            <Icon size={14} className={config.iconClass} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-gray-800 dark:text-gray-200">
              {data.label}
            </div>
            {data.subtitle && (
              <div className="text-xs text-gray-400 dark:text-gray-500">
                {data.subtitle}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative min-w-65 rounded-xl border border-gray-200/50 bg-white/50 shadow-none dark:border-[#505060]/50 dark:bg-[#26262e]/50 ${borderClass}`}
    >
      <NodeHandles
        sides={sides}
        connectedHandles={data.connectedHandles}
        accentColor={config.color}
      />
      {data.diagnostics && data.diagnostics.length > 0 && (
        <div className="absolute -top-2.5 -right-2.5 z-10">
          <DiagnosticHoverCard diagnostics={data.diagnostics} />
        </div>
      )}
      <div
        className={`flex items-center gap-2.5 ${isLabel ? 'px-3 py-2' : 'px-4 py-3'}`}
      >
        <div
          className={`flex shrink-0 items-center justify-center rounded-md ${config.bgClass} ${
            isLabel ? 'h-6 w-6' : 'h-7 w-7'
          }`}
        >
          <Icon size={isLabel ? 12 : 14} className={config.iconClass} />
        </div>
        <div className="min-w-0">
          <div
            className={`truncate font-medium text-gray-800 dark:text-gray-200 ${
              isLabel ? 'text-xs' : 'text-sm'
            }`}
          >
            {data.label}
          </div>
          {data.subtitle && (
            <div className="text-[10px] text-gray-400 dark:text-gray-500">
              {data.subtitle}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
