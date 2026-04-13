/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { NodeProps } from '@xyflow/react';
import { Hash } from 'lucide-react';
import type { GraphNodeData } from '~/lib/ast-to-graph';
import { getNodeBorderClass } from './diagnosticBorder';
import { DiagnosticHoverCard } from './DiagnosticHoverCard';
import { NodeHandles } from './NodeHandles';

const SECTION_LABELS: Record<string, string> = {
  before_reasoning: 'Before Reasoning',
  reasoning: 'Reasoning',
  after_reasoning: 'After Reasoning',
};

const ALL_SECTIONS = [
  'before_reasoning',
  'reasoning',
  'after_reasoning',
] as const;

export function CompoundTopicNode({
  data,
  selected,
}: NodeProps<GraphNodeData>) {
  const sections = ALL_SECTIONS;
  const borderClass = getNodeBorderClass(selected, data.diagnostics);

  return (
    <div
      className={`relative min-w-[200px] rounded-xl border bg-white shadow-sm dark:bg-[#2d2d2d] ${borderClass}`}
    >
      <NodeHandles
        sides={{
          top: { type: 'target' },
          left: { type: 'target' },
          right: { type: 'source' },
        }}
        connectedHandles={data.connectedHandles}
        accentColor="#3b82f6"
      />
      {data.diagnostics && data.diagnostics.length > 0 && (
        <div className="absolute -top-2.5 -right-2.5 z-10">
          <DiagnosticHoverCard diagnostics={data.diagnostics} />
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-gray-100 px-4 py-3 dark:border-[#404040]">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-blue-100 dark:bg-blue-900/40">
          <Hash size={14} className="text-blue-600 dark:text-blue-400" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-gray-800 dark:text-gray-200">
            {data.label}
          </div>
        </div>
      </div>

      {/* Sections */}
      <div className="flex flex-col">
        {sections.map((section, idx) => (
          <div
            key={section}
            className={`relative flex items-center justify-between px-4 py-2.5 ${
              idx < sections.length - 1
                ? 'border-b border-gray-50 dark:border-[#383838]'
                : ''
            }`}
          >
            <span className="text-xs text-gray-600 dark:text-gray-400">
              {SECTION_LABELS[section] ?? section}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
