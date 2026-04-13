/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

export type Theme = 'light' | 'dark' | 'system';
export type UiTheme = 'code' | 'visual';

export interface ThemeState {
  theme: Theme;
  uiTheme: UiTheme;
}

export interface ThemeActions {
  setTheme: (theme: Theme) => void;
  setUiTheme: (uiTheme: UiTheme) => void;
}

interface AppState {
  theme: ThemeState;
}

type SetFunction = (updater: (state: AppState) => Partial<AppState>) => void;

export const createThemeSlice = (set: SetFunction) => ({
  state: {
    theme: 'system' as Theme,
    uiTheme: 'code' as UiTheme,
  },
  actions: {
    setTheme: (theme: Theme) =>
      set((state: AppState) => ({
        theme: { ...state.theme, theme },
      })),
    setUiTheme: (uiTheme: UiTheme) =>
      set((state: AppState) => ({
        theme: { ...state.theme, uiTheme },
      })),
  },
});
