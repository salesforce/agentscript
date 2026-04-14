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
import 'web-tree-sitter';

// Import WASM constants to bundle them (generated during build)
import {
  TREE_SITTER_ENGINE_BASE64,
  TREE_SITTER_AGENTSCRIPT_BASE64,
} from './wasm-constants-generated.js';

// Join chunks back into base64 strings
const engineBase64 = TREE_SITTER_ENGINE_BASE64.join('');
const agentscriptBase64 = TREE_SITTER_AGENTSCRIPT_BASE64.join('');

/**
 * Convenience function to initialize the parser with bundled WASM
 * This is simpler than calling init() manually
 */
async function initParser() {
  return AgentforceScriptSDK.init();
}

// Mount everything on window for script tag usage
if (typeof globalThis !== 'undefined' && 'window' in globalThis) {
  (window as Record<string, unknown>).AgentforceScriptSDK = {
    ...AgentforceScriptSDK,
    version: __PACKAGE_VERSION__,
    // Include WASM constants so no imports are needed
    TREE_SITTER_ENGINE_BASE64: engineBase64,
    TREE_SITTER_AGENTSCRIPT_BASE64: agentscriptBase64,
    // Add convenience function
    initParser,
  };
}

// Also export for module usage (though IIFE is meant for script tags)
export * from './index.js';
export {
  engineBase64 as TREE_SITTER_ENGINE_BASE64,
  agentscriptBase64 as TREE_SITTER_AGENTSCRIPT_BASE64,
  initParser,
};
