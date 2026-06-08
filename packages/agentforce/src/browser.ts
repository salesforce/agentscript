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
  (window as Record<string, unknown>).AgentforceScriptSDK = AgentforceScriptSDK;
}

// Also export for module usage
export * from './index.js';
