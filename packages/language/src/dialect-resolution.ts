/**
 * Dialect resolution — resolves a DialectConfig from source annotations and
 * available dialect configurations.
 *
 * Pure business logic with no LSP dependencies.
 */

import type { DialectConfig } from './dialect-config.js';
import { parseDialectAnnotation } from './dialect-annotation.js';

/** Configuration needed for dialect resolution. */
export interface DialectResolutionConfig {
  /** Available dialects. */
  dialects: DialectConfig[];
  /** Default dialect name when no `# @dialect:` annotation is present. Defaults to first dialect's name. */
  defaultDialect?: string;
}

export interface VersionDiagnostic {
  message: string;
  /** 1 = Error, 2 = Warning */
  severity: 1 | 2;
  line: number;
  versionStart: number;
  versionLength: number;
  /** Suggested replacement versions (major and major.minor). */
  suggestedVersions: string[];
}

export interface ResolvedDialect {
  dialect: DialectConfig;
  versionDiagnostic?: VersionDiagnostic;
  unknownDialect?: {
    name: string;
    line: number;
    nameStart: number;
    nameLength: number;
    availableNames: string[];
  };
}

/**
 * Check a version constraint against an available dialect version.
 *
 * Version format: MAJOR or MAJOR.MINOR
 *   - MAJOR only: matches if the available version has the same major.
 *   - MAJOR.MINOR: matches if the available major is equal AND available minor >= requested minor
 *     (minor acts as a minimum version within that major).
 */
function checkVersion(
  requested: string,
  available: string,
  dialectName: string
): { message: string; severity: 1 | 2 } | null {
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
        severity: 2,
      };
    }
  }

  return null; // Version constraint satisfied
}

/**
 * Resolve the dialect for a document based on its `# @dialect:` annotation
 * or the default dialect from config.
 */
export function resolveDialect(
  source: string,
  config: DialectResolutionConfig
): ResolvedDialect {
  const annotation = parseDialectAnnotation(source);

  if (annotation) {
    const match = config.dialects.find(
      d => d.name.toLowerCase() === annotation.name
    );
    if (match) {
      // Validate version constraint if specified
      if (annotation.version) {
        const versionIssue = checkVersion(
          annotation.version,
          match.version,
          annotation.name
        );
        if (versionIssue) {
          const availParts = match.version.split('.');
          const major = availParts[0];
          const majorMinor = `${availParts[0]}.${availParts[1] ?? 0}`;
          // Deduplicate (e.g., version "2" → major and majorMinor are both "2")
          const suggestedVersions =
            major === majorMinor ? [major] : [major, majorMinor];
          return {
            dialect: match,
            versionDiagnostic: {
              message: versionIssue.message,
              severity: versionIssue.severity,
              line: annotation.line,
              versionStart: annotation.versionStart,
              versionLength: annotation.versionLength,
              suggestedVersions,
            },
          };
        }
      }
      return { dialect: match };
    }

    // Annotation present but dialect name not recognized — fall back to default
    // but report the unknown name so callers can emit a diagnostic.
    const defaultName = config.defaultDialect ?? config.dialects[0]?.name;
    const defaultDialect = config.dialects.find(d => d.name === defaultName);
    if (!defaultDialect) {
      throw new Error(
        `No dialect available. Configure at least one dialect in DialectResolutionConfig.`
      );
    }
    return {
      dialect: defaultDialect,
      unknownDialect: {
        name: annotation.name,
        line: annotation.line,
        nameStart: annotation.nameStart,
        nameLength: annotation.nameLength,
        availableNames: config.dialects.map(d => d.name),
      },
    };
  }

  // Fall back to default dialect
  const defaultName = config.defaultDialect ?? config.dialects[0]?.name;
  const defaultDialect = config.dialects.find(d => d.name === defaultName);
  if (!defaultDialect) {
    throw new Error(
      `No dialect available. Configure at least one dialect in DialectResolutionConfig.`
    );
  }
  return { dialect: defaultDialect };
}
