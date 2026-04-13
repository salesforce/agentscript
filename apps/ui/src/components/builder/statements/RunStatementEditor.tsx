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
  [key: string]: unknown;
}

interface RunStatementEditorProps {
  target: string;
  body: StatementLike[];
  allDiagnostics: Diagnostic[];
  onTargetChange: (target: string) => void;
  renderStatements: (
    statements: StatementLike[],
    prefix: string
  ) => React.ReactNode;
  className?: string;
}

/**
 * Editor for run statements: `run action_name` with optional body clauses.
 */
export function RunStatementEditor({
  target,
  body,
  allDiagnostics: _allDiagnostics,
  onTargetChange,
  renderStatements,
  className,
}: RunStatementEditorProps) {
  const [localTarget, setLocalTarget] = useState(target);

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-green-600 dark:text-green-400">
          run
        </span>
        <Input
          value={localTarget}
          onChange={e => setLocalTarget(e.target.value)}
          onBlur={() => onTargetChange(localTarget)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onTargetChange(localTarget);
            }
          }}
          placeholder="action name"
          className="h-7 flex-1 font-mono text-xs"
        />
      </div>

      {body.length > 0 && (
        <div className="ml-4 border-l-2 border-green-200 pl-3 dark:border-green-800">
          {renderStatements(body, 'run-body')}
        </div>
      )}
    </div>
  );
}
