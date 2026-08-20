/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { trace } from '@opentelemetry/api';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import request from 'supertest';

const MOCK_DSL_VERSION = '0.0.3.rc90';

vi.mock('@agentscript/agentforce', () => ({
  init: vi.fn().mockResolvedValue(undefined),
  compileSource: vi.fn(),
  DSL_VERSION: MOCK_DSL_VERSION,
  DiagnosticSeverity: {
    Error: 1,
    Warning: 2,
    Information: 3,
    Hint: 4,
  },
}));

const { compileSource } = await import('@agentscript/agentforce');
const { default: app } = await import('../src/app.js');

const mockCompileSource = vi.mocked(compileSource);

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_VERSION = (
  JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')) as {
    version: string;
  }
).version;

const SUCCESSFUL_COMPILE_RESULT = {
  output: { agentType: 'External', config: {} },
  diagnostics: [],
  annotations: {},
  document: {},
};

const COMPILE_RESULT_WITH_ERRORS = {
  output: { agentType: 'External', config: {} },
  diagnostics: [
    {
      range: {
        start: { line: 3, character: 5 },
        end: { line: 3, character: 20 },
      },
      message: "Undefined variable 'foo'",
      severity: 1,
      code: 'undefined-reference',
      source: 'agentscript-schema',
    },
  ],
  annotations: {},
  document: {},
};

const COMPILE_RESULT_WITH_WARNINGS = {
  output: { agentType: 'External', config: {} },
  diagnostics: [
    {
      range: {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 10 },
      },
      message: 'Unused field',
      severity: 2,
      code: 'unused-field',
      source: 'agentscript-lint',
    },
  ],
  annotations: {},
  document: {},
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCompileSource.mockReturnValue(SUCCESSFUL_COMPILE_RESULT);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('GET /health', () => {
  it('returns OK status', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'OK' });
  });
});

describe('POST /parseAndCompile — successful compilation', () => {
  it('returns success with compiledArtifact', async () => {
    const res = await request(app)
      .post('/parseAndCompile')
      .send({
        assets: [
          { type: 'AgentScript', name: 'AgentScript', content: 'valid source' },
        ],
        afScriptVersion: '2.1.3',
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      status: 'success',
      compiledArtifact: SUCCESSFUL_COMPILE_RESULT.output,
      errors: [],
      syntacticMap: { blocks: [] },
      dslVersion: MOCK_DSL_VERSION,
    });
    expect(mockCompileSource).toHaveBeenCalledWith('valid source');
  });

  it('accepts agentScriptVersion alias', async () => {
    const res = await request(app)
      .post('/parseAndCompile')
      .send({
        assets: [
          { type: 'AgentScript', name: 'AgentScript', content: 'source' },
        ],
        agentScriptVersion: '2.1.3',
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
  });

  it('loads example.agent file and sends it to parseAndCompile', async () => {
    const agentSource = readFileSync(join(__dirname, 'example.agent'), 'utf-8');

    const res = await request(app)
      .post('/parseAndCompile')
      .send({
        assets: [
          { type: 'AgentScript', name: 'AgentScript', content: agentSource },
        ],
        afScriptVersion: '2.1.3',
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.compiledArtifact).toBeDefined();
    expect(res.body.dslVersion).toBe(MOCK_DSL_VERSION);
    expect(mockCompileSource).toHaveBeenCalledWith(agentSource);
  });
});

describe('POST /parseAndCompile — compilation errors', () => {
  it('returns failure when diagnostics contain errors', async () => {
    mockCompileSource.mockReturnValue(COMPILE_RESULT_WITH_ERRORS);

    const res = await request(app)
      .post('/parseAndCompile')
      .send({
        assets: [
          { type: 'AgentScript', name: 'AgentScript', content: 'bad source' },
        ],
        afScriptVersion: '2.1.3',
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('failure');
    expect(res.body.compiledArtifact).toBeNull();
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0]).toMatchObject({
      errorType: 'SemanticError',
      description: "Undefined variable 'foo'",
      lineStart: 3,
      lineEnd: 3,
      colStart: 5,
      colEnd: 20,
    });
  });

  it('returns success when only warnings present and excludes them from errors array', async () => {
    mockCompileSource.mockReturnValue(COMPILE_RESULT_WITH_WARNINGS);

    const res = await request(app)
      .post('/parseAndCompile')
      .send({
        assets: [
          { type: 'AgentScript', name: 'AgentScript', content: 'source' },
        ],
        afScriptVersion: '2.1.3',
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.compiledArtifact).toEqual(
      COMPILE_RESULT_WITH_WARNINGS.output
    );
    expect(res.body.errors).toHaveLength(0);
  });
});

describe('POST /parseAndCompile — validation', () => {
  // TODO: tighten this back to a 400 once validateVersion is re-enabled in src/app.ts.
  // For now any non-empty version is accepted and the request reaches compileSource.
  it('accepts any non-empty version while validateVersion is disabled', async () => {
    const res = await request(app)
      .post('/parseAndCompile')
      .send({
        assets: [{ type: 'AgentScript', name: 'AgentScript', content: 'x' }],
        afScriptVersion: '1.0.1',
      });

    expect(res.status).toBe(200);
    expect(mockCompileSource).toHaveBeenCalledWith('x');
  });

  it('rejects missing version', async () => {
    const res = await request(app)
      .post('/parseAndCompile')
      .send({
        assets: [{ type: 'AgentScript', name: 'AgentScript', content: 'x' }],
      });

    expect(res.status).toBe(400);
    expect(res.body.detail).toContain('version');
  });

  // TODO: tighten this back to a 400 once validateVersion is re-enabled in src/app.ts.
  // For now any non-empty version string is accepted regardless of format.
  it('accepts non-numeric version strings while validateVersion is disabled', async () => {
    const res = await request(app)
      .post('/parseAndCompile')
      .send({
        assets: [{ type: 'AgentScript', name: 'AgentScript', content: 'x' }],
        afScriptVersion: 'not.a.version',
      });

    expect(res.status).toBe(200);
    expect(mockCompileSource).toHaveBeenCalledWith('x');
  });

  it('rejects multiple assets', async () => {
    const res = await request(app)
      .post('/parseAndCompile')
      .send({
        assets: [
          { type: 'AgentScript', name: 'AgentScript', content: 'a' },
          { type: 'AgentScript', name: 'AgentScript', content: 'b' },
        ],
        afScriptVersion: '2.1.3',
      });

    expect(res.status).toBe(400);
    expect(res.body.detail).toContain('Exactly one asset');
  });

  it('rejects empty body', async () => {
    const res = await request(app).post('/parseAndCompile').send({});

    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON', async () => {
    const invalidBodySecret = 'INVALID_BODY_SECRET_DO_NOT_LOG';
    const stderr = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const res = await request(app)
      .post('/parseAndCompile')
      .set('Content-Type', 'application/json')
      .send(`${invalidBodySecret}{{{`);

    expect(res.status).toBe(400);
    expect(stderr.mock.calls.flat().join('\n')).not.toContain(
      invalidBodySecret
    );
  });
});

describe('POST /parseAndCompile — internal errors', () => {
  it('returns 500 with InternalError when compileSource throws', async () => {
    mockCompileSource.mockImplementation(() => {
      throw new Error('WASM parser crashed');
    });

    const res = await request(app)
      .post('/parseAndCompile')
      .send({
        assets: [
          { type: 'AgentScript', name: 'AgentScript', content: 'source' },
        ],
        afScriptVersion: '2.1.3',
      });

    expect(res.status).toBe(500);
    expect(res.body.status).toBe('failure');
    expect(res.body.errors[0]).toMatchObject({
      errorType: 'InternalError',
      description: 'WASM parser crashed',
    });
    expect(res.body.dslVersion).toBe(MOCK_DSL_VERSION);
  });
});

describe('logging privacy', () => {
  it('enriches every request log with org, OTEL trace, and package build metadata', async () => {
    const orgId = '00Dxx0000000001AAA';
    const traceId = '1234567890abcdef1234567890abcdef';
    const gitCommit = 'fix: improve compile logging';
    const gitSha = 'abcdef1234567890abcdef1234567890abcdef12';
    const reasonerGitCommit = 'fix: forward compile context';
    const reasonerGitSha = '1234567';
    const reasonerGitTime = '2026-07-30 10:16:29 -0700';
    const reasonerGitVersion = 'v2.6.0';
    vi.stubEnv('AGENTSCRIPT_GIT_COMMIT', gitCommit);
    vi.stubEnv('AGENTSCRIPT_GIT_SHA', gitSha);
    vi.spyOn(trace, 'getActiveSpan').mockReturnValue({
      spanContext: () => ({
        traceId,
        spanId: '1234567890abcdef',
        traceFlags: 1,
      }),
    } as unknown as ReturnType<typeof trace.getActiveSpan>);
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const res = await request(app)
      .post('/parseAndCompile')
      .set('X-Org-Id', orgId)
      .set('X-Git-Reasoner-Build-Message', reasonerGitCommit)
      .set('X-Git-Reasoner-Build-Sha', reasonerGitSha)
      .set('X-Git-Reasoner-Build-Time', reasonerGitTime)
      .set('X-Git-Reasoner-Build-Version', reasonerGitVersion)
      .send({
        assets: [
          { type: 'AgentScript', name: 'AgentScript', content: 'valid' },
        ],
        afScriptVersion: '2.1.3',
      });

    expect(res.status).toBe(200);
    const entries = stdout.mock.calls
      .map(([line]) => line)
      .filter((line): line is string => typeof line === 'string')
      .map(line => JSON.parse(line) as Record<string, unknown>);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry).toMatchObject({
        org_id: orgId,
        trace_id: traceId,
        git_commit: gitCommit,
        git_sha: gitSha,
        version: PACKAGE_VERSION,
        reasoner_git_commit: reasonerGitCommit,
        reasoner_git_sha: reasonerGitSha,
        reasoner_git_time: reasonerGitTime,
        reasoner_git_version: reasonerGitVersion,
      });
    }
  });

  it('does not carry reasoner metadata across requests', async () => {
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await request(app)
      .post('/parseAndCompile')
      .set('X-Git-Reasoner-Build-Sha', 'reasoner-sha')
      .send({
        assets: [
          { type: 'AgentScript', name: 'AgentScript', content: 'first' },
        ],
        afScriptVersion: '2.1.3',
      });
    stdout.mockClear();

    const res = await request(app)
      .post('/parseAndCompile')
      .send({
        assets: [
          { type: 'AgentScript', name: 'AgentScript', content: 'second' },
        ],
        afScriptVersion: '2.1.3',
      });

    expect(res.status).toBe(200);
    const entries = stdout.mock.calls
      .map(([line]) => line)
      .filter((line): line is string => typeof line === 'string')
      .map(line => JSON.parse(line) as Record<string, unknown>);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every(entry => entry.reasoner_git_sha === 'unknown')).toBe(
      true
    );
  });

  it('derives org ID from the fallback tenant header', async () => {
    const orgId = '00Dxx0000000001AAA';
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const res = await request(app)
      .post('/parseAndCompile')
      .set('x-tenant-id', `core/prod/${orgId}`)
      .send({
        assets: [
          { type: 'AgentScript', name: 'AgentScript', content: 'valid' },
        ],
        afScriptVersion: '2.1.3',
      });

    expect(res.status).toBe(200);
    const entries = stdout.mock.calls
      .map(([line]) => line)
      .filter((line): line is string => typeof line === 'string')
      .map(line => JSON.parse(line) as Record<string, unknown>);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every(entry => entry.org_id === orgId)).toBe(true);
  });

  it('does not log AgentScript source or compiled output', async () => {
    const sourceSecret = 'SOURCE_SECRET_DO_NOT_LOG';
    const outputSecret = 'OUTPUT_SECRET_DO_NOT_LOG';
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const stderr = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockCompileSource.mockReturnValue({
      ...SUCCESSFUL_COMPILE_RESULT,
      output: { secret: outputSecret },
    });

    const res = await request(app)
      .post('/parseAndCompile')
      .send({
        assets: [
          { type: 'AgentScript', name: 'AgentScript', content: sourceSecret },
        ],
        afScriptVersion: '2.1.3',
      });

    expect(res.status).toBe(200);
    const logs = [...stdout.mock.calls, ...stderr.mock.calls].flat().join('\n');
    expect(logs).not.toContain(sourceSecret);
    expect(logs).not.toContain(outputSecret);
    expect(logs).toContain('source_bytes=');
    expect(logs).toContain('compile_ms=');
  });

  it('logs diagnostic metadata without source-derived descriptions', async () => {
    const diagnosticSecret = 'DIAGNOSTIC_SECRET_DO_NOT_LOG';
    const stderr = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockCompileSource.mockReturnValue({
      ...COMPILE_RESULT_WITH_ERRORS,
      diagnostics: [
        {
          ...COMPILE_RESULT_WITH_ERRORS.diagnostics[0],
          message: `Undefined variable '${diagnosticSecret}'`,
        },
      ],
    });

    const res = await request(app)
      .post('/parseAndCompile')
      .send({
        assets: [{ type: 'AgentScript', name: 'AgentScript', content: 'bad' }],
        afScriptVersion: '2.1.3',
      });

    expect(res.status).toBe(200);
    const logs = stderr.mock.calls.flat().join('\n');
    expect(logs).not.toContain(diagnosticSecret);
    expect(logs).toContain('diagnostic_code');
    expect(logs).toContain('line_start');
  });

  it('logs exception types without messages or stacks', async () => {
    const exceptionSecret = 'EXCEPTION_SECRET_DO_NOT_LOG';
    const stderr = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockCompileSource.mockImplementation(() => {
      throw new Error(exceptionSecret);
    });

    const res = await request(app)
      .post('/parseAndCompile')
      .send({
        assets: [{ type: 'AgentScript', name: 'AgentScript', content: 'bad' }],
        afScriptVersion: '2.1.3',
      });

    expect(res.status).toBe(500);
    const logs = stderr.mock.calls.flat().join('\n');
    expect(logs).not.toContain(exceptionSecret);
    expect(logs).toContain('error_type=Error');
  });
});

describe('unknown routes', () => {
  it('returns 404 JSON for unknown GET routes', async () => {
    const res = await request(app).get('/nonexistent');

    expect(res.status).toBe(404);
    expect(res.body.status_code).toBe(404);
  });

  it('returns 404 for GET on parseAndCompile', async () => {
    const res = await request(app).get('/parseAndCompile');

    expect(res.status).toBe(404);
  });
});
