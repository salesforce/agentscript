/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Response-format names the language provides for every connection, without the
 * connection declaring them. They resolve under `@response_formats.<name>`
 * everywhere and are rejected as user-declared `response_formats:` entry names.
 *
 * Single source of truth for the authoring layer — both the completion provider
 * and the render-rules lint pass read this list.
 */
export const RESERVED_BUILT_IN_RESPONSE_FORMATS: readonly string[] = ['json'];
