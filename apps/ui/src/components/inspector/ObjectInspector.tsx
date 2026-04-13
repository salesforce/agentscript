/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useState, useMemo, useEffect, useRef, memo } from 'react';
import { ChevronRight } from 'lucide-react';
import { isNamedMap } from '@agentscript/language';
import { cn } from '~/lib/utils';

interface ObjectInspectorProps {
  data: unknown;
  name?: string;
  expandLevel?: number;
  highlightPath?: string | null;
  onNavigate?: (range: { start: { line: number; character: number } }) => void;
}

interface Range {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

export function ObjectInspector({
  data,
  name = 'root',
  expandLevel = 1,
  highlightPath,
  onNavigate,
}: ObjectInspectorProps) {
  return (
    <div className="font-mono text-xs">
      <InspectorNode
        value={data}
        name={name}
        path={name}
        depth={0}
        expandLevel={expandLevel}
        highlightPath={highlightPath}
        onNavigate={onNavigate}
      />
    </div>
  );
}

interface InspectorNodeProps {
  value: unknown;
  name: string;
  path: string;
  depth: number;
  expandLevel: number;
  highlightPath?: string | null;
  onNavigate?: (range: Range) => void;
}

/** Check whether this node's highlight state is relevant to a given path. */
function highlightState(
  highlightPath: string | null | undefined,
  path: string
) {
  if (!highlightPath) return 0; // not highlighted at all
  if (highlightPath === path) return 2; // exact match
  if (highlightPath.startsWith(path + '.')) return 1; // on path
  return 0;
}

const InspectorNode = memo(
  function InspectorNode({
    value,
    name,
    path,
    depth,
    expandLevel,
    highlightPath,
    onNavigate,
  }: InspectorNodeProps) {
    const nodeRef = useRef<HTMLDivElement>(null);

    // Check if this node is on the highlight path
    // Must match exactly or be a proper prefix (followed by a dot)
    const isOnHighlightPath = highlightPath
      ? highlightPath === path || highlightPath.startsWith(path + '.')
      : false;
    const isHighlighted = highlightPath === path;

    // Track manual expansion along with the highlightPath it was set for
    // This allows auto-reset when cursor moves without using setState in useEffect
    const [manualExpansion, setManualExpansion] = useState<{
      forHighlightPath: string | null | undefined;
      expanded: boolean;
    } | null>(null);

    // Manual expansion only applies if highlightPath hasn't changed since it was set
    const effectiveManualExpanded =
      manualExpansion !== null &&
      manualExpansion.forHighlightPath === highlightPath
        ? manualExpansion.expanded
        : null;

    // Auto-expand if on highlight path, otherwise use default expand level
    // Manual expansion overrides auto-expansion (only if set for current highlightPath)
    const isExpanded =
      effectiveManualExpanded ?? (isOnHighlightPath || depth < expandLevel);

    // Scroll into view when highlighted
    useEffect(() => {
      if (isHighlighted && nodeRef.current) {
        nodeRef.current.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }
    }, [isHighlighted]);

    const { isExpandable, preview, typeLabel, children, range } = useMemo(
      () => analyzeValue(value, name),
      [value, name]
    );

    const handleClick = () => {
      // Navigate to source position when clicking on a node with range
      if (range && onNavigate) {
        onNavigate(range);
      }
      // Toggle expansion for expandable nodes
      if (isExpandable) {
        setManualExpansion({
          forHighlightPath: highlightPath,
          expanded: !isExpanded,
        });
      }
    };

    const indent = depth * 12;

    return (
      <div>
        {/* Node row */}
        <div
          ref={nodeRef}
          className={cn(
            'flex items-start py-0.5',
            isExpandable && 'cursor-pointer',
            isHighlighted
              ? 'bg-yellow-200/50 dark:bg-yellow-500/20'
              : 'hover:bg-blue-500/10'
          )}
          style={{ paddingLeft: indent }}
          onClick={handleClick}
        >
          {/* Expand arrow */}
          <span className="w-4 shrink-0">
            {isExpandable && (
              <ChevronRight
                className={cn(
                  'h-3 w-3 text-gray-400 transition-transform',
                  isExpanded && 'rotate-90'
                )}
              />
            )}
          </span>

          {/* Property name */}
          <span className="text-purple-400 dark:text-purple-300">{name}</span>
          <span className="text-gray-400">:&nbsp;</span>

          {/* Type label */}
          {typeLabel && (
            <span className="text-teal-600 dark:text-teal-400">
              {typeLabel}&nbsp;
            </span>
          )}

          {/* Value preview */}
          <span className={cn('flex-1 truncate', getPreviewColor(value))}>
            {preview}
          </span>

          {/* Position indicator for nodes with range */}
          {range && (
            <span
              className="ml-2 text-[10px] text-gray-500"
              title={`Line ${range.start.line + 1}, Column ${range.start.character + 1}`}
            >
              :{range.start.line + 1}
            </span>
          )}
        </div>

        {/* Expanded children */}
        {isExpanded && isExpandable && children && (
          <div>
            {children.map((child, i) => (
              <InspectorNode
                key={child.key || i}
                value={child.value}
                name={child.name}
                path={`${path}.${child.name}`}
                depth={depth + 1}
                expandLevel={expandLevel}
                highlightPath={highlightPath}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        )}
      </div>
    );
  },
  (prev, next) => {
    // Only re-render when data changes or highlight state changes
    if (prev.value !== next.value) return false;
    if (prev.name !== next.name) return false;
    if (prev.depth !== next.depth) return false;
    if (prev.expandLevel !== next.expandLevel) return false;
    if (prev.onNavigate !== next.onNavigate) return false;
    // Skip re-render if highlight relevance hasn't changed
    return (
      highlightState(prev.highlightPath, prev.path) ===
      highlightState(next.highlightPath, next.path)
    );
  }
);

interface ChildEntry {
  key: string;
  name: string;
  value: unknown;
}

interface AnalysisResult {
  isExpandable: boolean;
  preview: string;
  typeLabel: string | null;
  children: ChildEntry[] | null;
  range: Range | null;
}

function analyzeValue(value: unknown, _name: string): AnalysisResult {
  // Handle null/undefined
  if (value === null) {
    return {
      isExpandable: false,
      preview: 'null',
      typeLabel: null,
      children: null,
      range: null,
    };
  }

  if (value === undefined) {
    return {
      isExpandable: false,
      preview: 'undefined',
      typeLabel: null,
      children: null,
      range: null,
    };
  }

  // Handle primitives
  if (typeof value === 'string') {
    return {
      isExpandable: false,
      preview: `"${truncate(value, 50)}"`,
      typeLabel: null,
      children: null,
      range: null,
    };
  }

  if (typeof value === 'number') {
    return {
      isExpandable: false,
      preview: String(value),
      typeLabel: null,
      children: null,
      range: null,
    };
  }

  if (typeof value === 'boolean') {
    return {
      isExpandable: false,
      preview: String(value),
      typeLabel: null,
      children: null,
      range: null,
    };
  }

  // Handle functions
  if (typeof value === 'function') {
    const fnStr = value.toString();
    const preview = fnStr.length > 50 ? fnStr.slice(0, 47) + '...' : fnStr;
    return {
      isExpandable: false,
      preview,
      typeLabel: 'ƒ',
      children: null,
      range: null,
    };
  }

  // Handle arrays
  if (Array.isArray(value)) {
    const children: ChildEntry[] = value.map((item, i) => ({
      key: String(i),
      name: String(i),
      value: item,
    }));

    // Build preview
    const previewItems = value.slice(0, 3).map(item => getShortPreview(item));
    const preview =
      value.length <= 3
        ? `[${previewItems.join(', ')}]`
        : `[${previewItems.join(', ')}, …]`;

    return {
      isExpandable: value.length > 0,
      preview,
      typeLabel: `Array(${value.length})`,
      children,
      range: null,
    };
  }

  // Handle NamedMap / CollectionBlock
  if (isNamedMap(value)) {
    const obj = value as unknown as Record<string, unknown>;
    const kind = obj.__kind as string | undefined;

    const children: ChildEntry[] = [];
    for (const [k, v] of value) {
      children.push({
        key: String(k),
        name: String(k),
        value: v,
      });
    }

    // For CollectionBlock (has __kind), also show block metadata
    if (kind) {
      const cst = obj.__cst as { range: Range } | undefined;
      const diagnostics = obj.__diagnostics as unknown[] | undefined;
      const blockChildren = obj.__children as unknown[] | undefined;

      if (cst) {
        children.push({ key: '__cst', name: '__cst', value: cst });
      }
      if (diagnostics) {
        children.push({
          key: '__diagnostics',
          name: '__diagnostics',
          value: diagnostics,
        });
      }
      if (blockChildren && blockChildren.length > 0) {
        children.push({
          key: '__children',
          name: '__children',
          value: blockChildren,
        });
      }
    }

    const keys = [...value.keys()].slice(0, 3);
    const preview =
      keys.length <= 3 ? `{${keys.join(', ')}}` : `{${keys.join(', ')}, …}`;

    return {
      isExpandable: value.size > 0 || children.length > 0,
      preview,
      typeLabel: kind ? `${kind}(${value.size})` : `Map(${value.size})`,
      children,
      range: kind
        ? ((obj.__cst as { range: Range } | undefined)?.range ?? null)
        : null,
    };
  }

  // Handle objects
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const children: ChildEntry[] = [];

    // Extract special metadata
    const cst = obj.__cst as { range: Range } | undefined;
    // Comments store range directly on the object, not inside __cst
    const range = cst?.range ?? (obj.range as Range | undefined) ?? null;
    const kind = obj.__kind as string | undefined;
    const diagnostics = obj.__diagnostics as unknown[] | undefined;
    const comments = obj.__comments as unknown[] | undefined;

    // Determine type label
    let typeLabel: string | null = null;
    const constructorName = obj.constructor?.name;

    if (kind) {
      typeLabel = kind;
    } else if (constructorName && constructorName !== 'Object') {
      typeLabel = constructorName;
    }

    // Add regular properties first (non-meta, non-internal)
    const regularKeys: string[] = [];
    for (const [key, val] of Object.entries(obj)) {
      if (key.startsWith('_')) continue; // skip __ meta AND _ internal fields
      if (typeof val === 'function') continue;
      regularKeys.push(key);
      children.push({
        key,
        name: key,
        value: val,
      });
    }

    // Add metadata properties
    if (cst) {
      children.push({
        key: '__cst',
        name: '__cst',
        value: cst,
      });
    }

    if (diagnostics) {
      children.push({
        key: '__diagnostics',
        name: '__diagnostics',
        value: diagnostics,
      });
    }

    const blockChildren = obj.__children as unknown[] | undefined;
    if (blockChildren && blockChildren.length > 0) {
      children.push({
        key: '__children',
        name: '__children',
        value: blockChildren,
      });
    }

    children.push({
      key: '__comments',
      name: '__comments',
      value: comments,
    });

    // Build preview from regular keys
    const previewParts: string[] = [];
    for (const key of regularKeys.slice(0, 4)) {
      const val = obj[key];
      previewParts.push(`${key}: ${getShortPreview(val)}`);
    }
    const preview =
      regularKeys.length <= 4
        ? `{${previewParts.join(', ')}}`
        : `{${previewParts.join(', ')}, …}`;

    return {
      isExpandable: children.length > 0,
      preview,
      typeLabel,
      children,
      range,
    };
  }

  // Fallback
  return {
    isExpandable: false,
    preview: String(value),
    typeLabel: typeof value,
    children: null,
    range: null,
  };
}

function getShortPreview(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') return `"${truncate(value, 15)}"`;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'function') return 'ƒ';
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (isNamedMap(value)) {
    const kind = (value as unknown as Record<string, unknown>).__kind as
      | string
      | undefined;
    return kind ? `${kind}(${value.size})` : `Map(${value.size})`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const kind = obj.__kind as string | undefined;
    const constructorName = obj.constructor?.name;
    if (kind) return kind;
    if (constructorName && constructorName !== 'Object') return constructorName;
    return '{…}';
  }
  return String(value);
}

function getPreviewColor(value: unknown): string {
  if (value === null || value === undefined) {
    return 'text-gray-500';
  }
  if (typeof value === 'string') {
    return 'text-orange-500 dark:text-orange-400';
  }
  if (typeof value === 'number') {
    return 'text-blue-500 dark:text-blue-400';
  }
  if (typeof value === 'boolean') {
    return 'text-blue-500 dark:text-blue-400';
  }
  if (typeof value === 'function') {
    return 'text-gray-500 italic';
  }
  return 'text-gray-600 dark:text-gray-300';
}

function truncate(str: string, maxLen: number): string {
  // Replace newlines for preview
  const singleLine = str.replace(/\n/g, '\\n');
  if (singleLine.length <= maxLen) return singleLine;
  return singleLine.slice(0, maxLen - 1) + '…';
}
