/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useState } from 'react';
import { cn } from '~/lib/utils';
import { Input } from '~/components/ui/input';

interface SetClauseEditorProps {
  target: string;
  value: string;
  onTargetChange: (target: string) => void;
  onValueChange: (value: string) => void;
  className?: string;
}

export function SetClauseEditor({
  target,
  value,
  onTargetChange,
  onValueChange,
  className,
}: SetClauseEditorProps) {
  const [localTarget, setLocalTarget] = useState(target);
  const [localValue, setLocalValue] = useState(value);

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <span className="text-xs font-medium text-orange-600 dark:text-orange-400">
        set
      </span>
      <Input
        value={localTarget}
        onChange={e => setLocalTarget(e.target.value)}
        onBlur={() => onTargetChange(localTarget)}
        placeholder="target"
        className="h-7 w-40 font-mono text-xs"
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
