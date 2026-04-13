/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createId } from '@paralleldrive/cuid2';

// Predefined color palette for user avatars
const USER_COLORS = [
  '#ef4444', // red
  '#f59e0b', // amber
  '#10b981', // emerald
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
  '#14b8a6', // teal
  '#a855f7', // purple
];

function getRandomColor(): string {
  return USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)];
}

interface UserState {
  userId: string;
  userName: string;
  userColor: string;
}

interface UserActions {
  setUserName: (name: string) => void;
  setUserColor: (color: string) => void;
}

export type UserStore = UserState & UserActions;

// Create the user store with localStorage persistence
export const useUserStore = create<UserStore>()(
  persist(
    set => ({
      // Initial state - will be replaced by persisted state if available
      userId: createId(),
      userName: 'Anonymous User',
      userColor: getRandomColor(),

      // Actions
      setUserName: (name: string) => set({ userName: name }),
      setUserColor: (color: string) => set({ userColor: color }),
    }),
    {
      name: 'user-storage', // localStorage key
      storage: createJSONStorage(() => localStorage),
    }
  )
);
