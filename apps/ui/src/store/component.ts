/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

export interface ComponentState {
  /** Persisted source text per component kind */
  componentSources: Record<string, string>;
}

export interface ComponentActions {
  setComponentSource: (kind: string, source: string) => void;
  resetComponentSource: (kind: string) => void;
}

interface AppState {
  component: ComponentState;
}

type SetFunction = (updater: (state: AppState) => Partial<AppState>) => void;

export const createComponentSlice = (set: SetFunction) => ({
  state: {
    componentSources: {} as Record<string, string>,
  },
  actions: {
    setComponentSource: (kind: string, source: string) =>
      set((state: AppState) => ({
        component: {
          ...state.component,
          componentSources: {
            ...state.component.componentSources,
            [kind]: source,
          },
        },
      })),
    resetComponentSource: (kind: string) =>
      set((state: AppState) => {
        const { [kind]: _, ...rest } = state.component.componentSources;
        return {
          component: {
            ...state.component,
            componentSources: rest,
          },
        };
      }),
  },
});
