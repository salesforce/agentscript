/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Local storage utilities for agents and app data
 */

import type { Agent } from '~/store/agentStore';

/**
 * Export agent as JSON file
 */
export function exportAgentAsJSON(agent: Agent) {
  const dataStr = JSON.stringify(agent, null, 2);
  const dataBlob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(dataBlob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `${agent.name.replace(/\s+/g, '-')}.json`;
  link.click();

  URL.revokeObjectURL(url);
}

/**
 * Import agent from JSON file
 */
export function importAgentFromJSON(file: File): Promise<Partial<Agent>> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = e => {
      try {
        const data = JSON.parse(e.target?.result as string);
        resolve(data);
      } catch {
        reject(new Error('Invalid JSON file'));
      }
    };

    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

/**
 * Clear all local storage data
 */
export function clearAllData() {
  if (
    confirm(
      'Are you sure you want to clear all local data? This cannot be undone.'
    )
  ) {
    localStorage.clear();
    window.location.href = '/';
  }
}

/**
 * Get storage usage information
 */
export function getStorageInfo() {
  if (typeof navigator.storage === 'undefined') {
    return null;
  }

  return navigator.storage.estimate().then(estimate => ({
    used: estimate.usage || 0,
    quota: estimate.quota || 0,
    percentUsed: estimate.quota
      ? ((estimate.usage || 0) / estimate.quota) * 100
      : 0,
  }));
}
