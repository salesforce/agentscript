/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useState, useCallback } from 'react';
import { cn } from '~/lib/utils';
import { Button } from '~/components/ui/button';
import { VscChevronDown, VscChevronRight, VscTrash } from 'react-icons/vsc';
import { PiDotsSixVerticalBold } from 'react-icons/pi';
import {
  leadingComments,
  trailingComments,
  type FieldType,
} from '@agentscript/language';
import {
  DiagnosticSeverity,
  type Diagnostic,
  type Range,
  type Comment,
} from '@agentscript/types';
import { formatFieldName, getSchemaFields } from '~/lib/schema-introspection';
import { DiagnosticBadge } from './DiagnosticBadge';
import { CommentEditor } from './CommentEditor';
import { FieldRenderer } from './FieldRenderer';
import { useFieldDiagnostics } from './hooks/useFieldDiagnostics';
import { useSortable } from '@dnd-kit/sortable';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BlockLike {
  __kind?: string;
  __cst?: { range?: Range };
  __diagnostics?: Diagnostic[];
  __comments?: Comment[];
  [key: string]: unknown;
}

interface BlockCardProps {
  id: string;
  blockName: string;
  value: BlockLike;
  schema: Record<string, FieldType>;
  allDiagnostics: Diagnostic[];
  onScalarChange: (fieldPath: string, value: string | number | boolean) => void;
  onDelete?: () => void;
  /** Render prop for compound sub-fields. */
  renderCompound?: (
    fieldInfo: import('~/lib/schema-introspection').SchemaFieldInfo,
    value: unknown,
    parentPath: string
  ) => React.ReactNode;
  /** Nested depth — controls visual indent. */
  depth?: number;
  /** Whether this card is sortable via DnD. */
  sortable?: boolean;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BlockCard({
  id,
  blockName,
  value,
  schema,
  allDiagnostics,
  onScalarChange,
  onDelete,
  renderCompound,
  depth = 0,
  sortable = false,
  className,
}: BlockCardProps) {
  const [collapsed, setCollapsed] = useState(false);

  const range = value?.__cst?.range;
  const blockDiags = useFieldDiagnostics(allDiagnostics, range);
  const hasBlockErrors = blockDiags.some(
    d => d.severity === DiagnosticSeverity.Error
  );
  const hasBlockWarnings = blockDiags.some(
    d => d.severity === DiagnosticSeverity.Warning
  );
  const schemaFields = getSchemaFields(schema);

  // DnD sortable (only active when sortable=true)
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

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setCollapsed(prev => !prev);
    }
    if (e.key === 'ArrowLeft') setCollapsed(true);
    if (e.key === 'ArrowRight') setCollapsed(false);
  }, []);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group/block rounded-lg border bg-card text-card-foreground shadow-sm',
        hasBlockErrors
          ? 'border-red-400 dark:border-red-500'
          : hasBlockWarnings
            ? 'border-amber-400 dark:border-amber-500'
            : depth === 0
              ? 'border-border'
              : 'border-border/50',
        depth > 0 && !hasBlockErrors && !hasBlockWarnings && 'bg-card/50',
        isDragging && 'shadow-lg',
        className
      )}
    >
      {/* Header */}
      <div
        role="button"
        tabIndex={0}
        className={cn(
          'flex items-center gap-2 px-3 py-2 select-none',
          'hover:bg-muted/50 rounded-t-lg transition-colors',
          collapsed && 'rounded-b-lg'
        )}
        onClick={() => setCollapsed(prev => !prev)}
        onKeyDown={handleKeyDown}
        aria-expanded={!collapsed}
        aria-label={`${formatFieldName(blockName)} block`}
      >
        {sortable && (
          <span
            className="cursor-grab text-muted-foreground hover:text-foreground"
            {...attributes}
            {...listeners}
            onClick={e => e.stopPropagation()}
          >
            <PiDotsSixVerticalBold className="h-4 w-4" />
          </span>
        )}
        {collapsed ? (
          <VscChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <VscChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="text-sm font-medium">
          {formatFieldName(blockName)}
        </span>
        <DiagnosticBadge diagnostics={blockDiags} />
        <div className="flex-1" />
        {onDelete && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground opacity-0 transition-opacity group-hover/block:opacity-100 hover:text-red-500"
            onClick={e => {
              e.stopPropagation();
              onDelete();
            }}
            title={`Remove ${formatFieldName(blockName)}`}
          >
            <VscTrash className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Body */}
      {!collapsed && (
        <div className="space-y-3 px-3 pb-3">
          <CommentEditor comments={leadingComments(value)} position="leading" />

          {schemaFields.map(fieldInfo => {
            const fieldValue = value[fieldInfo.name];

            const fieldPath = blockName + '.' + fieldInfo.name;

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
                    ? (fi, v) => renderCompound(fi, v, blockName)
                    : undefined
                }
              />
            );
          })}

          <CommentEditor
            comments={trailingComments(value)}
            position="trailing"
          />
        </div>
      )}
    </div>
  );
}
