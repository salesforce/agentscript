#!/usr/bin/env node

/**
 * Node.js LSP Server Entry Point for AgentScript.
 *
 * Thin wrapper that creates a Node.js LSP connection and calls setupServer()
 * from @agentscript/lsp with the parser-javascript parser and all known dialects.
 */

import { createConnection } from 'vscode-languageserver/node.js';
import { setupServer } from '@agentscript/lsp';
import { createServerConfig } from './config.js';

// Use build-time inlined query if available (set by esbuild define),
// otherwise fall back to reading from disk (dev mode).
const config = createServerConfig();

// Create Node.js connection (auto-detects IPC/stdio)
const connection = createConnection();

// Set up all LSP handlers
setupServer(connection, config);

connection.console.log('[LSP Server] AgentScript Language Server started');
