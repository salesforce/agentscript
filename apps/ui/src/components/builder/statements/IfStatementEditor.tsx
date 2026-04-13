/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useState } from 'react';
import { cn } from '~/lib/utils';
import { Input } from '~/components/ui/input';
import type { Diagnostic } from '@agentscript/types';

interface StatementLike {
  __kind: string;
  __cst?: {
    range?: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
  };
  __diagnostics?: Diagnostic[];
  condition?: { __emit?: (ctx: { indent: number }) => string };
  body?: StatementLike[];
  orelse?: StatementLike[];
  [key: string]: unknown;
}

interface IfStatementEditorProps {
  statement: StatementLike;
  allDiagnostics: Diagnostic[];
  onUpdate: (conditionText: string) => void;
  renderStatements: (
    statements: StatementLike[],
    prefix: string
  ) => React.ReactNode;
  className?: string;
}

/**
 * Visual editor for if/elif/else statements.
 * Shows collapsible branches with expression inputs for conditions.
 */
export function IfStatementEditor({
  statement,
  allDiagnostics,
  onUpdate,
  renderStatements,
  className,
}: IfStatementEditorProps) {
  const conditionText = statement.condition?.__emit?.({ indent: 0 }) ?? '';
  const [localCondition, setLocalCondition] = useState(conditionText);

  const body = (statement.body ?? []) as StatementLike[];
  const orelse = (statement.orelse ?? []) as StatementLike[];

  // Check if orelse is an elif (single IfStatement)
  const isElif = orelse.length === 1 && orelse[0].__kind === 'IfStatement';

  return (
    <div className={cn('space-y-2', className)}>
      {/* Condition */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-purple-600 dark:text-purple-400">
          if
        </span>
        <Input
          value={localCondition}
          onChange={e => setLocalCondition(e.target.value)}
          onBlur={() => onUpdate(localCondition)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onUpdate(localCondition);
            }
          }}
          placeholder="condition expression"
          className="h-7 flex-1 font-mono text-xs"
        />
      </div>

      {/* Body (then branch) */}
      <div className="ml-4 border-l-2 border-purple-200 pl-3 dark:border-purple-800">
        {body.length > 0 ? (
          renderStatements(body, 'if-body')
        ) : (
          <p className="py-1 text-xs italic text-muted-foreground">
            Empty — add statements below
          </p>
        )}
      </div>

      {/* Elif branches */}
      {isElif && (
        <IfStatementEditor
          statement={orelse[0]}
          allDiagnostics={allDiagnostics}
          onUpdate={onUpdate}
          renderStatements={renderStatements}
        />
      )}

      {/* Else branch */}
      {!isElif && orelse.length > 0 && (
        <>
          <span className="text-xs font-medium text-purple-600 dark:text-purple-400">
            else
          </span>
          <div className="ml-4 border-l-2 border-purple-200 pl-3 dark:border-purple-800">
            {renderStatements(orelse, 'else-body')}
          </div>
        </>
      )}
    </div>
  );
}
