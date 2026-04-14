/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { ChevronRight, Folder, FileCode2 } from 'lucide-react';
import * as React from 'react';
import { getBlockTypeConfig } from '~/lib/block-type-config';
import { cn } from '~/lib/utils';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '~/components/ui/empty';

// Tree node structure for the explorer
export interface TreeNode {
  id: string;
  data: {
    label: string;
    blockType: string;
    secondaryLabel?: string;
    [key: string]: unknown;
  };
  children?: TreeNode[];
}

interface TreeViewProps {
  data: TreeNode[];
  selectedNodeId?: string;
  onNodeSelect: (kind: string, id: string) => void;
  expandedKeys?: string[];
  className?: string;
}

export function TreeView({
  data,
  selectedNodeId,
  onNodeSelect,
  expandedKeys = [],
  className,
}: TreeViewProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileCode2 />
            </EmptyMedia>
            <EmptyTitle>No Blocks Available</EmptyTitle>
            <EmptyDescription>
              Start editing your agent to see blocks appear here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  return (
    <div className={cn('py-1', className)}>
      {data.map(node => {
        const isDefaultExpanded =
          node.id === 'topics-group' ||
          node.id === 'connections-group' ||
          expandedKeys.includes(node.id);
        return (
          <TreeNodeItem
            key={node.id}
            node={node}
            selectedNodeId={selectedNodeId}
            onNodeSelect={onNodeSelect}
            expandedKeys={expandedKeys}
            defaultExpanded={isDefaultExpanded}
          />
        );
      })}
    </div>
  );
}

// Recursive component for tree nodes
function TreeNodeItem({
  node,
  selectedNodeId,
  onNodeSelect,
  expandedKeys = [],
  defaultExpanded = false,
}: {
  node: TreeNode;
  selectedNodeId?: string;
  onNodeSelect: (kind: string, id: string) => void;
  expandedKeys?: string[];
  defaultExpanded?: boolean;
}) {
  const [isExpanded, setIsExpanded] = React.useState(defaultExpanded);
  const nodeRef = React.useRef<HTMLDivElement>(null);
  const hasChildren = node.children && node.children.length > 0;
  const blockType = node.data.blockType;
  const isGroup = blockType === 'group';
  const selected = selectedNodeId === node.id;

  // Update isExpanded when defaultExpanded changes
  React.useEffect(() => {
    setIsExpanded(defaultExpanded);
  }, [defaultExpanded]);

  // Scroll selected node into view
  // DISABLED: This was causing the Monaco editor to scroll when cursor moved
  // because cursor movement updates selectedNodeId which triggers this scroll
  // React.useEffect(() => {
  //   if (selected && nodeRef.current) {
  //     nodeRef.current.scrollIntoView({
  //       behavior: 'smooth',
  //       block: 'nearest',
  //       inline: 'nearest',
  //     });
  //   }
  // }, [selected]);

  // Get icon config for the node type
  const iconConfig = isGroup
    ? {
        icon: <Folder size={14} />,
        iconClassName: 'text-gray-600',
        iconBg: '#f3f4f6',
      }
    : getBlockTypeConfig(blockType, {
        isStartAgent: node.data.isStartAgent as boolean | undefined,
        iconSize: 14,
      });

  return (
    <div className="w-full">
      <div
        ref={nodeRef}
        className={cn(
          'flex cursor-pointer items-center gap-1 px-2 py-1 text-xs transition-colors',
          selected && 'rounded-l-sm'
        )}
        style={{
          background: selected ? 'var(--ide-accent-soft)' : undefined,
          color: 'var(--ide-text-primary)',
        }}
        onMouseEnter={e => {
          if (!selected) {
            e.currentTarget.style.background = 'var(--ide-surface-hover)';
          }
        }}
        onMouseLeave={e => {
          if (!selected) {
            e.currentTarget.style.background = '';
          }
        }}
        onClick={() => {
          onNodeSelect(blockType, node.id);
          if (hasChildren) {
            setIsExpanded(!isExpanded);
          }
        }}
      >
        {hasChildren && (
          <button
            onClick={e => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            className="shrink-0 rounded p-0.5 transition-colors"
            onMouseEnter={e => {
              e.currentTarget.style.background = 'var(--ide-surface-sunken)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = '';
            }}
          >
            <ChevronRight
              className={cn(
                'h-3 w-3 transition-transform',
                isExpanded && 'rotate-90'
              )}
              style={{ color: 'var(--ide-text-muted)' }}
            />
          </button>
        )}
        {!hasChildren && <div className="w-4 shrink-0" />}

        <div
          className="flex shrink-0 items-center justify-center rounded"
          style={{
            backgroundColor: iconConfig.iconBg,
            width: '18px',
            height: '18px',
          }}
        >
          <div className={iconConfig.iconClassName}>{iconConfig.icon}</div>
        </div>

        <div className="flex flex-1 items-center gap-1 overflow-hidden">
          <span
            className={cn('shrink-0', selected && 'font-medium')}
            style={{ color: 'var(--ide-text-primary)' }}
          >
            {node.data.label}
          </span>
          {node.data.secondaryLabel && (
            <span
              className="truncate font-mono"
              style={{ color: 'var(--ide-text-subtle)' }}
            >
              {node.data.secondaryLabel}
            </span>
          )}
        </div>
      </div>

      {hasChildren && isExpanded && (
        <div className="ml-2">
          {node.children!.map(child => {
            const childDefaultExpanded = expandedKeys.includes(child.id);
            return (
              <TreeNodeItem
                key={child.id}
                node={child}
                selectedNodeId={selectedNodeId}
                onNodeSelect={onNodeSelect}
                expandedKeys={expandedKeys}
                defaultExpanded={childDefaultExpanded}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
