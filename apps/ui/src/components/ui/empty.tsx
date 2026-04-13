/*
 * Portions of this file are adapted from shadcn/ui (https://ui.shadcn.com)
 * MIT License — Copyright (c) 2023 shadcn
 * See https://github.com/shadcn-ui/ui/blob/main/LICENSE.md
 *
 * Modifications copyright (c) 2026 Salesforce, Inc.
 * SPDX-License-Identifier: MIT
 */

import { cva, type VariantProps } from 'class-variance-authority';
import { createContext, useContext } from 'react';

import { cn } from '~/lib/utils';

interface EmptyContextValue {
  orientation: 'vertical' | 'horizontal';
  size: 'default' | 'tight';
}

const EmptyContext = createContext<EmptyContextValue>({
  orientation: 'vertical',
  size: 'default',
});

function Empty({
  className,
  orientation = 'vertical',
  size = 'default',
  ...props
}: React.ComponentProps<'div'> & {
  orientation?: 'vertical' | 'horizontal';
  size?: 'default' | 'tight';
}) {
  return (
    <EmptyContext.Provider value={{ orientation, size }}>
      <div
        data-slot="empty"
        className={cn(
          'flex min-w-0 flex-1 justify-center rounded-lg border-dashed',
          orientation === 'vertical'
            ? 'flex-col items-center gap-6 text-balance p-4 text-center md:p-4'
            : 'flex-row items-start gap-4 p-4',
          className
        )}
        {...props}
      />
    </EmptyContext.Provider>
  );
}

function EmptyHeader({ className, ...props }: React.ComponentProps<'div'>) {
  const { orientation } = useContext(EmptyContext);

  return (
    <div
      data-slot="empty-header"
      className={cn(
        'flex gap-3',
        orientation === 'vertical'
          ? 'max-w-sm flex-col items-center text-center'
          : 'flex-row items-start text-left',
        className
      )}
      {...props}
    />
  );
}

const emptyMediaVariants = cva(
  'flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        icon: "bg-muted text-foreground flex size-10 shrink-0 items-center justify-center rounded-lg [&_svg:not([class*='size-'])]:size-6",
      },
      orientation: {
        vertical: 'mb-2',
        horizontal: '',
      },
    },
    defaultVariants: {
      variant: 'default',
      orientation: 'vertical',
    },
  }
);

function EmptyMedia({
  className,
  variant = 'default',
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof emptyMediaVariants>) {
  const { orientation } = useContext(EmptyContext);

  return (
    <div
      data-slot="empty-icon"
      data-variant={variant}
      className={cn(emptyMediaVariants({ variant, orientation, className }))}
      {...props}
    />
  );
}

function EmptyTitle({ className, ...props }: React.ComponentProps<'div'>) {
  const { orientation, size } = useContext(EmptyContext);

  return (
    <div
      data-slot="empty-title"
      className={cn(
        'font-medium tracking-tight',
        size === 'tight' ? 'text-base' : 'text-lg',
        orientation === 'vertical' ? 'text-center' : 'text-left',
        className
      )}
      {...props}
    />
  );
}

function EmptyDescription({ className, ...props }: React.ComponentProps<'p'>) {
  const { orientation, size } = useContext(EmptyContext);

  return (
    <div
      data-slot="empty-description"
      className={cn(
        'text-muted-foreground [&>a:hover]:text-primary text-sm/relaxed [&>a]:underline [&>a]:underline-offset-4',
        orientation === 'vertical' ? 'text-center' : 'text-left',
        size === 'tight' ? 'mt-0' : '',
        className
      )}
      {...props}
    />
  );
}

function EmptyContent({ className, ...props }: React.ComponentProps<'div'>) {
  const { orientation } = useContext(EmptyContext);

  return (
    <div
      data-slot="empty-content"
      className={cn(
        'flex w-full min-w-0 max-w-sm flex-col gap-4 text-balance text-sm',
        orientation === 'vertical' ? 'items-center' : 'items-start',
        className
      )}
      {...props}
    />
  );
}

export {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
};
