/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { cn } from '~/lib/utils';
import type { Diagnostic } from '@agentscript/types';
import { StatementCard } from './StatementCard';
import { TemplateStatement } from './TemplateStatement';
import { IfStatementEditor } from './IfStatementEditor';
import { RunStatementEditor } from './RunStatementEditor';
import { SetClauseEditor } from './SetClauseEditor';
import { WithClauseEditor } from './WithClauseEditor';
import { TransitionEditor } from './TransitionEditor';
import { AvailableWhenEditor } from './AvailableWhenEditor';
import { AddStatementMenu, type StatementKind } from './AddStatementMenu';
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

interface StatementLike {
  __kind: string;
  __cst?: {
    range?: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
  };
  __diagnostics?: Diagnostic[];
  // Template
  content?: string;
  parts?: Array<{ __emit?: (ctx: { indent: number }) => string }>;
  // If
  condition?: { __emit?: (ctx: { indent: number }) => string };
  body?: StatementLike[];
  orelse?: StatementLike[];
  // Run
  target?: { __emit?: (ctx: { indent: number }) => string };
  // Set
  value?: { __emit?: (ctx: { indent: number }) => string };
  // With
  param?: string;
  // Transition
  clauses?: StatementLike[];
  [key: string]: unknown;
}

function emitExpr(
  expr: { __emit?: (ctx: { indent: number }) => string } | undefined
): string {
  return expr?.__emit?.({ indent: 0 }) ?? '';
}

function getStatementId(stmt: StatementLike, index: number): string {
  const line = stmt.__cst?.range?.start.line;
  return line !== undefined ? `stmt-${line}-${index}` : `stmt-${index}`;
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface StatementListProps {
  statements: StatementLike[];
  allDiagnostics: Diagnostic[];
  onDelete: (index: number) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onAdd: (kind: StatementKind, afterIndex: number) => void;
  onUpdate: (index: number, field: string, value: string) => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StatementList({
  statements,
  allDiagnostics,
  onDelete,
  onReorder,
  onAdd,
  onUpdate,
  className,
}: StatementListProps) {
  const ids = statements.map((s, i) => getStatementId(s, i));
  const sortable = statements.length > 1;

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex !== -1 && newIndex !== -1) {
      onReorder(oldIndex, newIndex);
    }
  };

  /** Recursive render for nested statement lists (if body, run body, etc.) */
  const renderStatements = (stmts: StatementLike[], prefix: string) => (
    <div className="space-y-1.5">
      {stmts.map((stmt, i) => (
        <StatementContent
          key={`${prefix}-${i}`}
          statement={stmt}
          allDiagnostics={allDiagnostics}
          renderStatements={renderStatements}
        />
      ))}
    </div>
  );

  return (
    <div className={cn('space-y-1.5', className)}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {statements.map((stmt, i) => (
            <StatementCard
              key={ids[i]}
              id={ids[i]}
              statement={stmt}
              allDiagnostics={allDiagnostics}
              onDelete={() => onDelete(i)}
              sortable={sortable}
            >
              <StatementContent
                statement={stmt}
                allDiagnostics={allDiagnostics}
                onUpdate={(field, value) => onUpdate(i, field, value)}
                renderStatements={renderStatements}
              />
            </StatementCard>
          ))}
        </SortableContext>
      </DndContext>

      <AddStatementMenu onAdd={kind => onAdd(kind, statements.length)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Statement content renderer — dispatches to the correct editor
// ---------------------------------------------------------------------------

function StatementContent({
  statement,
  allDiagnostics,
  onUpdate,
  renderStatements,
}: {
  statement: StatementLike;
  allDiagnostics: Diagnostic[];
  onUpdate?: (field: string, value: string) => void;
  renderStatements: (stmts: StatementLike[], prefix: string) => React.ReactNode;
}) {
  const handleUpdate = (field: string, value: string) => {
    onUpdate?.(field, value);
  };

  switch (statement.__kind) {
    case 'Template': {
      const content =
        typeof statement.content === 'string'
          ? statement.content
          : (statement.parts?.map(p => emitExpr(p)).join('') ?? '');
      return (
        <TemplateStatement
          content={content}
          onChange={v => handleUpdate('content', v)}
        />
      );
    }

    case 'IfStatement':
      return (
        <IfStatementEditor
          statement={statement}
          allDiagnostics={allDiagnostics}
          onUpdate={v => handleUpdate('condition', v)}
          renderStatements={renderStatements}
        />
      );

    case 'RunStatement':
      return (
        <RunStatementEditor
          target={emitExpr(statement.target)}
          body={(statement.body ?? []) as StatementLike[]}
          allDiagnostics={allDiagnostics}
          onTargetChange={v => handleUpdate('target', v)}
          renderStatements={renderStatements}
        />
      );

    case 'SetClause':
      return (
        <SetClauseEditor
          target={emitExpr(statement.target)}
          value={emitExpr(statement.value)}
          onTargetChange={v => handleUpdate('target', v)}
          onValueChange={v => handleUpdate('value', v)}
        />
      );

    case 'WithClause':
      return (
        <WithClauseEditor
          param={typeof statement.param === 'string' ? statement.param : ''}
          value={emitExpr(statement.value)}
          onParamChange={v => handleUpdate('param', v)}
          onValueChange={v => handleUpdate('value', v)}
        />
      );

    case 'ToClause':
      return (
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-cyan-600 dark:text-cyan-400">
            to
          </span>
          <span className="font-mono text-xs">
            {emitExpr(statement.target)}
          </span>
        </div>
      );

    case 'AvailableWhen':
      return (
        <AvailableWhenEditor
          condition={emitExpr(statement.condition)}
          onConditionChange={v => handleUpdate('condition', v)}
        />
      );

    case 'TransitionStatement':
      return (
        <TransitionEditor
          clauses={(statement.clauses ?? []) as StatementLike[]}
          allDiagnostics={allDiagnostics}
          renderStatements={renderStatements}
        />
      );

    default:
      return (
        <p className="text-xs italic text-muted-foreground">
          Unknown statement: {statement.__kind}
        </p>
      );
  }
}
