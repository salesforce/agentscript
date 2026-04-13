/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { createContext, useContext, useState, type ReactNode } from 'react';
import type * as monaco from 'monaco-editor';
import type { AgentScriptLspClient } from '~/lib/lsp-client';

interface MonacoEditorContextValue {
  editor: monaco.editor.IStandaloneCodeEditor | null;
  setEditor: (editor: monaco.editor.IStandaloneCodeEditor | null) => void;
  lspClient: AgentScriptLspClient | null;
  setLspClient: (client: AgentScriptLspClient | null) => void;
  syncLspModel: (model: monaco.editor.ITextModel) => Promise<void>;
  setSyncLspModel: (
    sync: (model: monaco.editor.ITextModel) => Promise<void>
  ) => void;
  closeLspDocument: (uri: string) => void;
  setCloseLspDocument: (close: (uri: string) => void) => void;
}

const MonacoEditorContext = createContext<MonacoEditorContextValue | null>(
  null
);

export function MonacoEditorProvider({ children }: { children: ReactNode }) {
  const [editor, setEditor] =
    useState<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [lspClient, setLspClient] = useState<AgentScriptLspClient | null>(null);
  const [syncLspModel, setSyncLspModel] = useState<
    (model: monaco.editor.ITextModel) => Promise<void>
  >(() => async () => {});
  const [closeLspDocument, setCloseLspDocument] = useState<
    (uri: string) => void
  >(() => () => {});

  return (
    <MonacoEditorContext.Provider
      value={{
        editor,
        setEditor,
        lspClient,
        setLspClient,
        syncLspModel,
        setSyncLspModel,
        closeLspDocument,
        setCloseLspDocument,
      }}
    >
      {children}
    </MonacoEditorContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useMonacoEditor() {
  const context = useContext(MonacoEditorContext);
  if (!context) {
    throw new Error('useMonacoEditor must be used within MonacoEditorProvider');
  }
  return context;
}
