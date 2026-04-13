/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useState, useCallback } from 'react';
import { Input } from '~/components/ui/input';
import { cn } from '~/lib/utils';
import type { ConstraintMetadata } from '@agentscript/language';

interface NumberFieldProps {
  value: number;
  onChange: (value: number) => void;
  placeholder?: string;
  constraints?: ConstraintMetadata;
  disabled?: boolean;
  hasError?: boolean;
  className?: string;
}

export function NumberField({
  value,
  onChange,
  placeholder,
  constraints,
  disabled,
  hasError,
  className,
}: NumberFieldProps) {
  const [localValue, setLocalValue] = useState(String(value));
  const [validationError, setValidationError] = useState<string | null>(null);

  const validate = useCallback(
    (v: number): string | null => {
      if (!constraints) return null;
      if (isNaN(v)) return 'Must be a number';
      if (constraints.minimum !== undefined && v < constraints.minimum) {
        return `Minimum is ${constraints.minimum}`;
      }
      if (constraints.maximum !== undefined && v > constraints.maximum) {
        return `Maximum is ${constraints.maximum}`;
      }
      if (
        constraints.exclusiveMinimum !== undefined &&
        v <= constraints.exclusiveMinimum
      ) {
        return `Must be greater than ${constraints.exclusiveMinimum}`;
      }
      if (
        constraints.exclusiveMaximum !== undefined &&
        v >= constraints.exclusiveMaximum
      ) {
        return `Must be less than ${constraints.exclusiveMaximum}`;
      }
      if (
        constraints.multipleOf !== undefined &&
        v % constraints.multipleOf !== 0
      ) {
        return `Must be a multiple of ${constraints.multipleOf}`;
      }
      return null;
    },
    [constraints]
  );

  const handleChange = (raw: string) => {
    setLocalValue(raw);
    const num = Number(raw);
    setValidationError(validate(num));
  };

  const handleBlur = () => {
    const num = Number(localValue);
    if (!isNaN(num) && !validationError) {
      onChange(num);
    }
  };

  return (
    <div className={cn('flex flex-col', className)}>
      <Input
        type="number"
        value={localValue}
        onChange={e => handleChange(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            handleBlur();
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={hasError || !!validationError}
        min={constraints?.minimum ?? constraints?.exclusiveMinimum}
        max={constraints?.maximum ?? constraints?.exclusiveMaximum}
        step={constraints?.multipleOf}
        className={cn(
          'h-8 text-sm',
          (hasError || validationError) && 'border-red-500'
        )}
      />
      {validationError && (
        <p className="mt-0.5 text-xs text-red-500">{validationError}</p>
      )}
    </div>
  );
}
