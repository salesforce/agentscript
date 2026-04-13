/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { IoSunny, IoMoon, IoLaptop } from 'react-icons/io5';
import { useAppStore } from '~/store';
import type { Theme } from '~/store/themeStore';

export function ThemeSwitch() {
  const theme = useAppStore(state => state.theme.theme);
  const setTheme = useAppStore(state => state.setTheme);

  const nextMode: Theme =
    theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';

  const modeLabel = {
    light: (
      <>
        <IoSunny className="h-4 w-4" />
        <span className="sr-only">Light</span>
      </>
    ),
    dark: (
      <>
        <IoMoon className="h-4 w-4" />
        <span className="sr-only">Dark</span>
      </>
    ),
    system: (
      <>
        <IoLaptop className="h-4 w-4" />
        <span className="sr-only">System</span>
      </>
    ),
  };

  const handleClick = () => {
    setTheme(nextMode);
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex h-8 w-8 cursor-pointer items-center justify-center rounded hover:bg-gray-300/50 hover:text-gray-900 dark:hover:bg-[#454646] dark:hover:text-white"
      title={`Switch to ${nextMode} theme`}
    >
      {modeLabel[theme]}
    </button>
  );
}
