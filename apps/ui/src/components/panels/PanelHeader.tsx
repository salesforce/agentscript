/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { Button } from '~/components/ui/button';
import { AiOutlineExpand } from 'react-icons/ai';
import { IoMdContract } from 'react-icons/io';

interface PanelHeaderProps {
  title: string;
  canExpand?: boolean;
  isExpanded?: boolean;
  onExpand?: () => void;
  actions?: React.ReactNode;
}

export function PanelHeader({
  title,
  canExpand = false,
  isExpanded = false,
  onExpand,
  actions,
}: PanelHeaderProps) {
  return (
    <div className="flex h-9 items-center justify-between border-b border-[#f1f1f2] bg-[#fafafd] px-3 dark:border-[#2b2b2b] dark:bg-[#191a1b]">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-[#606060] dark:font-normal dark:text-[#bfbfbf]">
        {title}
      </h2>
      <div className="flex items-center gap-2">
        {actions}
        {canExpand && onExpand && (
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-gray-600 hover:bg-gray-300/50 hover:text-gray-900 dark:text-[#cccccc] dark:hover:bg-[#454646] dark:hover:text-white"
            onClick={onExpand}
            title={isExpanded ? 'Exit fullscreen' : 'Enter fullscreen'}
          >
            {isExpanded ? (
              <IoMdContract className="h-4 w-4" />
            ) : (
              <AiOutlineExpand className="h-4 w-4" />
            )}
          </Button>
        )}
      </div>
    </div>
  );
}
