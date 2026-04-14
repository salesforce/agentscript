/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useState } from 'react';
import { cn } from '~/lib/utils';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Plus } from 'lucide-react';
import type { FieldType } from '@agentscript/language';
import type { Diagnostic } from '@agentscript/types';
import { NamedMap } from '@agentscript/language';
import { formatFieldName } from '~/lib/schema-introspection';
import { NamedBlockCard } from './NamedBlockCard';
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

interface NamedBlockInstance {
  __kind?: string;
  __name?: string;
  [key: string]: unknown;
}

interface NamedBlockListProps {
  blockType: string;
  entries: NamedMap<NamedBlockInstance>;
  schema: Record<string, FieldType>;
  allDiagnostics: Diagnostic[];
  onScalarChange: (fieldPath: string, value: string | number | boolean) => void;
  onAdd: (name: string) => void;
  onDelete: (name: string) => void;
  onRename: (oldName: string, newName: string) => void;
  onReorder: (names: string[]) => void;
  renderCompound?: (
    fieldInfo: import('~/lib/schema-introspection').SchemaFieldInfo,
    value: unknown,
    parentPath: string
  ) => React.ReactNode;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NamedBlockList({
  blockType,
  entries,
  schema,
  allDiagnostics,
  onScalarChange,
  onAdd,
  onDelete,
  onRename,
  onReorder,
  renderCompound,
  className,
}: NamedBlockListProps) {
  const [showAddInput, setShowAddInput] = useState(false);
  const [newName, setNewName] = useState('');

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
    onReorder(reordered);
  };

  const handleAdd = () => {
    const trimmed = newName.trim();
    if (trimmed && !entries.has(trimmed)) {
      onAdd(trimmed);
      setNewName('');
      setShowAddInput(false);
    }
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
              <NamedBlockCard
                key={name}
                id={name}
                blockType={blockType}
                instance={instance}
                schema={schema}
                allDiagnostics={allDiagnostics}
                onScalarChange={onScalarChange}
                onRename={onRename}
                onDelete={onDelete}
                renderCompound={renderCompound}
                sortable={names.length > 1}
              />
            );
          })}
        </SortableContext>
      </DndContext>

      {/* Add new entry */}
      {showAddInput ? (
        <div className="flex items-center gap-2 pl-2">
          <Input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder={`${formatFieldName(blockType)} name...`}
            autoFocus
            className="h-7 text-sm"
            onKeyDown={e => {
              if (e.key === 'Enter') handleAdd();
              if (e.key === 'Escape') {
                setShowAddInput(false);
                setNewName('');
              }
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={handleAdd}
          >
            Add
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              setShowAddInput(false);
              setNewName('');
            }}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs text-muted-foreground"
          onClick={() => setShowAddInput(true)}
        >
          <Plus className="h-3 w-3" />
          Add {formatFieldName(blockType)}
        </Button>
      )}
    </div>
  );
}
