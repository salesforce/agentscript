/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import { Button } from '~/components/ui/button';
import { cn } from '~/lib/utils';
import { ChevronDown } from 'lucide-react';

interface EnumFieldProps {
  value: string | number | boolean | undefined;
  options: ReadonlyArray<string | number | boolean>;
  onChange: (value: string | number | boolean) => void;
  placeholder?: string;
  disabled?: boolean;
  hasError?: boolean;
  className?: string;
}

export function EnumField({
  value,
  options,
  onChange,
  placeholder = 'Select...',
  disabled,
  hasError,
  className,
}: EnumFieldProps) {
  const displayValue = value !== undefined ? String(value) : placeholder;

  return (
    <div className={cn('flex flex-col', className)}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            className={cn(
              'h-8 justify-between font-normal',
              value === undefined && 'text-muted-foreground',
              hasError && 'border-red-500'
            )}
          >
            <span className="truncate">{displayValue}</span>
            <ChevronDown className="ml-2 h-3 w-3 shrink-0 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-60 overflow-auto">
          {options.map(option => (
            <DropdownMenuItem
              key={String(option)}
              onClick={() => onChange(option)}
            >
              <span>{String(option)}</span>
              {option === value && <span className="ml-auto text-sm">✓</span>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
