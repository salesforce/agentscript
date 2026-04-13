/*
 * Portions of this file are adapted from shadcn/ui (https://ui.shadcn.com)
 * MIT License — Copyright (c) 2023 shadcn
 * See https://github.com/shadcn-ui/ui/blob/main/LICENSE.md
 *
 * Modifications copyright (c) 2026 Salesforce, Inc.
 * SPDX-License-Identifier: MIT
 */

import { GripVerticalIcon } from 'lucide-react';
import * as React from 'react';
import * as ResizablePrimitive from 'react-resizable-panels';

import { cn } from '~/lib/utils';

function ResizablePanelGroup({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelGroup>) {
  return (
    <ResizablePrimitive.PanelGroup
      data-slot="resizable-panel-group"
      className={cn(
        'flex h-full w-full data-[panel-group-direction=vertical]:flex-col',
        className
      )}
      {...props}
    />
  );
}

function ResizablePanel({
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.Panel>) {
  return <ResizablePrimitive.Panel data-slot="resizable-panel" {...props} />;
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelResizeHandle> & {
  withHandle?: boolean;
}) {
  return (
    <ResizablePrimitive.PanelResizeHandle
      data-slot="resizable-handle"
      className={cn(
        'bg-[#f1f1f2] focus-visible:ring-ring focus-visible:outline-hidden relative flex w-px items-center justify-center after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 after:bg-transparent focus-visible:ring-1 focus-visible:ring-offset-1 data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-1 data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:-translate-y-1/2 data-[panel-group-direction=vertical]:after:translate-x-0 dark:bg-[#2b2b2b] [&[data-panel-group-direction=vertical]>div]:rotate-90',
        className
      )}
      {...props}
    >
      {withHandle && (
        <div className="bg-border rounded-xs z-10 flex h-4 w-3 items-center justify-center border dark:border-[#454545] dark:bg-[#3c3c3c]">
          <GripVerticalIcon className="size-2.5 dark:text-[#808080]" />
        </div>
      )}
    </ResizablePrimitive.PanelResizeHandle>
  );
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle };
