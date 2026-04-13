/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { cn } from '~/lib/utils';
import type { Diagnostic, Range } from '@agentscript/types';
import type { NamedMap } from '@agentscript/language';
import type { VariableOption, TopicOption } from '~/lib/schema-introspection';
import { ReasoningActionCard } from './ReasoningActionCard';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReasoningActionInstance {
  __kind?: string;
  __name?: string;
  __cst?: { range?: Range };
  [key: string]: unknown;
}

interface ActionBlockInstance {
  __kind?: string;
  __name?: string;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  [key: string]: unknown;
}

interface ReasoningActionListProps {
  entries: NamedMap<ReasoningActionInstance>;
  /** Topic-level action definitions for resolving input/output types */
  topicActions?: NamedMap<ActionBlockInstance>;
  /** Available variables for output assignment combobox */
  variableOptions: VariableOption[];
  /** Available topics for transition "to" clause combobox */
  topicOptions: TopicOption[];
  allDiagnostics: Diagnostic[];
  onReorder?: (names: string[]) => void;
  /** Called after any edit so the document can be re-emitted */
  onReemit?: () => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReasoningActionList({
  entries,
  topicActions,
  variableOptions,
  topicOptions,
  allDiagnostics,
  onReorder,
  onReemit,
  className,
}: ReasoningActionListProps) {
  const names = [...entries.keys()];

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = names.indexOf(String(active.id));
    const newIndex = names.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = [...names];
    const [removed] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, removed);
    onReorder?.(reordered);
  };

  return (
    <div className={cn('space-y-2', className)}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={names} strategy={verticalListSortingStrategy}>
          {names.map(name => {
            const instance = entries.get(name);
            if (!instance) return null;
            return (
              <ReasoningActionCard
                key={name}
                id={name}
                instance={instance}
                topicActions={topicActions}
                variableOptions={variableOptions}
                topicOptions={topicOptions}
                allDiagnostics={allDiagnostics}
                onReemit={onReemit}
                sortable={names.length > 1}
              />
            );
          })}
        </SortableContext>
      </DndContext>
    </div>
  );
}
