/**
 * Shared test utilities for @agentscript/agentforce tests.
 */

import { parse } from '@agentscript/parser';
import type { AgentScriptParser } from '../src/types.js';

export function getParser(): AgentScriptParser {
  return { parse: (source: string) => parse(source) };
}
