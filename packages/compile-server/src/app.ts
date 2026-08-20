/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import * as af from '@agentscript/agentforce';
import { DiagnosticSeverity, DSL_VERSION } from '@agentscript/agentforce';
import { trace } from '@opentelemetry/api';
import type { Express, NextFunction, Request, Response } from 'express';
import express from 'express';
import { AsyncLocalStorage } from 'node:async_hooks';
import { threadId } from 'worker_threads';
import { getBuildMetadata } from './build-info.js';
import { mapDiagnosticToError } from './diagnostic-mapper.js';
// TODO: reenable when test is over
// import constants from "../server-constants.json" with { type: "json" };

const LOGGER_NAME = process.env.OTEL_SERVICE_NAME ?? 'agentscript-sidecar';
const PROCESS_NAME = 'MainProcess';
const THREAD_NAME = 'MainThread';
type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
interface RequestLogContext {
  orgId: string;
  reasonerGitCommit: string;
  reasonerGitSha: string;
  reasonerGitTime: string;
  reasonerGitVersion: string;
}

const requestLogContext = new AsyncLocalStorage<RequestLogContext>();
const UNKNOWN_LOG_FIELD = 'unknown';

function boundedHeader(req: Request, name: string): string {
  const value = req.header(name);
  return value && value.length <= 512 ? value : UNKNOWN_LOG_FIELD;
}

function orgIdFromRequest(req: Request): string {
  const directOrgId = req.header('x-org-id');
  const tenantOrgId = (
    req.header('x-sfdc-core-tenant-id') ?? req.header('x-tenant-id')
  )
    ?.split('/')
    .at(-1);
  const orgId = directOrgId || tenantOrgId;

  // Only accept Salesforce org IDs. This prevents arbitrary header content
  // from becoming a logging channel while retaining the triage identifier.
  return orgId && /^00D[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/.test(orgId)
    ? orgId
    : UNKNOWN_LOG_FIELD;
}

function logContextFromRequest(req: Request): RequestLogContext {
  return {
    orgId: orgIdFromRequest(req),
    reasonerGitCommit: boundedHeader(req, 'x-git-reasoner-build-message'),
    reasonerGitSha: boundedHeader(req, 'x-git-reasoner-build-sha'),
    reasonerGitTime: boundedHeader(req, 'x-git-reasoner-build-time'),
    reasonerGitVersion: boundedHeader(req, 'x-git-reasoner-build-version'),
  };
}

function formatMessage(msg: string, fields: Record<string, unknown>): string {
  const parts = Object.entries(fields).map(
    ([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`
  );
  return parts.length ? `${msg} ${parts.join(', ')}` : msg;
}

function log(
  level: LogLevel,
  msg: string,
  fields: Record<string, unknown> = {}
): void {
  const ctx = trace.getActiveSpan()?.spanContext();
  const hasTrace = !!ctx && ctx.traceId !== '00000000000000000000000000000000';
  const requestContext = requestLogContext.getStore();
  const entry = {
    timestamp: Date.now(),
    level,
    logger: LOGGER_NAME,
    message: formatMessage(msg, fields),
    org_id: requestContext?.orgId ?? UNKNOWN_LOG_FIELD,
    ...getBuildMetadata(),
    reasoner_git_commit: requestContext?.reasonerGitCommit ?? UNKNOWN_LOG_FIELD,
    reasoner_git_sha: requestContext?.reasonerGitSha ?? UNKNOWN_LOG_FIELD,
    reasoner_git_time: requestContext?.reasonerGitTime ?? UNKNOWN_LOG_FIELD,
    reasoner_git_version:
      requestContext?.reasonerGitVersion ?? UNKNOWN_LOG_FIELD,
    process_id: process.pid,
    thread_id: threadId,
    process_name: PROCESS_NAME,
    thread_name: THREAD_NAME,
    trace_id: hasTrace ? ctx!.traceId : '0',
    span_id: hasTrace ? ctx!.spanId : '0',
    trace_sampled: hasTrace ? (ctx!.traceFlags & 0x01) === 0x01 : false,
  };
  const line = JSON.stringify(entry);
  if (level === 'ERROR' || level === 'WARN') {
    console.error(line);
  } else {
    // Structured INFO/DEBUG logs are written to stdout by design (sidecar log contract).
    // eslint-disable-next-line no-console
    console.log(line);
  }
}

const app: Express = express();

app.use((req: Request, _res: Response, next: NextFunction) => {
  requestLogContext.run(logContextFromRequest(req), next);
});

app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  res.on('finish', () => {
    const level: LogLevel =
      res.statusCode >= 500 ? 'ERROR' : res.statusCode >= 400 ? 'WARN' : 'INFO';
    log(level, 'request.finish', {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms: Date.now() - start,
    });
  });
  next();
});

app.use(express.json({ limit: '10mb' }));

// TODO: reenable when test is over
// const SUPPORTED_VERSIONS: readonly string[] = constants.routeV2AgentScriptVersions;
//
// function validateVersion(version: string): string | null {
//   const parts = version.split(".");
//   if (parts.length !== 3 || parts.some((p) => isNaN(Number(p)))) {
//     return `Invalid version format: ${version}. Expected format: X.Y.Z`;
//   }
//   if (!SUPPORTED_VERSIONS.includes(version)) {
//     return `Version ${version} is not supported. Supported versions: ${SUPPORTED_VERSIONS.join(", ")}`;
//   }
//   return null;
// }

app.post('/parseAndCompile', (req: Request, res: Response) => {
  try {
    const { assets, afScriptVersion, agentScriptVersion } = req.body ?? {};
    const version: string | undefined = afScriptVersion ?? agentScriptVersion;

    if (!version) {
      log('WARN', 'parseAndCompile.missing_version');
      res
        .status(400)
        .json({ status_code: 400, detail: 'Missing version field' });
      return;
    }

    // TODO: reenable when test is over
    // const versionError = validateVersion(version);
    // if (versionError) {
    //   res.status(400).json({ status_code: 400, detail: versionError });
    //   return;
    // }

    if (!Array.isArray(assets) || assets.length !== 1) {
      log('WARN', 'parseAndCompile.invalid_assets', {
        assets_count: Array.isArray(assets) ? assets.length : null,
        assets_type: typeof assets,
      });
      res
        .status(400)
        .json({ status_code: 400, detail: 'Exactly one asset is supported' });
      return;
    }

    const source: unknown = assets[0]?.content;
    if (typeof source !== 'string') {
      log('WARN', 'parseAndCompile.invalid_source', {
        source_type: typeof source,
      });
      res
        .status(400)
        .json({ status_code: 400, detail: 'Asset content must be a string' });
      return;
    }

    log('INFO', 'parseAndCompile.compiling', {
      version,
      source_bytes: Buffer.byteLength(source, 'utf8'),
      source_chars: source.length,
      source_lines: source.length === 0 ? 0 : source.split(/\r\n|\r|\n/).length,
    });
    const compileStart = Date.now();
    const result = af.compileSource(source);
    const compileMs = Date.now() - compileStart;

    const errorDiagnostics = result.diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );
    const errors = errorDiagnostics.map(mapDiagnosticToError);
    const hasErrors = errors.length > 0;

    if (hasErrors) {
      log('WARN', 'parseAndCompile.compile_failed', {
        compile_ms: compileMs,
        error_count: errors.length,
        diagnostic_count: result.diagnostics.length,
        // Diagnostic descriptions can quote identifiers or other portions of
        // the user's AgentScript. Keep only compiler-controlled categories and
        // source locations in logs; full diagnostics remain in the response.
        errors: errors.map((e, index) => ({
          error_type: e.errorType,
          diagnostic_code: errorDiagnostics[index]?.code ?? null,
          diagnostic_source: errorDiagnostics[index]?.source ?? null,
          line_start: e.lineStart,
          col_start: e.colStart,
          line_end: e.lineEnd,
          col_end: e.colEnd,
        })),
      });
    } else {
      log('INFO', 'parseAndCompile.compile_succeeded', {
        compile_ms: compileMs,
        diagnostic_count: result.diagnostics.length,
      });
    }

    res.json({
      status: hasErrors ? 'failure' : 'success',
      compiledArtifact: hasErrors ? null : result.output,
      errors,
      syntacticMap: { blocks: [] },
      dslVersion: DSL_VERSION,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('ERROR', 'parseAndCompile.exception', {
      // Error messages and stacks may contain parser excerpts or user-defined
      // identifiers. The trace ID plus error class is sufficient to correlate
      // this event without copying request content into logs.
      error_type: error instanceof Error ? error.name : typeof error,
    });
    res.status(500).json({
      status: 'failure',
      compiledArtifact: null,
      errors: [
        {
          errorType: 'InternalError',
          description: message,
          lineStart: 0,
          lineEnd: 0,
          colStart: 0,
          colEnd: 0,
        },
      ],
      syntacticMap: { blocks: [] },
      dslVersion: DSL_VERSION,
    });
  }
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'OK' });
});

app.use((req: Request, res: Response) => {
  log('WARN', 'route.not_found', { method: req.method, path: req.path });
  res.status(404).json({ status_code: 404, detail: 'Not found' });
});

app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  log('WARN', 'request.invalid_body', {
    method: req.method,
    path: req.path,
    content_length: Number(req.headers['content-length'] ?? 0),
    // JSON parser messages can quote the malformed request body.
    error_type: err.name,
  });
  res.status(400).json({ status_code: 400, detail: 'Invalid request body' });
});

export default app;
