/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Feature flags for controlling which features are available in the UI.
 * Set flags to `false` to hide features that aren't ready for public use.
 * The code is preserved — just not rendered or accessible.
 */
export const featureFlags = {
  /** Builder UI (/builder routes) — visual form editor, disabled by default */
  builder: false,
  /** Simulate page (/simulate route) */
  simulate: false,
  /** UI Theme switcher (IDE / Visual) in settings menu */
  uiThemeSwitcher: false,
  /** Settings dialog */
  settingsDialog: false,
  /** AI Suggestions tab in bottom panel */
  suggestionsTab: false,
} as const;
