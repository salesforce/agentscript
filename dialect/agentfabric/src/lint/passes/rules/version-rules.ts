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
import { DIALECT_NAME, DIALECT_VERSION } from '../../../pkg-meta.js';
import { AGENTFABRIC_LINT_SOURCE } from './shared.js';

/**
 * Check a version constraint against the available dialect version.
 *
 * Version format: MAJOR or MAJOR.MINOR
 *   - MAJOR only: matches if the available version has the same major.
 *   - MAJOR.MINOR: matches if the available major is equal AND available minor >= requested minor
 *     (minor acts as a minimum version within that major).
 *
 * Ported from packages/language/src/dialect-resolution.ts. Unlike the original,
 * both the major-mismatch and minor-minimum issues are reported as errors here.
 */
function checkVersion(
  requested: string,
  available: string,
  dialectName: string
): { message: string; severity: 1 } | null {
  const reqParts = requested.split('.').map(Number);
  const availParts = available.split('.').map(Number);

  const reqMajor = reqParts[0];
  const availMajor = availParts[0];

  if (reqMajor !== availMajor) {
    return {
      message: `Incompatible major version: requested ${dialectName}=${requested} but only v${available} is available`,
      severity: 1,
    };
  }

  // If minor is specified, it acts as a minimum
  if (reqParts.length >= 2) {
    const reqMinor = reqParts[1];
    const availMinor = availParts[1] ?? 0;
    if (availMinor < reqMinor) {
      return {
        message: `Minimum minor version not met: requested ${dialectName}>=${reqMajor}.${reqMinor} but v${available} is available`,
        severity: 1,
      };
    }
  }

  return null; // Version constraint satisfied
}

/** Suggested replacement versions (major and major.minor), deduped when equal. */
function suggestedVersions(available: string): string[] {
  const availParts = available.split('.');
  const major = availParts[0];
  const majorMinor = `${availParts[0]}.${availParts[1] ?? 0}`;
  // Deduplicate (e.g., version "2" → major and majorMinor are both "2")
  return major === majorMinor ? [major] : [major, majorMinor];
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
