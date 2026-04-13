/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * TemplateEditor — Notion-like contenteditable editor with inline expression pills.
 *
 * Features:
 *  - {!expression} tokens render as interactive inline pills
 *  - Click a pill to edit its value via a floating popover
 *  - "+" button and Cmd/Ctrl+E shortcut to insert new expressions
 *  - Auto-expanding to fit content
 *  - Clean, minimal Notion-inspired styling
 *  - Pills created on blur (typed {!...} convert to pills when clicking away)
 *  - Paste sanitization (strips formatting)
 *  - IME composition support
 */

import {
  useRef,
  useEffect,
  useCallback,
  useState,
  type KeyboardEvent,
  type ClipboardEvent,
  type FocusEvent,
  type MouseEvent,
} from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from '~/lib/utils';

// ─── Types ───────────────────────────────────────────────────────────────────

interface TemplateEditorProps {
  content: string;
  onChange: (content: string) => void;
  placeholder?: string;
  hasError?: boolean;
  className?: string;
}

type Segment =
  | { type: 'text'; value: string }
  | { type: 'expr'; value: string };

interface PillEditState {
  element: HTMLSpanElement;
  value: string;
  position: { top: number; left: number };
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

const EXPR_RE = /\{!(.*?)\}/g;

function parseTemplate(text: string): Segment[] {
  const segments: Segment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(EXPR_RE)) {
    const idx = match.index;
    if (idx > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, idx) });
    }
    segments.push({ type: 'expr', value: match[1] });
    lastIndex = idx + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) });
  }
  return segments;
}

// ─── HTML Generation ─────────────────────────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Zero-width space for cursor positioning adjacent to pills */
const ZWS = '\u200B';

function segmentsToHtml(segs: Segment[]): string {
  if (segs.length === 0) return '';
  return segs
    .map(s => {
      if (s.type === 'expr') {
        const display = s.value || '\u2026';
        return `${ZWS}<span class="te-pill" contenteditable="false" data-expr="${esc(s.value)}">${esc(display)}</span>${ZWS}`;
      }
      return esc(s.value).replace(/\n/g, '<br>');
    })
    .join('');
}

// ─── DOM → Template String ───────────────────────────────────────────────────

function serializeNode(node: ChildNode): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return (node.textContent ?? '').replace(/\u200B/g, '');
  }
  if (!(node instanceof HTMLElement)) return '';
  if (node.dataset.expr !== undefined) return `{!${node.dataset.expr}}`;
  if (node.tagName === 'BR') return '\n';
  if (node.tagName === 'DIV' || node.tagName === 'P') {
    return '\n' + Array.from(node.childNodes).map(serializeNode).join('');
  }
  return Array.from(node.childNodes).map(serializeNode).join('');
}

function serialize(el: HTMLDivElement): string {
  let result = '';
  let isFirst = true;
  for (const child of el.childNodes) {
    if (
      child instanceof HTMLElement &&
      (child.tagName === 'DIV' || child.tagName === 'P')
    ) {
      const inner = Array.from(child.childNodes).map(serializeNode).join('');
      if (!isFirst) result += '\n';
      result += inner;
      isFirst = false;
    } else {
      const text = serializeNode(child);
      result += text;
      if (text.length > 0) isFirst = false;
    }
  }
  return result;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mac|iPhone|iPad/.test(navigator.platform ?? '');
}

function commitContent(
  editorEl: HTMLDivElement,
  lastRendered: React.RefObject<string>,
  render: (text: string) => void,
  onChange: (text: string) => void
) {
  const raw = serialize(editorEl);
  const text = raw.trim() === '' ? '' : raw;
  lastRendered.current = text;
  render(text);
  onChange(text);
}

// ─── PillPopover (inline expression editor) ──────────────────────────────────

interface PillPopoverProps {
  value: string;
  position: { top: number; left: number };
  onCommit: (value: string) => void;
  onCancel: () => void;
  onDelete: () => void;
}

function PillPopover({
  value,
  position,
  onCommit,
  onCancel,
  onDelete,
}: PillPopoverProps) {
  const [localValue, setLocalValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, []);

  return (
    <div
      data-pill-popover
      className={cn(
        'absolute z-50 flex items-center gap-1',
        'rounded-lg border border-border bg-popover p-1 shadow-lg',
        'animate-in fade-in-0 zoom-in-95 duration-100'
      )}
      style={{ top: position.top, left: position.left }}
      onMouseDown={e => e.stopPropagation()}
    >
      <div className="flex items-center gap-0.5 rounded-md bg-muted/50 px-1">
        <span className="select-none text-[10px] text-muted-foreground/60">
          {'{!'}
        </span>
        <input
          ref={inputRef}
          value={localValue}
          onChange={e => setLocalValue(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onCommit(localValue);
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              onCancel();
            }
            e.stopPropagation();
          }}
          onBlur={() => onCommit(localValue)}
          placeholder="expression"
          className="h-7 min-w-[180px] border-0 bg-transparent px-1 py-0.5 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/40"
        />
        <span className="select-none text-[10px] text-muted-foreground/60">
          {'}'}
        </span>
      </div>
      <button
        type="button"
        onMouseDown={e => e.preventDefault()}
        onClick={onDelete}
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
          'text-muted-foreground transition-colors',
          'hover:bg-destructive/10 hover:text-red-500'
        )}
        title="Remove expression"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ─── TemplateEditor ──────────────────────────────────────────────────────────

export function TemplateEditor({
  content,
  onChange,
  placeholder = 'Start typing\u2026 Press \u2318E to insert an expression',
  hasError,
  className,
}: TemplateEditorProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const lastRendered = useRef(content);
  const isComposing = useRef(false);
  const [isEmpty, setIsEmpty] = useState(!content.trim());
  const [pillEdit, setPillEdit] = useState<PillEditState | null>(null);

  // ── Render template text → pills + text in contenteditable ──
  const render = useCallback((text: string) => {
    if (!editorRef.current) return;
    const html = segmentsToHtml(parseTemplate(text));
    editorRef.current.innerHTML = html;
    setIsEmpty(!text.trim());
  }, []);

  // Initial mount
  useEffect(() => {
    render(content);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External content change (skip while user is editing)
  useEffect(() => {
    if (content === lastRendered.current) return;
    if (editorRef.current && document.activeElement === editorRef.current)
      return;
    lastRendered.current = content;
    render(content);
  }, [content, render]);

  // ── Input: track empty state (onChange fires on blur) ──
  const handleInput = useCallback(() => {
    if (!editorRef.current || isComposing.current) return;
    const text = serialize(editorRef.current);
    setIsEmpty(!text.trim());
  }, []);

  // ── Blur: pill-ify expressions & commit to parent ──
  const handleBlur = useCallback(
    (e: FocusEvent<HTMLDivElement>) => {
      // Don't commit if focus moved within our wrapper (pill editor, buttons)
      if (
        wrapperRef.current &&
        e.relatedTarget instanceof Node &&
        wrapperRef.current.contains(e.relatedTarget)
      ) {
        return;
      }
      if (!editorRef.current) return;
      commitContent(editorRef.current, lastRendered, render, onChange);
    },
    [onChange, render]
  );

  // ── Click on pills → open edit popover ──
  const handleClick = useCallback((e: MouseEvent<HTMLDivElement>) => {
    const pill = (e.target as HTMLElement).closest(
      '.te-pill'
    ) as HTMLSpanElement | null;
    if (!pill || pill.dataset.expr === undefined || !wrapperRef.current) return;

    const wrapperRect = wrapperRef.current.getBoundingClientRect();
    const pillRect = pill.getBoundingClientRect();

    setPillEdit({
      element: pill,
      value: pill.dataset.expr ?? '',
      position: {
        top: pillRect.bottom - wrapperRect.top + 4,
        left: Math.max(0, pillRect.left - wrapperRect.left),
      },
    });
  }, []);

  // ── Pill edit handlers ──
  const commitPillEdit = useCallback(
    (newValue: string) => {
      if (!pillEdit || !editorRef.current) return;
      const { element } = pillEdit;

      if (!newValue.trim()) {
        element.remove();
      } else {
        element.dataset.expr = newValue;
        element.textContent = newValue;
      }

      setPillEdit(null);
      commitContent(editorRef.current, lastRendered, render, onChange);
    },
    [pillEdit, onChange, render]
  );

  const cancelPillEdit = useCallback(() => {
    setPillEdit(null);
  }, []);

  const deletePill = useCallback(() => {
    if (!pillEdit || !editorRef.current) return;
    pillEdit.element.remove();
    setPillEdit(null);
    commitContent(editorRef.current, lastRendered, render, onChange);
  }, [pillEdit, onChange, render]);

  // ── Insert {!} at cursor ──
  const insertExpression = useCallback(() => {
    if (!editorRef.current) return;

    const wasFocused = document.activeElement === editorRef.current;
    editorRef.current.focus();

    // If the editor wasn't focused, place cursor at end
    if (!wasFocused) {
      const range = document.createRange();
      range.selectNodeContents(editorRef.current);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;

    const range = sel.getRangeAt(0);
    range.deleteContents();

    const textNode = document.createTextNode('{!}');
    range.insertNode(textNode);

    // Place cursor between ! and }
    range.setStart(textNode, 2);
    range.setEnd(textNode, 2);
    sel.removeAllRanges();
    sel.addRange(range);

    setIsEmpty(false);
  }, []);

  // ── Keyboard shortcuts ──
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'e' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        insertExpression();
        return;
      }
      if (e.key === 'Tab' && !e.shiftKey) {
        e.preventDefault();
        document.execCommand('insertText', false, '  ');
      }
    },
    [insertExpression]
  );

  // ── Paste: strip formatting ──
  const handlePaste = useCallback((e: ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  }, []);

  // ── IME composition ──
  const handleCompositionStart = useCallback(() => {
    isComposing.current = true;
  }, []);
  const handleCompositionEnd = useCallback(() => {
    isComposing.current = false;
    handleInput();
  }, [handleInput]);

  return (
    <div ref={wrapperRef} className={cn('group/te relative', className)}>
      {/* Contenteditable editor */}
      <div
        ref={editorRef}
        contentEditable
        role="textbox"
        aria-multiline="true"
        aria-placeholder={placeholder}
        suppressContentEditableWarning
        onInput={handleInput}
        onBlur={handleBlur}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        className={cn(
          'te-editor',
          'min-h-[2.5rem] w-full whitespace-pre-wrap break-words',
          'rounded-md px-3 py-2 text-sm leading-relaxed',
          'border-input bg-transparent text-foreground shadow-xs dark:bg-input/30',
          'border outline-none transition-[color,box-shadow]',
          'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
          hasError
            ? 'border-red-500 focus-visible:border-red-500 focus-visible:ring-red-500/20'
            : ''
        )}
      />

      {/* Placeholder overlay */}
      {isEmpty && !pillEdit && (
        <div
          className="pointer-events-none absolute top-0 right-0 left-0 px-3.5 py-2.5 text-sm leading-relaxed text-muted-foreground/50 select-none"
          aria-hidden="true"
        >
          {placeholder}
        </div>
      )}

      {/* Pill edit popover */}
      {pillEdit && (
        <PillPopover
          value={pillEdit.value}
          position={pillEdit.position}
          onCommit={commitPillEdit}
          onCancel={cancelPillEdit}
          onDelete={deletePill}
        />
      )}

      {/* Toolbar: insert button + keyboard hint */}
      <div
        className={cn(
          'mt-1 flex items-center gap-2',
          'opacity-0 transition-opacity duration-200',
          'group-focus-within/te:opacity-100'
        )}
      >
        <button
          type="button"
          onMouseDown={e => e.preventDefault()}
          onClick={insertExpression}
          className={cn(
            'inline-flex items-center gap-1 rounded-md px-2 py-0.5',
            'text-[11px] text-muted-foreground',
            'border border-border/50 bg-muted/60',
            'transition-colors hover:bg-muted hover:text-foreground'
          )}
        >
          <Plus className="h-3 w-3" />
          Expression
        </button>
        <span className="text-[10px] text-muted-foreground">
          or{' '}
          <kbd className="rounded border border-border/50 bg-muted/80 px-1 py-0.5 font-mono text-[10px] leading-none">
            {isMac() ? '\u2318E' : 'Ctrl+E'}
          </kbd>
        </span>
      </div>
    </div>
  );
}
