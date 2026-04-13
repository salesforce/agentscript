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
import { VscChevronDown, VscChevronRight, VscTrash } from 'react-icons/vsc';
import { PiDotsSixVerticalBold } from 'react-icons/pi';
import type { FieldType } from '@agentscript/language';
import type { Diagnostic, Range, Comment } from '@agentscript/types';
import { leadingComments, trailingComments } from '@agentscript/language';
import { formatFieldName, getSchemaFields } from '~/lib/schema-introspection';
import { DiagnosticBadge } from './DiagnosticBadge';
import { CommentEditor } from './CommentEditor';
import { FieldRenderer } from './FieldRenderer';
import { useFieldDiagnostics } from './hooks/useFieldDiagnostics';
import { useSortable } from '@dnd-kit/sortable';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NamedBlockLike {
  __kind?: string;
  __name?: string;
  __cst?: { range?: Range };
  __diagnostics?: Diagnostic[];
  __comments?: Comment[];
  [key: string]: unknown;
}

interface NamedBlockCardProps {
  id: string;
  blockType: string;
  instance: NamedBlockLike;
  schema: Record<string, FieldType>;
  allDiagnostics: Diagnostic[];
  onScalarChange: (fieldPath: string, value: string | number | boolean) => void;
  onRename?: (oldName: string, newName: string) => void;
  onDelete?: (name: string) => void;
  renderCompound?: (
    fieldInfo: import('~/lib/schema-introspection').SchemaFieldInfo,
    value: unknown,
    parentPath: string
  ) => React.ReactNode;
  sortable?: boolean;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NamedBlockCard({
  id,
  blockType,
  instance,
  schema,
  allDiagnostics,
  onScalarChange,
  onRename,
  onDelete,
  renderCompound,
  sortable = false,
  className,
}: NamedBlockCardProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(instance.__name ?? '');

  const name = instance.__name ?? 'unnamed';
  const range = instance.__cst?.range;
  const blockDiags = useFieldDiagnostics(allDiagnostics, range);
  const schemaFields = getSchemaFields(schema);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !sortable });

  const style: React.CSSProperties = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  const handleNameSave = () => {
    setEditingName(false);
    if (nameValue && nameValue !== name) {
      onRename?.(name, nameValue);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group/block rounded-lg border border-border/70 bg-card shadow-sm',
        isDragging && 'shadow-lg',
        className
      )}
    >
      {/* Header */}
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2 select-none',
          'hover:bg-muted/50 rounded-t-lg transition-colors',
          collapsed && 'rounded-b-lg'
        )}
      >
        {sortable && (
          <span
            className="cursor-grab text-muted-foreground hover:text-foreground"
            {...attributes}
            {...listeners}
          >
            <PiDotsSixVerticalBold className="h-4 w-4" />
          </span>
        )}
        <button
          className="flex items-center gap-1.5"
          onClick={() => setCollapsed(prev => !prev)}
        >
          {collapsed ? (
            <VscChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <VscChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span className="text-xs font-medium text-muted-foreground">
            {formatFieldName(blockType)}
          </span>
        </button>

        {editingName ? (
          <Input
            value={nameValue}
            onChange={e => setNameValue(e.target.value)}
            onBlur={handleNameSave}
            onKeyDown={e => {
              if (e.key === 'Enter') handleNameSave();
              if (e.key === 'Escape') {
                setNameValue(name);
                setEditingName(false);
              }
            }}
            autoFocus
            className="h-6 w-40 text-sm font-semibold"
          />
        ) : (
          <span
            className="cursor-text text-sm font-semibold hover:underline"
            onClick={() => {
              setNameValue(name);
              setEditingName(true);
            }}
            title="Click to rename"
          >
            {name}
          </span>
        )}

        <DiagnosticBadge diagnostics={blockDiags} />
        <div className="flex-1" />
        {onDelete && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground opacity-0 transition-opacity group-hover/block:opacity-100 hover:text-red-500"
            onClick={() => onDelete(name)}
            title={`Remove ${name}`}
          >
            <VscTrash className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Body */}
      {!collapsed && (
        <div className="space-y-3 px-3 pb-3">
          <CommentEditor
            comments={leadingComments(instance)}
            position="leading"
          />

          {schemaFields.map(fieldInfo => {
            const fieldValue = instance[fieldInfo.name];

            const fieldPath = `${blockType}.${name}.${fieldInfo.name}`;

            return (
              <FieldRenderer
                key={fieldInfo.name}
                fieldInfo={fieldInfo}
                value={fieldValue}
                isUnset={fieldValue === undefined}
                allDiagnostics={allDiagnostics}
                onScalarChange={(_, newVal) =>
                  onScalarChange(fieldPath, newVal)
                }
                renderCompound={
                  renderCompound
                    ? (fi, v) => renderCompound(fi, v, `${blockType}.${name}`)
                    : undefined
                }
              />
            );
          })}

          <CommentEditor
            comments={trailingComments(instance)}
            position="trailing"
          />
        </div>
      )}
    </div>
  );
}
