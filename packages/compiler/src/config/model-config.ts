/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { Expression } from '@agentscript/language';
import type { Range } from '@agentscript/types';
import type { ModelConfiguration } from '../types.js';
import type { ParsedAgentforce, ParsedTopicLike } from '../parsed-types.js';
import type { CompilerContext } from '../compiler-context.js';
import {
  extractStringValue,
  extractDictExpression,
  extractExpressionValue,
} from '../ast-helpers.js';
import { parseUri } from '../utils.js';

/**
 * Shared helper to extract model URI and params from a model_config block.
 */
function extractModelAndParams(
  modelValue: unknown,
  paramsValue: unknown,
  ctx: CompilerContext,
  modelRange?: Range
): { modelRef: string | null; params?: Record<string, unknown> } | undefined {
  let modelRef: string | null = null;

  // Extract model if present
  if (modelValue !== undefined) {
    const modelStr = extractStringValue(modelValue);
    if (modelStr) {
      const { scheme, path } = parseUri(modelStr);

      // Validate that URI scheme is present (e.g., "model://...")
      if (!scheme) {
        ctx.error(
          `Model URI must include a scheme (e.g., "model://..."). Got: "${modelStr}"`,
          modelRange
        );
        return undefined; // Invalid model URI format
      }

      modelRef = path;
    }
  }

  // Extract params if present (can be a DictLiteral or a Block with properties)
  let params: Record<string, unknown> | undefined;
  if (paramsValue !== undefined && paramsValue !== null) {
    // Try as dict literal first
    if (
      typeof paramsValue === 'object' &&
      (paramsValue as Expression).__kind === 'DictLiteral'
    ) {
      params = extractDictExpression(paramsValue as Expression);
    } else if (typeof paramsValue === 'object') {
      // Extract as block properties (key-value pairs)
      params = extractBlockParams(paramsValue, ctx);
    }
  }

  return { modelRef, params };
}

/**
 * Extract model_config from the global parsed structure (agent-wide defaults).
 * Global config requires a model field.
 */
export function extractGlobalModelConfiguration(
  parsed: ParsedAgentforce,
  ctx: CompilerContext
): ModelConfiguration | undefined {
  if (!parsed.model_config) return undefined;

  const result = extractModelAndParams(
    parsed.model_config.model,
    parsed.model_config.params,
    ctx,
    parsed.model_config.model?.__cst?.range
  );

  if (!result) return undefined;

  // Global config requires model field - warn if only params provided
  if (!result.modelRef) {
    if (result.params) {
      ctx.warning(
        'Global model_config has parameters but no model specified. Parameters will be ignored. ' +
          'Global model_config requires a model field (e.g., model: "model://gpt-4"). ' +
          'To apply parameters to specific topics, use topic-level model_config.',
        parsed.model_config.__cst?.range
      );
    }
    return undefined;
  }

  const modelConfig: ModelConfiguration = { model_ref: result.modelRef };
  if (result.params) {
    modelConfig.configuration = result.params;
  }

  return modelConfig;
}

/**
 * Extract parameters from a params block as key-value pairs.
 * Uses extractExpressionValue for value extraction, which supports
 * strings, numbers, booleans, arrays, and nested dicts.
 */
export function extractBlockParams(
  paramsBlock: unknown,
  ctx?: CompilerContext
): Record<string, unknown> | undefined {
  if (!paramsBlock || typeof paramsBlock !== 'object') return undefined;

  const result: Record<string, unknown> = {};
  const block = paramsBlock as Record<string, unknown>;

  // Iterate over all properties in the block
  for (const [key, value] of Object.entries(block)) {
    // Skip internal properties
    if (key.startsWith('__') || key === 'description') continue;

    const extractedValue = extractExpressionValue(value);

    if (extractedValue !== undefined) {
      result[key] = extractedValue;
    } else if (
      ctx &&
      value &&
      typeof value === 'object' &&
      (value as { __kind?: string }).__kind
    ) {
      // Warn for unrecognized expression types
      ctx.warning(
        `Unsupported parameter value type "${(value as { __kind: string }).__kind}" — this value will be ignored. ` +
          'Supported types are strings, numbers, booleans, arrays, and dicts.',
        (value as { __cst?: { range?: Range } }).__cst?.range
      );
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Extract model_config from a topic block (for both router and subagent nodes).
 * Topic config allows params-only (no model required).
 */
export function extractTopicModelConfiguration(
  topicBlock: ParsedTopicLike,
  ctx: CompilerContext
): ModelConfiguration | undefined {
  if (!topicBlock.model_config) return undefined;

  const result = extractModelAndParams(
    topicBlock.model_config.model,
    topicBlock.model_config.params,
    ctx,
    topicBlock.model_config.model?.__cst?.range
  );

  if (!result) return undefined;

  // Return undefined if neither model nor params were extracted
  if (!result.modelRef && !result.params) {
    return undefined;
  }

  const config: ModelConfiguration = { model_ref: result.modelRef };
  if (result.params) {
    config.configuration = result.params;
  }

  return config;
}

/**
 * Merge config-level and topic-level model configurations.
 * Topic-level settings override config-level settings.
 * Params are merged (topic params override config params for same keys).
 */
export function mergeModelConfigurations(
  globalConfig: ModelConfiguration | undefined,
  topicConfig: ModelConfiguration | undefined
): ModelConfiguration | undefined {
  if (!topicConfig && !globalConfig) return undefined;
  if (!globalConfig) return topicConfig;
  if (!topicConfig) return globalConfig;

  const merged: ModelConfiguration = {
    model_ref:
      topicConfig.model_ref !== null && topicConfig.model_ref !== undefined
        ? topicConfig.model_ref
        : globalConfig.model_ref,
  };

  // Merge params if either side has them
  if (globalConfig.configuration || topicConfig.configuration) {
    merged.configuration = {
      ...globalConfig.configuration,
      ...topicConfig.configuration,
    };
  }

  return merged;
}
