/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useState, useCallback } from 'react';
import { Input } from '~/components/ui/input';
import { Textarea } from '~/components/ui/textarea';
import { cn } from '~/lib/utils';
import type { ConstraintMetadata } from '@agentscript/language';

interface StringFieldProps {
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
  constraints?: ConstraintMetadata;
  disabled?: boolean;
  hasError?: boolean;
  className?: string;
}

export function StringField({
  value,
  onChange,
  multiline = false,
  placeholder,
  constraints,
  disabled,
  hasError,
  className,
}: StringFieldProps) {
  const [localValue, setLocalValue] = useState(value);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Sync from parent when value prop changes
  if (
    value !== localValue &&
    document.activeElement?.closest('[data-string-field]') === null
  ) {
    setLocalValue(value);
  }

  const validate = useCallback(
    (v: string): string | null => {
      if (!constraints) return null;
      if (
        constraints.maxLength !== undefined &&
        v.length > constraints.maxLength
      ) {
        return `Maximum length is ${constraints.maxLength}`;
      }
      if (
        constraints.minLength !== undefined &&
        v.length < constraints.minLength
      ) {
        return `Minimum length is ${constraints.minLength}`;
      }
      if (constraints.pattern) {
        try {
          const re = new RegExp(constraints.pattern);
          if (!re.test(v)) return `Must match pattern: ${constraints.pattern}`;
        } catch {
          // Invalid pattern — skip validation
        }
      }
      return null;
    },
    [constraints]
  );

  const handleChange = (newValue: string) => {
    setLocalValue(newValue);
    setValidationError(validate(newValue));
  };

  const handleBlur = () => {
    if (!validationError) {
      onChange(localValue);
    }
  };

  const sharedProps = {
    'data-string-field': true,
    value: localValue,
    placeholder,
    disabled,
    'aria-invalid': hasError || !!validationError,
    onBlur: handleBlur,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !multiline) {
        e.preventDefault();
        if (!validationError) {
          onChange(localValue);
        }
      }
    },
  };

  return (
    <div className={cn('flex flex-col', className)}>
      {multiline ? (
        <Textarea
          {...sharedProps}
          onChange={e => handleChange(e.target.value)}
          className={cn(
            'min-h-[60px] font-mono text-sm',
            (hasError || validationError) && 'border-red-500'
          )}
        />
      ) : (
        <Input
          {...sharedProps}
          onChange={e => handleChange(e.target.value)}
          className={cn(
            'h-8 text-sm',
            (hasError || validationError) && 'border-red-500'
          )}
        />
      )}
      {validationError && (
        <p className="mt-0.5 text-xs text-red-500">{validationError}</p>
      )}
      {constraints?.maxLength !== undefined && (
        <p className="mt-0.5 text-right text-xs text-muted-foreground">
          {localValue.length}/{constraints.maxLength}
        </p>
      )}
    </div>
  );
}
