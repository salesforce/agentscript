/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { cn } from '~/lib/utils';
import type { Diagnostic } from '@agentscript/types';

interface StatementLike {
  __kind: string;
  [key: string]: unknown;
}

interface TransitionEditorProps {
  clauses: StatementLike[];
  allDiagnostics: Diagnostic[];
  renderStatements: (
    statements: StatementLike[],
    prefix: string
  ) => React.ReactNode;
  className?: string;
}

/**
 * Editor for transition statements: `transition to/with` clauses.
 */
export function TransitionEditor({
  clauses,
  allDiagnostics: _allDiagnostics,
  renderStatements,
  className,
}: TransitionEditorProps) {
  return (
    <div className={cn('space-y-1', className)}>
      <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
        transition
      </span>
      <div className="ml-4 border-l-2 border-indigo-200 pl-3 dark:border-indigo-800">
        {renderStatements(clauses, 'transition')}
      </div>
    </div>
  );
}
