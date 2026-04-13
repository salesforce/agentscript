/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Browser IIFE entry point for @agentscript/agentforce
 *
 * This bundle is completely self-sufficient - includes everything:
 * - All SDK code
 * - web-tree-sitter
 * - WASM binaries (base64 encoded)
 *
 * Just load via script tag and use window.AgentforceScriptSDK
 * No imports needed!
 */

declare const __PACKAGE_VERSION__: string;

import * as AgentforceScriptSDK from './index.js';

// Mount everything on window for script tag usage
if (typeof globalThis !== 'undefined' && 'window' in globalThis) {
  (window as unknown as Record<string, unknown>).AgentforceScriptSDK = {
    ...AgentforceScriptSDK,
    version: __PACKAGE_VERSION__,
  };
}

// Also export for module usage (though IIFE is meant for script tags)
export * from './index.js';
