/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useEffect } from 'react';
import { useAppStore } from '~/store';

/**
 * Hook to apply theme to the document element
 * Resolves 'system' theme to actual light/dark based on user preference
 * Note: The inline script in index.html sets the initial theme to prevent FOUC
 * This hook keeps the theme in sync when it changes
 */
export function useTheme() {
  const theme = useAppStore(state => state.theme.theme);

  useEffect(() => {
    const root = document.documentElement;
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
      .matches
      ? 'dark'
      : 'light';

    const actualTheme = theme === 'system' ? systemTheme : theme;

    // Remove both classes first
    root.classList.remove('light', 'dark');
    // Add the correct class
    root.classList.add(actualTheme);

    // Listen for system theme changes if in system mode
    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = (e: MediaQueryListEvent) => {
        const newTheme = e.matches ? 'dark' : 'light';
        root.classList.remove('light', 'dark');
        root.classList.add(newTheme);
      };

      mediaQuery.addEventListener('change', handler);
      return () => mediaQuery.removeEventListener('change', handler);
    }
  }, [theme]);

  return theme;
}
