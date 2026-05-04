/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Centralized design tokens for graph components.
 *
 * Three semantic color roles:
 *   Intelligence (indigo) — reasoning, LLM, decisions, conditions
 *   Action (green) — start, run, execute
 *   Structure (slate) — topics, phases, containers, variables, transitions
 */
export const GRAPH = {
  intelligence: {
    accent: '#818cf8',
    bg: 'rgba(99,102,241,0.15)',
    text: '#c7d2fe',
  },
  action: {
    accent: '#4ade80',
    bg: 'rgba(74,222,128,0.25)',
    text: '#bbf7d0',
  },
  structure: {
    accent: '#94a3b8',
    bg: 'rgba(148,163,184,0.10)',
    text: '#cbd5e1',
  },
  node: {
    bg: '#26262e',
    border: '#505060',
    borderHover: '#606070',
  },
  edge: {
    primary: '#6366f1',
    secondary: '#64748b',
    highlight: '#3b82f6',
  },
  text: {
    primary: '#f1f5f9',
    secondary: '#94a3b8',
    tertiary: '#64748b',
  },
} as const;
