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
import { VscAdd } from 'react-icons/vsc';
import type { FieldType } from '@agentscript/language';
import {
  getAvailableBlocks,
  formatFieldName,
  getBlockDescription,
} from '~/lib/schema-introspection';

interface AddBlockMenuProps {
  schema: Record<string, FieldType>;
  existingKeys: Set<string>;
  onAdd: (blockKey: string) => void;
  className?: string;
}

export function AddBlockMenu({
  schema,
  existingKeys,
  onAdd,
  className,
}: AddBlockMenuProps) {
  const available = getAvailableBlocks(schema, existingKeys);

  if (available.length === 0) return null;

  return (
    <div className={cn('flex justify-center py-2', className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 border-dashed text-muted-foreground hover:text-foreground"
          >
            <VscAdd className="h-3.5 w-3.5" />
            Add Block
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="w-64">
          {available.map(({ key, fieldInfo }) => (
            <DropdownMenuItem
              key={key}
              onClick={() => onAdd(key)}
              className="flex flex-col items-start gap-0.5"
            >
              <span className="font-medium">{formatFieldName(key)}</span>
              {getBlockDescription(fieldInfo) && (
                <span className="text-xs text-muted-foreground">
                  {getBlockDescription(fieldInfo)}
                </span>
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
