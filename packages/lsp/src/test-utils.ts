/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Shared test utilities for LSP tests.
 *
 * Provides a pre-configured LspConfig using the TypeScript parser
 * and the agentscript dialect.
 */

import { parse } from '@agentscript/parser';
import { agentscriptDialect } from '@agentscript/agentscript-dialect';
import type { LspConfig } from './lsp-config.js';

/** LspConfig suitable for tests — uses TypeScript parser + agentscript dialect. */
export const testConfig: LspConfig = {
  dialects: [agentscriptDialect],
  parser: { parse },
};
