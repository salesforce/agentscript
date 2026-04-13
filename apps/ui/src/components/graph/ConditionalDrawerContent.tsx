/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Content area of the conditional drawer.
 * Provides a Builder / Code toggle to switch between
 * a visual IfStatement editor and source code view.
 */

import { useState } from 'react';
import type { ConditionalEdgeData } from '~/lib/ast-to-graph';
import { ConditionalBuilderView } from './ConditionalBuilderView';
import { ConditionalCodeView } from './ConditionalCodeView';
import { cn } from '~/lib/utils';

type ViewMode = 'builder' | 'code';

interface ConditionalDrawerContentProps {
  data: ConditionalEdgeData;
}

export function ConditionalDrawerContent({
  data,
}: ConditionalDrawerContentProps) {
  const [mode, setMode] = useState<ViewMode>('builder');

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-hidden px-4 pb-4">
      {/* Tab toggle */}
      <div className="flex gap-1 rounded-lg border border-gray-200 bg-gray-100 p-0.5 dark:border-[#404040] dark:bg-[#2d2d2d]">
        <TabButton
          label="Builder"
          active={mode === 'builder'}
          onClick={() => setMode('builder')}
        />
        <TabButton
          label="Code"
          active={mode === 'code'}
          onClick={() => setMode('code')}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {mode === 'builder' ? (
          <ConditionalBuilderView data={data} />
        ) : (
          <ConditionalCodeView data={data} />
        )}
      </div>
    </div>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 rounded-md px-3 py-1 text-xs font-medium transition-colors',
        active
          ? 'bg-white text-gray-900 shadow-sm dark:bg-[#3c3c3c] dark:text-gray-100'
          : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
      )}
    >
      {label}
    </button>
  );
}
