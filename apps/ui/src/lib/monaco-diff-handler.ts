/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import * as monaco from 'monaco-editor';

/**
 * Represents a code change suggestion from the AI
 */
export interface CodeChange {
  id: string;
  startLine: number;
  endLine: number;
  newCode: string;
  description?: string;
}

/**
 * Monaco Diff Handler - Uses Monaco's built-in DiffEditor
 */
export class MonacoDiffHandler {
  private editor: monaco.editor.IStandaloneCodeEditor;
  private diffEditor: monaco.editor.IStandaloneDiffEditor | null = null;
  private container: HTMLElement;
  private pendingChanges: Map<string, CodeChange> = new Map();
  private originalContent: string = '';
  private onSwitchToDiff?: () => void;
  private onSwitchToNormal?: () => void;
  private currentChangeIndex: number = 0;

  constructor(
    editor: monaco.editor.IStandaloneCodeEditor,
    container: HTMLElement,
    onSwitchToDiff?: () => void,
    onSwitchToNormal?: () => void
  ) {
    this.editor = editor;
    this.container = container;
    this.onSwitchToDiff = onSwitchToDiff;
    this.onSwitchToNormal = onSwitchToNormal;
  }

  /**
   * Add a code change - switches to diff mode
   */
  addChange(change: CodeChange) {
    if (this.pendingChanges.has(change.id)) {
      console.warn(`Change ${change.id} already exists, skipping duplicate`);
      return;
    }

    this.pendingChanges.set(change.id, change);

    // Switch to diff mode or update existing diff view
    if (this.diffEditor) {
      // Diff view already exists, just update the models with new changes
      this.updateDiffView();
    } else {
      // Create new diff view
      this.showDiffView();
    }
  }

  /**
   * Show Monaco's built-in diff editor
   */
  private showDiffView() {
    if (this.diffEditor) return; // Already in diff mode

    // Save original content
    this.originalContent = this.editor.getValue();

    // Apply all pending changes to create modified version
    const modifiedContent = this.applyAllChanges(this.originalContent);

    // Hide the normal editor
    this.editor.updateOptions({ readOnly: true });
    (this.editor.getDomNode() as HTMLElement).style.display = 'none';

    // Create diff editor
    this.diffEditor = monaco.editor.createDiffEditor(this.container, {
      readOnly: false,
      renderSideBySide: false, // Inline diff
      originalEditable: false,
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      fontSize: 13,
      lineNumbers: 'on',
      renderLineHighlight: 'all',
      theme: 'agentscript-light',
    });

    // Create models
    const originalModel = monaco.editor.createModel(
      this.originalContent,
      'agentscript'
    );
    const modifiedModel = monaco.editor.createModel(
      modifiedContent,
      'agentscript'
    );

    this.diffEditor.setModel({
      original: originalModel,
      modified: modifiedModel,
    });

    this.onSwitchToDiff?.();

    // Reset to first change and scroll to it
    this.currentChangeIndex = 0;
    // Use setTimeout to ensure the editor is fully rendered before scrolling
    setTimeout(() => {
      this.scrollToCurrentChange();
    }, 100);
  }

  /**
   * Update the diff view with current pending changes
   */
  private updateDiffView() {
    if (!this.diffEditor) return;

    // Apply all pending changes to create updated modified version
    const modifiedContent = this.applyAllChanges(this.originalContent);

    // Get the current modified model and update its content
    const currentModel = this.diffEditor.getModel();
    if (currentModel?.modified) {
      currentModel.modified.setValue(modifiedContent);
    }
  }

  /**
   * Apply all pending changes to content
   */
  private applyAllChanges(content: string): string {
    const lines = content.split('\n');

    // Sort changes by line number (descending) to apply from bottom to top
    const sortedChanges = Array.from(this.pendingChanges.values()).sort(
      (a, b) => b.startLine - a.startLine
    );

    for (const change of sortedChanges) {
      const newLines = change.newCode.split('\n');
      // Replace lines (Monaco uses 1-based, but array is 0-based)
      lines.splice(
        change.startLine - 1,
        change.endLine - change.startLine + 1,
        ...newLines
      );
    }

    return lines.join('\n');
  }

  /**
   * Accept all changes and return to normal editor
   */
  acceptAllChanges(onPersist?: (changes: CodeChange[]) => void): boolean {
    if (!this.diffEditor) return false;

    const modifiedModel = this.diffEditor.getModel()?.modified;
    if (!modifiedModel) return false;

    const newContent = modifiedModel.getValue();

    // Get all changes before clearing
    const changes = Array.from(this.pendingChanges.values());

    // Dispose diff editor
    this.disposeDiffEditor();

    // Update normal editor with new content
    this.editor.setValue(newContent);
    this.editor.updateOptions({ readOnly: false });
    (this.editor.getDomNode() as HTMLElement).style.display = 'block';

    // Clear pending changes
    this.pendingChanges.clear();
    this.currentChangeIndex = 0;

    // Persist the decisions
    onPersist?.(changes);

    this.onSwitchToNormal?.();
    return true;
  }

  /**
   * Reject all changes and return to normal editor
   */
  rejectAllChanges(onPersist?: (changes: CodeChange[]) => void): boolean {
    if (!this.diffEditor) return false;

    // Get all changes before clearing
    const changes = Array.from(this.pendingChanges.values());

    // Dispose diff editor
    this.disposeDiffEditor();

    // Restore original editor
    this.editor.updateOptions({ readOnly: false });
    (this.editor.getDomNode() as HTMLElement).style.display = 'block';

    // Clear pending changes
    this.pendingChanges.clear();
    this.currentChangeIndex = 0;

    // Persist the decisions
    onPersist?.(changes);

    this.onSwitchToNormal?.();
    return true;
  }

  /**
   * Dispose the diff editor
   */
  private disposeDiffEditor() {
    if (this.diffEditor) {
      const model = this.diffEditor.getModel();
      this.diffEditor.dispose();
      this.diffEditor = null;

      // Dispose models
      if (model) {
        model.original?.dispose();
        model.modified?.dispose();
      }
    }
  }

  /**
   * Get all pending changes
   */
  getPendingChanges(): CodeChange[] {
    return Array.from(this.pendingChanges.values());
  }

  /**
   * Get count of pending changes
   */
  getPendingCount(): number {
    return this.pendingChanges.size;
  }

  /**
   * Check if in diff mode
   */
  isInDiffMode(): boolean {
    return this.diffEditor !== null;
  }

  /**
   * Get the diff editor instance (for validation purposes)
   */
  getDiffEditor(): monaco.editor.IStandaloneDiffEditor | null {
    return this.diffEditor;
  }

  /**
   * Get the normal editor instance
   */
  getEditor(): monaco.editor.IStandaloneCodeEditor {
    return this.editor;
  }

  /**
   * Clear all pending changes
   */
  clearAll() {
    if (this.diffEditor) {
      this.rejectAllChanges();
    } else {
      this.pendingChanges.clear();
    }
    this.currentChangeIndex = 0;
  }

  /**
   * Handle glyph margin click (not used in diff mode)
   */
  handleGlyphMarginClick() {
    // Not applicable in diff mode
  }

  /**
   * Get a specific change by ID
   */
  getChange(id: string): CodeChange | undefined {
    return this.pendingChanges.get(id);
  }

  /**
   * Accept a specific change (not supported in full diff mode)
   */
  acceptChange(): boolean {
    // In full diff mode, accept all or nothing
    return this.acceptAllChanges();
  }

  /**
   * Reject a specific change (not supported in full diff mode)
   */
  rejectChange(): boolean {
    // In full diff mode, accept all or nothing
    return this.rejectAllChanges();
  }

  /**
   * Get current change index (0-based)
   */
  getCurrentChangeIndex(): number {
    return this.currentChangeIndex;
  }

  /**
   * Navigate to next change (wraps to first when at end)
   */
  nextChange(): boolean {
    if (!this.diffEditor || this.pendingChanges.size === 0) return false;

    const changes = this.getSortedChanges();
    if (this.currentChangeIndex < changes.length - 1) {
      this.currentChangeIndex++;
    } else {
      // Wrap to first change
      this.currentChangeIndex = 0;
    }
    this.scrollToCurrentChange();
    return true;
  }

  /**
   * Navigate to previous change (wraps to last when at start)
   */
  previousChange(): boolean {
    if (!this.diffEditor || this.pendingChanges.size === 0) return false;

    const changes = this.getSortedChanges();
    if (this.currentChangeIndex > 0) {
      this.currentChangeIndex--;
    } else {
      // Wrap to last change
      this.currentChangeIndex = changes.length - 1;
    }
    this.scrollToCurrentChange();
    return true;
  }

  /**
   * Get changes sorted by line number
   */
  private getSortedChanges(): CodeChange[] {
    return Array.from(this.pendingChanges.values()).sort(
      (a, b) => a.startLine - b.startLine
    );
  }

  /**
   * Scroll to the current change in the diff editor
   */
  private scrollToCurrentChange() {
    if (!this.diffEditor) return;

    const changes = this.getSortedChanges();
    const currentChange = changes[this.currentChangeIndex];
    if (!currentChange) return;

    // Get the modified editor (right side of diff)
    const modifiedEditor = this.diffEditor.getModifiedEditor();
    if (!modifiedEditor) return;

    // Scroll to the change and highlight it
    modifiedEditor.revealLineInCenter(
      currentChange.startLine,
      monaco.editor.ScrollType.Smooth
    );

    // Set selection to highlight the changed lines
    modifiedEditor.setSelection({
      startLineNumber: currentChange.startLine,
      startColumn: 1,
      endLineNumber: currentChange.endLine,
      endColumn:
        modifiedEditor.getModel()?.getLineMaxColumn(currentChange.endLine) || 1,
    });

    // Focus the modified editor
    modifiedEditor.focus();
  }

  /**
   * Dispose handler and clean up
   */
  dispose() {
    this.disposeDiffEditor();
    this.pendingChanges.clear();
  }
}

/**
 * Factory function to create a diff handler
 */
export function createDiffHandler(
  editor: monaco.editor.IStandaloneCodeEditor,
  container: HTMLElement,
  onSwitchToDiff?: () => void,
  onSwitchToNormal?: () => void
): MonacoDiffHandler {
  return new MonacoDiffHandler(
    editor,
    container,
    onSwitchToDiff,
    onSwitchToNormal
  );
}
