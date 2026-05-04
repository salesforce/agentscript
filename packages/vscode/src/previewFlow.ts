/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Agent Script flow preview commands.
 *
 * Opens a side webview panel that renders the agent graph using the shared
 * @agentscript/graph-ui component. Live-updates on document changes with
 * 250ms debounce. Follows Markdown Preview UX with three commands.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const FLOW_VIEW_TYPE = 'agentscript.flow.preview';
const DEBOUNCE_MS = 250;

const COMMAND_SHOW_PREVIEW = 'agentscript.flow.showPreview';
const COMMAND_SHOW_PREVIEW_TO_SIDE = 'agentscript.flow.showPreviewToSide';
const COMMAND_SHOW_SOURCE = 'agentscript.flow.showSource';

interface FlowPanelState {
  uri: string;
}

class FlowPanelManager {
  private readonly panels = new Map<string, vscode.WebviewPanel>();
  private readonly debouncers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly context: vscode.ExtensionContext) {
    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument(e => {
        this.scheduleUpdate(e.document);
      })
    );
  }

  public async open(uri: vscode.Uri, column: vscode.ViewColumn): Promise<void> {
    const key = uri.toString();
    const existing = this.panels.get(key);
    if (existing) {
      existing.reveal(column, true);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      FLOW_VIEW_TYPE,
      `Preview ${path.basename(uri.fsPath)}`,
      { viewColumn: column, preserveFocus: true },
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview'),
        ],
      }
    );

    this.registerPanel(panel, uri);

    const doc = await vscode.workspace.openTextDocument(uri);
    this.postSource(panel, doc);
  }

  public async restore(
    panel: vscode.WebviewPanel,
    state: FlowPanelState
  ): Promise<void> {
    try {
      const uri = vscode.Uri.parse(state.uri);
      this.registerPanel(panel, uri);
      const doc = await vscode.workspace.openTextDocument(uri);
      this.postSource(panel, doc);
    } catch {
      panel.dispose();
    }
  }

  public async showSource(): Promise<void> {
    for (const [key, panel] of this.panels) {
      if (panel.active) {
        const uri = vscode.Uri.parse(key);
        await vscode.window.showTextDocument(uri, {
          viewColumn: vscode.ViewColumn.Beside,
          preserveFocus: false,
        });
        return;
      }
    }
  }

  private registerPanel(panel: vscode.WebviewPanel, uri: vscode.Uri): void {
    const key = uri.toString();
    this.panels.set(key, panel);

    panel.webview.html = this.getHtml();
    panel.webview.onDidReceiveMessage(msg => this.handleMessage(msg, uri));

    panel.onDidDispose(() => {
      this.panels.delete(key);
      const t = this.debouncers.get(key);
      if (t) {
        clearTimeout(t);
        this.debouncers.delete(key);
      }
    });
  }

  private scheduleUpdate(doc: vscode.TextDocument): void {
    const key = doc.uri.toString();
    const panel = this.panels.get(key);
    if (!panel) return;
    const existing = this.debouncers.get(key);
    if (existing) clearTimeout(existing);
    this.debouncers.set(
      key,
      setTimeout(() => {
        this.debouncers.delete(key);
        this.postSource(panel, doc);
      }, DEBOUNCE_MS)
    );
  }

  private postSource(
    panel: vscode.WebviewPanel,
    doc: vscode.TextDocument
  ): void {
    void panel.webview.postMessage({
      type: 'source',
      uri: doc.uri.toString(),
      text: doc.getText(),
      version: doc.version,
    });
  }

  private async handleMessage(
    msg: { type: string; [k: string]: unknown },
    uri: vscode.Uri
  ): Promise<void> {
    if (msg.type === 'ready') {
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        const panel = this.panels.get(uri.toString());
        if (panel) this.postSource(panel, doc);
      } catch {
        // file may have been deleted
      }
    }
  }

  private getHtml(): string {
    const htmlPath = path.join(
      this.context.extensionPath,
      'dist',
      'webview',
      'flow.html'
    );
    let html = fs.readFileSync(htmlPath, 'utf8');
    const vscodeScript = `
      <script>
        const vscode = acquireVsCodeApi();
        window.acquireVsCodeApi = () => vscode;
      </script>
    `;
    html = html.replace('</head>', `${vscodeScript}</head>`);
    return html;
  }
}

class FlowPanelSerializer implements vscode.WebviewPanelSerializer {
  constructor(private readonly manager: FlowPanelManager) {}
  async deserializeWebviewPanel(
    panel: vscode.WebviewPanel,
    state: unknown
  ): Promise<void> {
    const s = (state ?? {}) as Partial<FlowPanelState>;
    if (!s.uri) {
      panel.dispose();
      return;
    }
    await this.manager.restore(panel, s as FlowPanelState);
  }
}

export function registerFlowPreviewCommands(
  context: vscode.ExtensionContext
): vscode.Disposable {
  const manager = new FlowPanelManager(context);

  const resolveUri = (uri?: vscode.Uri): vscode.Uri | undefined =>
    uri ?? vscode.window.activeTextEditor?.document.uri;

  const disposables: vscode.Disposable[] = [];

  disposables.push(
    vscode.commands.registerCommand(
      COMMAND_SHOW_PREVIEW,
      async (uri?: vscode.Uri) => {
        const resolved = resolveUri(uri);
        if (!resolved) return;
        await manager.open(resolved, vscode.ViewColumn.Active);
      }
    )
  );

  disposables.push(
    vscode.commands.registerCommand(
      COMMAND_SHOW_PREVIEW_TO_SIDE,
      async (uri?: vscode.Uri) => {
        const resolved = resolveUri(uri);
        if (!resolved) return;
        await manager.open(resolved, vscode.ViewColumn.Beside);
      }
    )
  );

  disposables.push(
    vscode.commands.registerCommand(COMMAND_SHOW_SOURCE, async () => {
      await manager.showSource();
    })
  );

  disposables.push(
    vscode.window.registerWebviewPanelSerializer(
      FLOW_VIEW_TYPE,
      new FlowPanelSerializer(manager)
    )
  );

  return vscode.Disposable.from(...disposables);
}
