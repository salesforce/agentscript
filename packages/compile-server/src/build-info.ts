/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface EmbeddedBuildInfo {
  git_commit?: string;
  git_sha?: string;
}

interface PackageInfo {
  version?: string;
}

export interface BuildMetadata {
  git_commit: string;
  git_sha: string;
  version: string;
}

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function readJsonObject(path: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    return typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function stringField(
  value: Record<string, unknown>,
  field: string
): string | undefined {
  const candidate = value[field];
  return typeof candidate === 'string' && candidate.length > 0
    ? candidate
    : undefined;
}

const packageJson = readJsonObject(join(packageRoot, 'package.json'));
const packageInfo: PackageInfo = {
  version: stringField(packageJson, 'version'),
};
const embeddedJson = readJsonObject(join(packageRoot, 'build-info.json'));
const embeddedBuildInfo: EmbeddedBuildInfo = {
  git_commit: stringField(embeddedJson, 'git_commit'),
  git_sha: stringField(embeddedJson, 'git_sha'),
};

/**
 * Return metadata for this compile-server package, not the containing reasoner
 * image. Environment overrides support deployment systems that provide a more
 * authoritative revision than the publish-time build-info.json.
 */
export function getBuildMetadata(): BuildMetadata {
  return {
    git_commit:
      process.env.AGENTSCRIPT_GIT_COMMIT ??
      embeddedBuildInfo.git_commit ??
      'unknown',
    git_sha:
      process.env.AGENTSCRIPT_GIT_SHA ?? embeddedBuildInfo.git_sha ?? 'unknown',
    version: packageInfo.version ?? 'unknown',
  };
}
