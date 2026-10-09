/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared bootstrap for the LIVE OpenAI examples in this directory. Loads the
 * repo-root `.env`, builds a real `@ai-sdk/openai` model, and returns the
 * exact `VercelDriverOptions` shape `createAgent({ llm })` expects.
 *
 * `gpt-5.6` (the model this repo's `.env` configures) rejects tool-calling
 * requests under its default reasoning settings — the Chat Completions API
 * returns "Function tools with reasoning_effort are not supported ... set
 * reasoning_effort to 'none'". `providerOptions.openai.reasoningEffort:
 * 'none'` is that workaround, forwarded verbatim by `VercelAiSdkDriver`.
 *
 * Never logs the API key — only provider/model/baseURL.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { generateText, jsonSchema, streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import type { VercelDriverOptions } from '../../src/driver.js';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Loads the first `.env` found (repo root, then cwd) without printing its contents. */
export function loadEnv(): string | null {
  const candidates = [
    join(HERE, '..', '..', '..', '..', '.env'), // repo root
    resolve(process.cwd(), '.env'),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      process.loadEnvFile(path);
      return path;
    }
  }
  return null;
}

export const CONFIGURE_HINT =
  'set OPENAI_API_KEY (and optionally AGENT_MODEL, default gpt-4o-mini) in .env';

/**
 * Resolves a live OpenAI-backed `VercelDriverOptions`, or `null` if
 * `OPENAI_API_KEY` isn't set — callers should skip cleanly in that case.
 */
export function resolveLiveOpenAi(): {
  llm: VercelDriverOptions;
  modelId: string;
} | null {
  loadEnv();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const modelId = process.env.AGENT_MODEL || 'gpt-4o-mini';

  const openai = createOpenAI({ apiKey });
  const llm: VercelDriverOptions = {
    model: openai.chat(modelId),
    generateText,
    jsonSchema,
    streamText,
    // Required for tool-calling to work at all against reasoning models
    // (e.g. gpt-5.x) via the Chat Completions API — see file header.
    providerOptions: { openai: { reasoningEffort: 'none' } },
  };
  return { llm, modelId };
}
