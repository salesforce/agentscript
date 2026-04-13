/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useState } from 'react';
import { cn } from '~/lib/utils';
import { Input } from '~/components/ui/input';

interface WithClauseEditorProps {
  param: string;
  value: string;
  onParamChange: (param: string) => void;
  onValueChange: (value: string) => void;
  className?: string;
}

export function WithClauseEditor({
  param,
  value,
  onParamChange,
  onValueChange,
  className,
}: WithClauseEditorProps) {
  const [localParam, setLocalParam] = useState(param);
  const [localValue, setLocalValue] = useState(value);

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <span className="text-xs font-medium text-teal-600 dark:text-teal-400">
        with
      </span>
      <Input
        value={localParam}
        onChange={e => setLocalParam(e.target.value)}
        onBlur={() => onParamChange(localParam)}
        placeholder="param"
        className="h-7 w-32 font-mono text-xs"
      />
      <span className="text-xs text-muted-foreground">=</span>
      <Input
        value={localValue}
        onChange={e => setLocalValue(e.target.value)}
        onBlur={() => onValueChange(localValue)}
        placeholder="value"
        className="h-7 flex-1 font-mono text-xs"
      />
    </div>
  );
}
