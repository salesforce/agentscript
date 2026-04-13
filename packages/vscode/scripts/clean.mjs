/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import fs from 'fs';

for (const dir of ['dist', 'staging']) {
  fs.rmSync(dir, { recursive: true, force: true });
}
