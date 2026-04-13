/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { Switch } from '~/components/ui/switch';
import { cn } from '~/lib/utils';

interface BooleanFieldProps {
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export function BooleanField({
  value,
  onChange,
  disabled,
  className,
}: BooleanFieldProps) {
  return (
    <div className={cn('flex items-center', className)}>
      <Switch checked={value} onCheckedChange={onChange} disabled={disabled} />
      <span className="ml-2 text-xs text-muted-foreground">
        {value ? 'True' : 'False'}
      </span>
    </div>
  );
}
