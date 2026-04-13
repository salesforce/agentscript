/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { cn } from '~/lib/utils';
import { Button } from '~/components/ui/button';
import { VscTrash } from 'react-icons/vsc';
import { PiDotsSixVerticalBold } from 'react-icons/pi';
import type { Diagnostic, Range, Comment } from '@agentscript/types';
import { DiagnosticBadge, DiagnosticMessages } from '../DiagnosticBadge';
import { useFieldDiagnostics } from '../hooks/useFieldDiagnostics';
import { useSortable } from '@dnd-kit/sortable';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StatementLike {
  __kind: string;
  __cst?: { range?: Range };
  __diagnostics?: Diagnostic[];
  __comments?: Comment[];
}

interface StatementCardProps {
  id: string;
  statement: StatementLike;
  allDiagnostics: Diagnostic[];
  onDelete: () => void;
  sortable?: boolean;
  children: React.ReactNode;
  className?: string;
}

// ---------------------------------------------------------------------------
// Badge color for statement types
// ---------------------------------------------------------------------------

const kindColors: Record<string, string> = {
  Template: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  IfStatement:
    'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  RunStatement:
    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  SetClause:
    'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  WithClause:
    'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
  ToClause: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
  AvailableWhen:
    'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  TransitionStatement:
    'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
};

function kindLabel(kind: string): string {
  switch (kind) {
    case 'Template':
      return 'template';
    case 'IfStatement':
      return 'if';
    case 'RunStatement':
      return 'run';
    case 'SetClause':
      return 'set';
    case 'WithClause':
      return 'with';
    case 'ToClause':
      return 'to';
    case 'AvailableWhen':
      return 'available when';
    case 'TransitionStatement':
      return 'transition';
    default:
      return kind;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StatementCard({
  id,
  statement,
  allDiagnostics,
  onDelete,
  sortable: isSortable = false,
  children,
  className,
}: StatementCardProps) {
  const range = statement.__cst?.range;
  const nodeDiags = useFieldDiagnostics(allDiagnostics, range);
  const ownDiags = (statement.__diagnostics as Diagnostic[]) ?? [];
  const combinedDiags = [...nodeDiags, ...ownDiags];

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !isSortable });

  const style: React.CSSProperties = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group/stmt rounded border border-border/50 bg-card/80 p-2',
        isDragging && 'shadow-md',
        className
      )}
    >
      <div className="mb-1.5 flex items-center gap-1.5">
        {isSortable && (
          <span
            className="cursor-grab text-muted-foreground hover:text-foreground"
            {...attributes}
            {...listeners}
          >
            <PiDotsSixVerticalBold className="h-3.5 w-3.5" />
          </span>
        )}
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-[10px] font-medium',
            kindColors[statement.__kind] ?? 'bg-muted text-muted-foreground'
          )}
        >
          {kindLabel(statement.__kind)}
        </span>
        <DiagnosticBadge diagnostics={combinedDiags} />
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 text-muted-foreground opacity-0 group-hover/stmt:opacity-100 hover:text-red-500"
          onClick={onDelete}
        >
          <VscTrash className="h-3 w-3" />
        </Button>
      </div>

      {children}

      <DiagnosticMessages diagnostics={combinedDiags} />
    </div>
  );
}
