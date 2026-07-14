/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
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
    const res = await request(app)
      .post('/parseAndCompile')
      .set('Content-Type', 'application/json')
      .send('not valid json{{{');

    expect(res.status).toBe(400);
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
