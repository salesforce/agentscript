/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

#ifndef TREE_SITTER_AGENTSCRIPT_H_
#define TREE_SITTER_AGENTSCRIPT_H_

typedef struct TSLanguage TSLanguage;

#ifdef __cplusplus
extern "C" {
#endif

const TSLanguage *tree_sitter_agentscript(void);

#ifdef __cplusplus
}
#endif

#endif // TREE_SITTER_AGENTSCRIPT_H_
