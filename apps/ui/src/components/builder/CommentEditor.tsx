/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useState } from 'react';
import type { Comment } from '@agentscript/types';
import { cn } from '~/lib/utils';
import { Textarea } from '~/components/ui/textarea';
import { Button } from '~/components/ui/button';
import { VscComment } from 'react-icons/vsc';

interface CommentEditorProps {
  comments?: Comment[];
  position: 'leading' | 'trailing';
  onUpdate?: (comments: Comment[]) => void;
  className?: string;
}

export function CommentEditor({
  comments,
  position,
  onUpdate,
  className,
}: CommentEditorProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  if (!comments?.length && !onUpdate) return null;

  if (!comments?.length) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className={cn(
          'h-6 gap-1 px-1.5 text-xs text-muted-foreground opacity-0 transition-opacity group-hover/block:opacity-100',
          className
        )}
        onClick={() => {
          setEditValue('');
          setEditing(true);
        }}
      >
        <VscComment className="h-3 w-3" />
        Add comment
      </Button>
    );
  }

  const commentText = comments.map(c => c.value).join('\n');

  if (editing) {
    return (
      <div className={cn('flex flex-col gap-1', className)}>
        <Textarea
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          placeholder="Write a comment..."
          className="min-h-[40px] text-xs"
          autoFocus
          onKeyDown={e => {
            if (e.key === 'Escape') {
              setEditing(false);
            }
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              onUpdate?.(
                editValue.split('\n').map(line => ({
                  value: line,
                  attachment: position,
                }))
              );
              setEditing(false);
            }
          }}
        />
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs"
            onClick={() => setEditing(false)}
          >
            Cancel
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs"
            onClick={() => {
              onUpdate?.(
                editValue.split('\n').map(line => ({
                  value: line,
                  attachment: position,
                }))
              );
              setEditing(false);
            }}
          >
            Save
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'cursor-pointer text-xs italic text-muted-foreground hover:text-foreground',
        position === 'leading' && 'mb-1',
        position === 'trailing' && 'mt-1',
        className
      )}
      onClick={() => {
        setEditValue(commentText);
        setEditing(true);
      }}
      title="Click to edit comment"
    >
      {comments.map((c, i) => (
        <p key={i} className="text-muted-foreground">
          # {c.value}
        </p>
      ))}
    </div>
  );
}
