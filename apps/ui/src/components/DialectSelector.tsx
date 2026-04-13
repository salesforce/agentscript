/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useState, useCallback } from 'react';
import { useAppStore } from '~/store';
import { dialects } from '~/lib/dialects';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Button } from '~/components/ui/button';
import { ChevronDownIcon } from 'lucide-react';
import {
  detectDialectId,
  getDialectInfo,
  setDialectAnnotation,
} from '~/lib/detect-dialect';

export function DialectSelector() {
  const agentscript = useAppStore(state => state.source.agentscript);
  const setAgentScript = useAppStore(state => state.setAgentScript);

  const dialectId = detectDialectId(agentscript);
  const currentDialect = getDialectInfo(dialectId);

  const [pendingDialect, setPendingDialect] = useState<string | null>(null);

  const handleSelect = useCallback(
    (newId: string) => {
      if (newId === dialectId) return;
      setPendingDialect(newId);
    },
    [dialectId]
  );

  const confirmUpdate = useCallback(() => {
    if (!pendingDialect) return;
    const updated = setDialectAnnotation(agentscript ?? '', pendingDialect);
    setAgentScript(updated);
    setPendingDialect(null);
  }, [pendingDialect, agentscript, setAgentScript]);

  const cancelSwitch = useCallback(() => {
    setPendingDialect(null);
  }, []);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="xs"
            className="gap-1 text-[11px] font-medium text-gray-600 hover:bg-gray-300/50 hover:text-gray-900 dark:text-[#cccccc] dark:hover:bg-[#454646] dark:hover:text-white"
          >
            {currentDialect?.displayName ?? 'Dialect'}
            <ChevronDownIcon className="size-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuRadioGroup
            value={dialectId}
            onValueChange={handleSelect}
          >
            {dialects.map(d => (
              <DropdownMenuRadioItem key={d.name} value={d.name}>
                <span className="flex items-center gap-2">
                  {d.displayName}
                  <span className="text-muted-foreground text-[10px]">
                    v{d.version}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog
        open={pendingDialect !== null}
        onOpenChange={open => {
          if (!open) setPendingDialect(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Switch Dialect</DialogTitle>
            <DialogDescription>
              Switch to{' '}
              <strong>
                {getDialectInfo(pendingDialect ?? '')?.displayName}
              </strong>
              . Would you like to update the{' '}
              <code className="rounded bg-gray-100 px-1 py-0.5 text-xs dark:bg-gray-800">
                # @dialect:
              </code>{' '}
              annotation in your script?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={cancelSwitch}>
              Cancel
            </Button>
            <Button onClick={confirmUpdate}>Yes, update script</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
