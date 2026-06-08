/**
 * Default dialect registry for AgentScript LSP servers.
 *
 * Both the Node.js and browser LSP entry points import from here. Consumers
 * that need additional dialects (e.g. agentfabric in apps/ui) compose their
 * own list by spreading `defaultDialects` and appending the extra dialect.
 */

import type { DialectConfig } from '@agentscript/language';
import { agentforceDialect } from '@agentscript/agentforce-dialect';
import { agentscriptDialect } from '@agentscript/agentscript-dialect';

/** All available dialects. First entry is the default when no annotation is present. */
export const defaultDialects: DialectConfig[] = [
  agentforceDialect,
  agentscriptDialect,
];
