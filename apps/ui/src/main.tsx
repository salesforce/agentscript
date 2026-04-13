/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { BrowserRouter } from 'react-router';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { initDevEnvironment, seedDefaultAgents } from './lib/dev-helpers';

// Initialize development environment (only in dev mode)
initDevEnvironment();

// Seed built-in examples if the store is empty
seedDefaultAgents();

createRoot(document.getElementById('root')!).render(
  <BrowserRouter basename={import.meta.env.BASE_URL}>
    <App />
  </BrowserRouter>
);
