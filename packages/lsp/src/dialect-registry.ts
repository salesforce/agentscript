/**
 * Default dialect registry for AgentScript LSP servers.
 *
 * Both the Node.js and browser LSP entry points import from here so there
 * is exactly one place to add a new dialect.
 *
 * To add a dialect:
 * 1. Create your dialect package (see `dialect/` directory for examples)
 * 2. Import and add it to the array below
 * 3. All LSP servers and the UI will pick it up automatically
 */

import type { DialectConfig } from '@agentscript/language';
import { agentforceDialect } from '@agentscript/agentforce-dialect';
import { agentscriptDialect } from '@agentscript/agentscript-dialect';
import { agentfabricDialect } from '@agentscript/agentfabric-dialect';

/** All available dialects. First entry is the default when no annotation is present. */
export const defaultDialects: DialectConfig[] = [
  agentforceDialect,
  agentscriptDialect,
  agentfabricDialect,
];
