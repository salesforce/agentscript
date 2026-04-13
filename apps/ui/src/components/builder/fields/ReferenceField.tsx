/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useState } from 'react';
import { Input } from '~/components/ui/input';
import { cn } from '~/lib/utils';

interface ReferenceFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  hasError?: boolean;
  className?: string;
}

/**
 * Input for @-reference expressions (e.g., @Topic.main).
 * Accepts raw expression text; future: autocomplete from symbol table.
 */
export function ReferenceField({
  value,
  onChange,
  placeholder = '@...',
  disabled,
  hasError,
  className,
}: ReferenceFieldProps) {
  const [localValue, setLocalValue] = useState(value);

  return (
    <div className={cn('flex flex-col', className)}>
      <Input
        value={localValue}
        onChange={e => setLocalValue(e.target.value)}
        onBlur={() => onChange(localValue)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onChange(localValue);
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={hasError}
        className={cn('h-8 font-mono text-sm', hasError && 'border-red-500')}
      />
    </div>
  );
}
