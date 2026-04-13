/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Shared dialect registry for the UI application.
 *
 * Re-exports the canonical dialect list from @agentscript/lsp so there is
 * exactly one place to add a new dialect.
 */

export { defaultDialects as dialects } from '@agentscript/lsp';
