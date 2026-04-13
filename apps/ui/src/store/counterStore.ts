/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface CounterState {
  count: number;
  increment: () => void;
  decrement: () => void;
  reset: () => void;
}

export const useCounterStore = create<CounterState>()(
  persist(
    set => ({
      count: 0,
      increment: () => set(state => ({ count: state.count + 1 })),
      decrement: () => set(state => ({ count: state.count - 1 })),
      reset: () => set({ count: 0 }),
    }),
    {
      name: 'counter-storage',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
