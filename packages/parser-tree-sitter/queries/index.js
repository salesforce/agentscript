/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

const fs = require('fs');
const path = require('path');

// Export highlights query as a string
const HIGHLIGHTS_QUERY = fs.readFileSync(
  path.join(__dirname, 'highlights.scm'),
  'utf8'
);

module.exports = {
  HIGHLIGHTS_QUERY,
};
