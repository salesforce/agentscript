/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Test script loading is not available in the open-source build.
 * The @agentscript/test-scripts package is an internal Salesforce package.
 */

export async function loadAllTestScripts(): Promise<void> {}

export function loadSpecificTestScript(
  _scriptName: string
): Promise<string | null> {
  return Promise.resolve(null);
}

export function hasTestScriptsLoaded(): Promise<boolean> {
  return Promise.resolve(false);
}

export function loadTestScriptsIfNeeded(): Promise<void> {
  return Promise.resolve();
}

export function getAvailableTestScripts(): Promise<string[]> {
  return Promise.resolve([]);
}
