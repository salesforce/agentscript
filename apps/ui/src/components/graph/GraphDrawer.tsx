/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Right-side Sheet drawer for viewing graph element details.
 * Supports multiple content types via discriminated union:
 *   - 'conditional': condition details (opened from edge gate icon)
 *   - 'action': reasoning action details (opened from LLM node pill)
 *   - 'node': node details (opened by clicking any node)
 * Non-modal so the graph stays interactive.
 */

import { useAppStore } from '~/store';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '~/components/ui/sheet';
import { ConditionalDrawerContent } from './ConditionalDrawerContent';
import { ActionDrawerContent } from './ActionDrawerContent';
import {
  NodeDrawerContent,
  nodeDrawerTitle,
  nodeDrawerSubtitle,
} from './NodeDrawerContent';

export function GraphDrawer() {
  const drawerPayload = useAppStore(state => state.layout.graphDrawerData);
  const closeGraphDrawer = useAppStore(state => state.closeGraphDrawer);

  const isOpen = !!drawerPayload;

  return (
    <Sheet
      open={isOpen}
      onOpenChange={open => {
        if (!open) closeGraphDrawer();
      }}
      modal={false}
    >
      <SheetContent
        side="right"
        className="w-[440px] sm:max-w-[440px]"
        showOverlay={false}
        showCloseButton
      >
        {drawerPayload?.type === 'conditional' && (
          <>
            <SheetHeader>
              <SheetTitle className="text-sm">
                Conditional Transition
              </SheetTitle>
              <SheetDescription className="font-mono text-xs">
                {drawerPayload.data.conditionText}
              </SheetDescription>
            </SheetHeader>
            <ConditionalDrawerContent data={drawerPayload.data} />
          </>
        )}
        {drawerPayload?.type === 'action' && (
          <>
            <SheetHeader>
              <SheetTitle className="text-sm">
                {drawerPayload.data.actionDisplayName}
              </SheetTitle>
              <SheetDescription className="text-xs">
                Reasoning Action
              </SheetDescription>
            </SheetHeader>
            <ActionDrawerContent data={drawerPayload.data} />
          </>
        )}
        {drawerPayload?.type === 'node' && (
          <>
            <SheetHeader>
              <SheetTitle className="text-sm">
                {nodeDrawerTitle(drawerPayload.data)}
              </SheetTitle>
              <SheetDescription className="text-xs">
                {nodeDrawerSubtitle(drawerPayload.data)}
              </SheetDescription>
            </SheetHeader>
            <NodeDrawerContent data={drawerPayload.data} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
