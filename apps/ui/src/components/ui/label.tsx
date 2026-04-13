/*
 * Portions of this file are adapted from shadcn/ui (https://ui.shadcn.com)
 * MIT License — Copyright (c) 2023 shadcn
 * See https://github.com/shadcn-ui/ui/blob/main/LICENSE.md
 *
 * Modifications copyright (c) 2026 Salesforce, Inc.
 * SPDX-License-Identifier: MIT
 */

import * as LabelPrimitive from '@radix-ui/react-label';
import { cva } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '~/lib/utils';

const labelVariants = cva(
  'text-sm leading-none font-medium peer-disabled:cursor-not-allowed peer-disabled:opacity-70'
);

const Label = ({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) => (
  <LabelPrimitive.Root
    data-slot="label"
    className={cn(labelVariants(), className)}
    {...props}
  />
);

export { Label };
