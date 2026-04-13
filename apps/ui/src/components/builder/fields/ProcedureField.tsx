/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { cn } from '~/lib/utils';
import type { Diagnostic } from '@agentscript/types';
import { StatementList } from '../statements/StatementList';
import type { StatementKind } from '../statements/AddStatementMenu';

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
  statements?: StatementLike[];
  [key: string]: unknown;
}

interface ProcedureFieldProps {
  value: StatementLike | undefined;
  allDiagnostics: Diagnostic[];
  fieldPath: string;
  onStatementDelete: (fieldPath: string, index: number) => void;
  onStatementReorder: (
    fieldPath: string,
    fromIndex: number,
    toIndex: number
  ) => void;
  onStatementAdd: (
    fieldPath: string,
    kind: StatementKind,
    afterIndex: number
  ) => void;
  onStatementUpdate: (
    fieldPath: string,
    index: number,
    field: string,
    value: string
  ) => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProcedureField({
  value,
  allDiagnostics,
  fieldPath,
  onStatementDelete,
  onStatementReorder,
  onStatementAdd,
  onStatementUpdate,
  className,
}: ProcedureFieldProps) {
  const statements = (value?.statements ?? []) as StatementLike[];

  return (
    <div
      className={cn(
        'rounded border border-border/30 bg-muted/20 p-2',
        className
      )}
    >
      <StatementList
        statements={statements}
        allDiagnostics={allDiagnostics}
        onDelete={index => onStatementDelete(fieldPath, index)}
        onReorder={(from, to) => onStatementReorder(fieldPath, from, to)}
        onAdd={(kind, afterIndex) =>
          onStatementAdd(fieldPath, kind, afterIndex)
        }
        onUpdate={(index, field, val) =>
          onStatementUpdate(fieldPath, index, field, val)
        }
      />
    </div>
  );
}
