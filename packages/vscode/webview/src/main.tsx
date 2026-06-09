/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { FlowApp } from './FlowApp';
import './flow.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <FlowApp />
  </React.StrictMode>
);
