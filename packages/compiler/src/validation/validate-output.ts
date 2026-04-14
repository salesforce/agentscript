import type { ZodType } from 'zod';
import { core } from 'zod';
import type { Diagnostic, Range } from '@agentscript/types';
import { DiagnosticSeverity } from '@agentscript/types';
import type { CompilerContext } from '../compiler-context.js';
import { FALLBACK_RANGE } from '../diagnostics.js';
import { Sourced } from '../sourced.js';

type Issue = core.$ZodIssue;

interface ResolvedLocation {
  range: Range;
  /** Script-level path (e.g., "language.additional_locales") */
  scriptPath: string;
  /** Full compiled JSON path (e.g., "agent_version.modality_parameters.language.additional_locales.0") */
  compiledPath: string;
}

/**
 * Validate a compiled output object against a Zod schema.
 *
 * For each Zod issue, walks the issue's `path` through the output object
 * and resolves the best available source range from the compiler's
 * Sourced<T> values. This means we get precise source locations without
 * writing any manual validation code — whenever the Zod schema changes,
 * validation automatically covers the new fields.
 */
export function validateOutput(
  output: unknown,
  schema: ZodType,
  ctx: CompilerContext
): void {
  // Output values are already plain (unwrapped by ctx.track())
  const result = schema.safeParse(output);
  if (result.success) return;

  const leafIssues = flattenZodIssues(result.error.issues);

  for (const issue of leafIssues) {
    const path = issue.path as (string | number)[];
    const location = resolveLocation(output, path, ctx);
    const found = resolveInputValue(output, path);

    ctx.diagnostics.push(issueToDiagnostic(issue, location, found));
  }
}

/**
 * Convert a flattened Zod issue into a Diagnostic with structured `data`.
 */
function issueToDiagnostic(
  issue: Issue,
  location: ResolvedLocation,
  found: string | undefined
): Diagnostic {
  const expected = extractExpectedValues(issue);
  const message = formatMessage(issue, location.scriptPath, found);

  return {
    severity: DiagnosticSeverity.Error,
    message,
    range: location.range,
    code: 'schema-validation',
    source: 'compiler',
    data: {
      path: location.compiledPath,
      ...(expected ? { expected } : {}),
    },
  };
}

/**
 * Build a concise, human-readable error message using the script path.
 */
function formatMessage(
  issue: Issue,
  scriptPath: string,
  found: string | undefined
): string {
  if (issue.code === 'invalid_value' && found !== undefined) {
    return `Invalid value "${found}" for ${scriptPath}`;
  }

  if (issue.code === 'invalid_type') {
    const typed = issue as Issue & { expected: string };
    return `Expected ${typed.expected} for ${scriptPath}`;
  }

  // Fallback: use Zod's message but strip the enum dump
  const msg = issue.message.replace(/: expected one of .*$/, '');
  return `${msg} for ${scriptPath}`;
}

/**
 * Extract expected values from a Zod issue (e.g., enum options).
 */
function extractExpectedValues(issue: Issue): string[] | undefined {
  if (issue.code === 'invalid_value' && 'values' in issue) {
    const values = (issue as Issue & { values: unknown[] }).values;
    return values.map(String);
  }
  return undefined;
}

/**
 * Resolve the actual input value at the issue's path for the `found` field.
 */
function resolveInputValue(
  root: unknown,
  path: (string | number)[]
): string | undefined {
  let current: unknown = root;
  for (const segment of path) {
    if (
      current === null ||
      current === undefined ||
      typeof current !== 'object'
    ) {
      return undefined;
    }
    current = (current as Record<string | number, unknown>)[segment];
  }
  // Unwrap Sourced values
  if (current instanceof Sourced) current = current.value;
  if (typeof current === 'string') return current;
  if (typeof current === 'number' || typeof current === 'boolean') {
    return String(current);
  }
  return undefined;
}

/**
 * Flatten nested Zod union errors into leaf-level issues.
 *
 * Zod wraps union validation failures in `invalid_union` issues with nested
 * `errors` (array of arrays in Zod v4). We recurse into these to extract the
 * deepest, most specific issues — the ones that actually describe what went
 * wrong (e.g., "invalid enum value") rather than the generic "Invalid input"
 * at the union level.
 */
function flattenZodIssues(issues: Issue[]): Issue[] {
  const result: Issue[] = [];

  for (const issue of issues) {
    if (issue.code === 'invalid_union' && 'errors' in issue) {
      const unionIssue = issue as Issue & { errors: Issue[][] };

      // Each union member has its own issue array; pick the member with the
      // deepest path (most specific match) and flatten its issues.
      let bestMember: Issue[] = [];
      let bestDepth = -1;

      for (const memberIssues of unionIssue.errors) {
        const maxDepth = memberIssues.reduce(
          (d, i) => Math.max(d, i.path.length),
          0
        );
        if (maxDepth > bestDepth) {
          bestDepth = maxDepth;
          bestMember = memberIssues;
        }
      }

      // Prepend the parent path to child issue paths
      const childIssues = bestMember.map(child => ({
        ...child,
        path: [...issue.path, ...child.path],
      }));
      result.push(...flattenZodIssues(childIssues));
    } else {
      result.push(issue);
    }
  }

  return result;
}

/**
 * Walk the Zod issue path through the output object, resolving:
 * 1. The best source range from Sourced<T> values
 * 2. The script-level path via the reverse mapping (setScriptPath)
 * 3. The full compiled JSON path
 *
 * The script path is built by looking up each object's registered script block
 * path and appending annotated property keys. Non-annotated structural wrappers
 * (agent_version, modality_parameters, etc.) are skipped in the script path.
 */
function resolveLocation(
  root: unknown,
  path: (string | number)[],
  ctx: CompilerContext
): ResolvedLocation {
  let bestRange: Range = FALLBACK_RANGE;
  let current: unknown = root;
  let scriptBlockPath: string | undefined;
  const scriptSuffix: (string | number)[] = [];

  for (const segment of path) {
    if (
      current === null ||
      current === undefined ||
      typeof current !== 'object'
    ) {
      break;
    }

    // Check for script block path on the current object
    const blockPath = ctx.getScriptPath(current as object);
    if (blockPath !== undefined) {
      scriptBlockPath = blockPath;
      // Reset suffix — we're now relative to this block
      scriptSuffix.length = 0;
    }

    // Check for range from Sourced values
    if (typeof segment === 'string') {
      const propValue = (current as Record<string, unknown>)[segment];
      if (propValue instanceof Sourced && propValue.range) {
        bestRange = propValue.range;
        scriptSuffix.push(segment);
      }
    }

    // Traverse into the next level
    current = (current as Record<string | number, unknown>)[segment];
  }

  const compiledPath = path.length > 0 ? path.join('.') : 'root';

  let scriptPath: string;
  if (scriptBlockPath !== undefined && scriptSuffix.length > 0) {
    scriptPath = `${scriptBlockPath}.${scriptSuffix.join('.')}`;
  } else if (scriptBlockPath !== undefined) {
    scriptPath = scriptBlockPath;
  } else {
    scriptPath = compiledPath;
  }

  return { range: bestRange, scriptPath, compiledPath };
}
