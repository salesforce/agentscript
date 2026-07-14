/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import {
  attachDiagnostic,
  DiagnosticSeverity,
  leadingComments,
  parseDialectAnnotation,
} from '@agentscript/language';
import type {
  AstNodeLike,
  CommentTarget,
  Diagnostic,
} from '@agentscript/language';
import { DIALECT_NAME, DIALECT_VERSION } from '../../../index.js';
import { AGENTFABRIC_LINT_SOURCE } from './shared.js';

/**
 * Check a version constraint against the available dialect version.
 *
 * Only the major version is compared. Minor/patch differences are ignored,
 * allowing `.agent` files to request any minor version within the same major.
 */
function checkVersion(
  requested: string,
  available: string,
  dialectName: string
): { message: string; severity: number } | null {
  const reqMajor = Number(requested.split('.')[0]);
  const availMajor = Number(available.split('.')[0]);

  if (reqMajor !== availMajor) {
    return {
      message: `Incompatible major version: requested ${dialectName}=${requested} but only v${available} is available`,
      severity: 2,
    };
  }

  return null;
}

function suggestedVersions(available: string): string[] {
  return [available.split('.')[0]];
}

const EMPTY_RANGE: Diagnostic['range'] = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 0 },
};

/**
 * Validate the `# @dialect: agentfabric=VERSION` annotation against the dialect's
 * available version. Attaches a single `invalid-version` error to the root when
 * the requested version is incompatible.
 */
export function checkVersionRules(root: Record<string, unknown>): void {
  const comments = leadingComments(root as CommentTarget);
  if (comments.length === 0) return;

  for (const comment of comments) {
    // The parsed comment has the leading '#' stripped, so reconstruct the line.
    const annotation = parseDialectAnnotation(`#${comment.value}`);
    if (!annotation || !annotation.version) continue;
    // Only validate the version when the annotation names this dialect;
    // unknown dialect names are resolved elsewhere.
    if (annotation.name !== DIALECT_NAME) return;

    const issue = checkVersion(
      annotation.version,
      DIALECT_VERSION,
      annotation.name
    );
    if (!issue) return;

    const range = comment.range
      ? {
          start: {
            line: comment.range.start.line,
            character: comment.range.start.character + annotation.versionStart,
          },
          end: {
            line: comment.range.start.line,
            character:
              comment.range.start.character +
              annotation.versionStart +
              annotation.versionLength,
          },
        }
      : EMPTY_RANGE;

    const diagnostic: Diagnostic = {
      range,
      message: issue.message,
      severity: DiagnosticSeverity.Error,
      code: 'invalid-version',
      source: AGENTFABRIC_LINT_SOURCE,
      data: { suggestedVersions: suggestedVersions(DIALECT_VERSION) },
    };
    attachDiagnostic(root as AstNodeLike, diagnostic);
    return;
  }
}
