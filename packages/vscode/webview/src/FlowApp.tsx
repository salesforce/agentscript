/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { parse } from '@agentscript/agentforce';
import { Graph, type AgentScriptAST } from '@agentscript/graph-ui';

interface SourceMessage {
  type: 'source';
  uri: string;
  text: string;
  version: number;
}

interface VscodeApi {
  postMessage(msg: unknown): void;
  setState(state: unknown): void;
  getState<T = unknown>(): T | undefined;
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VscodeApi;
  }
}

function useVscodeApi(): VscodeApi | null {
  const [api] = useState<VscodeApi | null>(() => {
    if (typeof window === 'undefined') return null;
    return window.acquireVsCodeApi?.() ?? null;
  });
  return api;
}

type Theme = 'light' | 'dark';

function detectTheme(): Theme {
  if (typeof document === 'undefined') return 'light';
  const cls = document.body.className;
  if (cls.includes('vscode-dark') || cls.includes('vscode-high-contrast')) {
    return 'dark';
  }
  return 'light';
}

function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(detectTheme);
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(detectTheme()));
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, []);
  return theme;
}

export function FlowApp() {
  const api = useVscodeApi();
  const theme = useTheme();
  const [source, setSource] = useState<string>('');
  const [topicId, setTopicId] = useState<string | undefined>();

  useEffect(() => {
    if (!api) return;
    const handler = (event: MessageEvent<SourceMessage>) => {
      if (event.data.type === 'source') {
        setSource(event.data.text);
      }
    };
    window.addEventListener('message', handler);
    api.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', handler);
  }, [api]);

  const ast = useMemo<AgentScriptAST | null>(() => {
    if (!source) return null;
    try {
      const parsed = parse(source);
      return parsed.ast as unknown as AgentScriptAST;
    } catch {
      return null;
    }
  }, [source]);

  const handleTopicOpen = useCallback((topicName: string) => {
    setTopicId(topicName);
  }, []);

  const handleBack = useCallback(() => setTopicId(undefined), []);

  return (
    <div
      className={`relative h-full w-full overflow-hidden ${theme === 'dark' ? 'dark bg-zinc-950 text-white' : 'bg-white text-gray-900'}`}
    >
      <Graph
        ast={ast}
        topicId={topicId}
        theme={theme}
        onTopicOpen={handleTopicOpen}
      />

      {topicId ? (
        <div className="pointer-events-none absolute top-0 left-0 z-10 flex h-10 select-none items-center gap-2 px-3 text-sm">
          <button
            type="button"
            onClick={handleBack}
            title="Back to overview"
            className="pointer-events-auto flex h-6 w-6 items-center justify-center rounded text-gray-700 hover:bg-gray-200 hover:text-gray-900 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="font-medium">Topic: {topicId}</span>
        </div>
      ) : null}
    </div>
  );
}
