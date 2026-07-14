/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { CompilerContext } from '../compiler-context.js';
import { extractStringValue, getCstRange } from '../ast-helpers.js';

/**
 * File upload configuration matching agent-dsl FileUploadConfig.
 */
export interface FileUploadConfiguration {
  mode: 'auto' | 'managed' | 'disabled' | 'error';
  message?: string;
}

/**
 * Compile file_upload block (nested under config) from AST to AgentJSON format.
 */
export function compileFileUpload(
  fileUploadBlock: unknown | undefined,
  ctx: CompilerContext
): FileUploadConfiguration | undefined {
  if (!fileUploadBlock) return undefined;

  const block = fileUploadBlock as Record<string, unknown>;
  const mode = extractStringValue(block.mode);

  if (!mode) {
    ctx.error('file_upload block requires mode to be set', getCstRange(block));
    return undefined;
  }

  if (!['auto', 'managed', 'disabled', 'error'].includes(mode)) {
    ctx.error(
      `Invalid file_upload mode: "${mode}". Must be one of: auto, managed, disabled, error`,
      getCstRange(block.mode)
    );
    return undefined;
  }

  const result: FileUploadConfiguration = {
    mode: mode as 'auto' | 'managed' | 'disabled' | 'error',
  };

  if (block.message) {
    const message = extractStringValue(block.message);
    if (message) {
      result.message = message;
    }
  }

  return result;
}
