/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { cn } from '~/lib/utils';
import { Button } from '~/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import { Plus } from 'lucide-react';

export type StatementKind =
  | 'template'
  | 'if'
  | 'run'
  | 'set'
  | 'with'
  | 'to'
  | 'available_when'
  | 'transition';

const statementOptions: Array<{
  kind: StatementKind;
  label: string;
  description: string;
}> = [
  {
    kind: 'template',
    label: 'Template',
    description: 'Text with optional interpolations',
  },
  { kind: 'if', label: 'If / Else', description: 'Conditional branch' },
  { kind: 'run', label: 'Run', description: 'Execute an action' },
  { kind: 'set', label: 'Set', description: 'Assign a value to a variable' },
  { kind: 'with', label: 'With', description: 'Pass a parameter' },
  { kind: 'to', label: 'To', description: 'Navigate to a topic' },
  {
    kind: 'available_when',
    label: 'Available When',
    description: 'Conditional availability',
  },
  {
    kind: 'transition',
    label: 'Transition',
    description: 'Topic transition with clauses',
  },
];

interface AddStatementMenuProps {
  onAdd: (kind: StatementKind) => void;
  className?: string;
}

export function AddStatementMenu({ onAdd, className }: AddStatementMenuProps) {
  return (
    <div className={cn('flex justify-start', className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 text-xs text-muted-foreground"
          >
            <Plus className="h-3 w-3" />
            Add Statement
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {statementOptions.map(opt => (
            <DropdownMenuItem
              key={opt.kind}
              onClick={() => onAdd(opt.kind)}
              className="flex flex-col items-start gap-0.5"
            >
              <span className="font-medium">{opt.label}</span>
              <span className="text-xs text-muted-foreground">
                {opt.description}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
