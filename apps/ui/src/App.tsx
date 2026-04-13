/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { Routes, Route, Navigate } from 'react-router';
import { Welcome } from './pages/Welcome';
import { IDELayout } from './components/layouts/IDELayout';
import { AgentsList } from './pages/AgentsList';
import { Script } from './pages/Script';
import { Simulate } from './pages/Simulate';
import { Builder } from './pages/Builder';
import { Graph } from './pages/Graph';
import { Component } from './pages/Component';
import { NotFound } from './pages/NotFound';
import { useTheme } from './hooks/useTheme';
import { Toaster } from './components/ui/sonner';
import { featureFlags } from './lib/feature-flags';

function App() {
  // Apply theme globally
  useTheme();

  return (
    <>
      <Routes>
        <Route path="/" element={<Welcome />} />
        <Route path="agents" element={<IDELayout />}>
          <Route index element={<AgentsList />} />
          <Route path="component" element={<Component />} />
          <Route path="component/:kind" element={<Component />} />
          <Route path=":agentId" element={<Navigate to="script" replace />} />
          {featureFlags.builder && (
            <>
              <Route path=":agentId/builder" element={<Builder />} />
              <Route path=":agentId/builder/:nodeId" element={<Builder />} />
              <Route
                path=":agentId/builder/:blockType/:blockName"
                element={<Builder />}
              />
              <Route
                path=":agentId/builder/:topicName/action/:actionName"
                element={<Builder />}
              />
            </>
          )}
          <Route path=":agentId/graph" element={<Graph />} />
          <Route path=":agentId/graph/:topicId" element={<Graph />} />
          <Route path=":agentId/script" element={<Script />} />
          {featureFlags.simulate && (
            <Route path=":agentId/simulate" element={<Simulate />} />
          )}
          <Route path=":agentId/component" element={<Component />} />
          <Route path=":agentId/component/:kind" element={<Component />} />
          <Route path=":agentId/*" element={<NotFound />} />
        </Route>
      </Routes>
      <Toaster />
    </>
  );
}

export default App;
