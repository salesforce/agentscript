/*
 * Portions of this file are adapted from shadcn/ui (https://ui.shadcn.com)
 * MIT License — Copyright (c) 2023 shadcn
 * See https://github.com/shadcn-ui/ui/blob/main/LICENSE.md
 *
 * Modifications copyright (c) 2026 Salesforce, Inc.
 * SPDX-License-Identifier: MIT
 */

import { type SVGProps } from 'react';
import href from './icons/sprite.svg';
import { type IconName } from '~/components/ui/icons/types';
import { cn } from '~/lib/utils';

// eslint-disable-next-line react-refresh/only-export-components
export { href };
export type { IconName };

const sizeClassName = {
  font: 'size-[1em]',
  xs: 'size-3',
  sm: 'size-4',
  md: 'size-5',
  lg: 'size-6',
  xl: 'size-7',
} as const;

type Size = keyof typeof sizeClassName;

const childrenSizeClassName = {
  font: 'gap-1.5',
  xs: 'gap-1.5',
  sm: 'gap-1.5',
  md: 'gap-2',
  lg: 'gap-2',
  xl: 'gap-3',
} satisfies Record<Size, string>;

/**
 * Renders an SVG icon. The icon defaults to the size of the font. To make it
 * align vertically with neighboring text, you can pass the text as a child of
 * the icon and it will be automatically aligned.
 * Alternatively, if you're not ok with the icon being to the left of the text,
 * you need to wrap the icon and text in a common parent and set the parent to
 * display "flex" (or "inline-flex") with "items-center" and a reasonable gap.
 *
 * Pass `title` prop to the `Icon` component to get `<title>` element rendered
 * in the SVG container, providing this way for accessibility.
 */
export function Icon({
  name,
  size = 'font',
  className,
  title,
  children,
  ...props
}: SVGProps<SVGSVGElement> & {
  name: IconName;
  size?: Size;
  title?: string;
}) {
  if (children) {
    return (
      <span
        className={`inline-flex items-center ${childrenSizeClassName[size]}`}
      >
        <Icon
          name={name}
          size={size}
          className={className}
          title={title}
          {...props}
        />
        {children}
      </span>
    );
  }
  return (
    <svg
      {...props}
      className={cn(sizeClassName[size], 'inline self-center', className)}
    >
      {title ? <title>{title}</title> : null}
      <use href={`${href}#${name}`} />
    </svg>
  );
}
