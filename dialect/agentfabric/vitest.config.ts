/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // tsc emits compiled tests into dist/; Vitest 4 no longer excludes it by default.
    exclude: [...configDefaults.exclude, '**/dist/**'],
  },
});
