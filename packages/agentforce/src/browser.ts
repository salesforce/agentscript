/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Browser-optimized entry point for @agentscript/agentforce
 *
 * This bundle includes web-tree-sitter and provides a self-contained
 * browser solution. Mounts everything on window.AgentforceScriptSDK
 */

import * as AgentforceScriptSDK from './index.js';
import 'web-tree-sitter';

// Mount on window for script tag usage
if (typeof globalThis !== 'undefined' && 'window' in globalThis) {
  (window as unknown as Record<string, unknown>).AgentforceScriptSDK =
    AgentforceScriptSDK;
}

// Also export for module usage
export * from './index.js';
