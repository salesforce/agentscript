/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useState } from 'react';
import { cn } from '~/lib/utils';
import { Input } from '~/components/ui/input';

interface AvailableWhenEditorProps {
  condition: string;
  onConditionChange: (condition: string) => void;
  className?: string;
}

export function AvailableWhenEditor({
  condition,
  onConditionChange,
  className,
}: AvailableWhenEditorProps) {
  const [localCondition, setLocalCondition] = useState(condition);

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
        available when
      </span>
      <Input
        value={localCondition}
        onChange={e => setLocalCondition(e.target.value)}
        onBlur={() => onConditionChange(localCondition)}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onConditionChange(localCondition);
          }
        }}
        placeholder="condition expression"
        className="h-7 flex-1 font-mono text-xs"
      />
    </div>
  );
}
