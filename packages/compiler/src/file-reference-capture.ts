/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { Range } from '@agentscript/types';
import type { FileReference } from './types.js';

/**
 * The slice of diagnostics the capture needs. `CompilerContext` satisfies this
 * structurally, so the capture can emit its one warning without importing (and
 * coupling to) the full context type.
 */
interface DiagnosticSink {
  warning(message: string, range?: Range): void;
}

/** One uploaded_files selector, before its `enabled` gate is attached. */
interface FileReferenceSelector {
  all?: true;
  index?: number;
  slice?: { start: number | null; stop: number | null; step: number | null };
}

/**
 * All `@system_variables.uploaded_files` capture state for one compile, grouped
 * off `CompilerContext` (which exposes a single `fileCapture` member instead of
 * a spray of loose flags). Capture turns on the AND of three independent axes,
 * each set by a different code path:
 *
 *  - `enabled` — the agent's `file_upload.mode` is `managed` (the sole mode
 *    whose runtime consumes `file_references`; see `capture`). Set once per
 *    compile. Defaults on so direct `compileExpression` callers (outside
 *    `compileAgentVersion`) behave as before.
 *  - prompt-text scope (`withPromptText`) — the reference sits in LLM-visible
 *    prompt text (an instruction / system-instruction / focus template), not an
 *    action binding. Set by `compileTemplate`.
 *  - node scope (`enterNode`/`drainNode`) — the reference sits inside a node
 *    body, so it can actually attach to a node. Set by the node loop.
 *
 * A reference that is prompt-text-scoped but *not* node-scoped (system messages
 * before the loop, surfaces after) can never attach and MANAGED would fail
 * closed on it, so `capture` warns rather than dropping it silently.
 */
export class FileReferenceCapture {
  /** Per-node accumulator, drained onto the node as `file_references`. */
  private refs: FileReference[] = [];

  /** True while compiling a node body (the window when captures attach). */
  private inNode = false;

  /** Node kind whose runtime contract cannot represent managed attachments. */
  private unsupportedNodeType: string | undefined;

  /**
   * True only while compiling LLM-visible prompt text. This is the axis MANAGED
   * file visibility actually turns on: a file's content is attached to the LLM
   * request only when the file is named in prompt text the model reads. Action
   * bindings (`with` / `set` / `run` values) resolve their uploaded-files
   * reference from session state, not from the attachment channel, so they
   * compile with this false and never capture — dropping their attachment can't
   * starve them.
   */
  private inPromptText = false;

  /**
   * Stack of the active capture condition. Only instruction-text gates push: the
   * compiled condition of each enclosing `if`/`else if`/`else` branch (and any
   * directive gate) that wraps a `| ...` template. The top is the AND of every
   * gate in scope, read by `capture` as a reference's `enabled` field so the
   * file surfaces only when every enclosing condition holds.
   */
  private conditionStack: string[] = [];

  /**
   * Whether uploaded_files references are captured for this compile. Set from
   * `file_upload.mode` in `compileAgentVersion`: on ONLY for `managed`, the sole
   * mode whose runtime consumes `file_references`. Defaults on so direct
   * `compileExpression` callers (outside `compileAgentVersion`) behave as before.
   */
  enabled = true;

  constructor(private readonly diagnostics: DiagnosticSink) {}

  /**
   * References captured so far this node. Sampled before/after a conditional
   * compiles to decide whether its condition slot must be reserved against
   * sibling reuse (see `advanceConditionSlotBaseIfFileGated`).
   */
  get count(): number {
    return this.refs.length;
  }

  /** Open a fresh capture window for a node body. */
  enterNode(): void {
    this.refs = [];
    this.inNode = true;
  }

  /**
   * Close the node window and return what was captured. Always clears node
   * scope, so post-loop surfaces are flagged rather than silently attached.
   */
  drainNode(): FileReference[] {
    this.inNode = false;
    return this.refs;
  }

  /** Compile an unsupported node without opening an attachment window. */
  withUnsupportedNode<T>(nodeType: string, fn: () => T): T {
    const prevInNode = this.inNode;
    const prevNodeType = this.unsupportedNodeType;
    this.inNode = false;
    this.unsupportedNodeType = nodeType;
    try {
      return fn();
    } finally {
      this.inNode = prevInNode;
      this.unsupportedNodeType = prevNodeType;
    }
  }

  /**
   * Run `fn` with prompt-text scope on, restoring the prior value on exit so a
   * nested template or a sibling action binding compiled afterwards is
   * unaffected.
   */
  withPromptText<T>(fn: () => T): T {
    const prev = this.inPromptText;
    this.inPromptText = true;
    try {
      return fn();
    } finally {
      this.inPromptText = prev;
    }
  }

  /**
   * The combined capture condition currently in scope, or undefined when
   * unconditional. Empty frames (an undefined push under no outer condition)
   * read back as undefined.
   */
  get currentCondition(): string | undefined {
    const top = this.conditionStack[this.conditionStack.length - 1];
    return top ? top : undefined;
  }

  /**
   * Enter a capture scope gated by `condition`, AND-combined with any outer
   * condition already on the stack (`(outer) and (condition)`). A nullish or
   * empty `condition` re-enters the current scope unchanged. Always pushes a
   * frame, so every call must be paired with `popCondition`.
   */
  pushCondition(condition: string | undefined): void {
    const outer = this.currentCondition;
    let combined: string | undefined;
    if (!condition) combined = outer;
    else if (!outer) combined = condition;
    else combined = `(${outer}) and (${condition})`;
    this.conditionStack.push(combined ?? '');
  }

  /** Leave the innermost capture scope opened by `pushCondition`. */
  popCondition(): void {
    this.conditionStack.pop();
  }

  /**
   * Capture an `@system_variables.uploaded_files` reference. No-ops unless every
   * axis holds:
   *
   *  - `enabled` off (mode !== managed): the runtime never scopes uploaded
   *    files, so a descriptor would be dead data — skip silently.
   *  - not prompt text: a reference in an action binding resolves from session
   *    state, not the request's attachment channel, so filtering attachments
   *    never starves it — capturing would over-attach a file the model was
   *    never told about. Skip silently.
   *  - not in a node body: the reference can never attach, so MANAGED fails
   *    closed on that file — warn so the author moves it into a node.
   *
   * The `enabled` gate is read from `currentCondition` (the enclosing `if`
   * branch's compiled condition), not passed in. Identical entries (same
   * selector + same enabled condition) are deduped.
   */
  capture(entry: FileReferenceSelector, range?: Range): void {
    if (!this.enabled) return;
    if (!this.inPromptText) return;

    const enabled = this.currentCondition;

    if (!this.inNode) {
      this.diagnostics.warning(
        this.unsupportedNodeType
          ? `@system_variables.uploaded_files reference in ${this.unsupportedNodeType} prompt text is not tracked for file-upload filtering; managed file attachments are not supported for ${this.unsupportedNodeType} nodes`
          : '@system_variables.uploaded_files reference outside a node body is not tracked for file-upload filtering; move it into a node (reasoning/instructions/tool) to have its file surfaced',
        range
      );
      return;
    }

    const fullEntry: {
      all?: true;
      index?: number;
      slice?: {
        start: number | null;
        stop: number | null;
        step: number | null;
      };
      enabled?: string;
    } = enabled ? { ...entry, enabled } : entry;

    // Dedup: check if an identical entry already exists
    const exists = this.refs.some(existing => {
      const existingEnabled = (existing as { enabled?: string }).enabled;
      // Compare enabled condition (both must be absent, or both must match)
      if ((existingEnabled ?? undefined) !== (fullEntry.enabled ?? undefined)) {
        return false;
      }
      // Compare selector
      if (existing.all && fullEntry.all) return true;
      if (existing.index !== undefined && fullEntry.index !== undefined) {
        return existing.index === fullEntry.index;
      }
      if (existing.slice && fullEntry.slice) {
        return (
          existing.slice.start === fullEntry.slice.start &&
          existing.slice.stop === fullEntry.slice.stop &&
          existing.slice.step === fullEntry.slice.step
        );
      }
      return false;
    });

    if (!exists) {
      this.refs.push(fullEntry);
    }
  }
}
