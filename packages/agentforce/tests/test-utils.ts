/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Shared test utilities for @agentscript/agentforce tests.
 */

import { parse } from '@agentscript/parser';
import type { AgentScriptParser } from '../src/types.js';

export function getParser(): AgentScriptParser {
  return { parse: (source: string) => parse(source) };
}
