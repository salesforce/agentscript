/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

// End-to-end tests for the /parseAndCompile endpoint.
//
// Unlike app.test.ts (which mocks @agentscript/agentforce to isolate the HTTP
// layer), these exercise the REAL compile path: the genuine parser + compiler
// bundled in this workspace, driven over HTTP via supertest. This mirrors the
// scenarios in the external service's run-e2e-tests.sh — minimal compile and
// compile-from-file — but in-process, so no Docker or running server is needed.
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import request from 'supertest';
import { init } from '@agentscript/agentforce';

// Import the real app (no vi.mock here — this is the whole point of the suite).
const { default: app } = await import('../src/app.js');

const __dirname = dirname(fileURLToPath(import.meta.url));

const MINIMAL_AGENT = `config:
  developer_name: "Test_Agent"
  description: "A simple test agent"

start_agent Main_Topic:
  description: "Handles general requests"
`;

beforeAll(async () => {
  // Enable the WASM tree-sitter parser when available; falls back to the
  // pure-JS parser otherwise. compileSource() needs a parser initialised.
  await init();
});

describe('e2e: GET /health', () => {
  it('reports OK', async () => {
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'OK' });
  });
});

describe('e2e: POST /parseAndCompile — real compilation', () => {
  it('compiles a minimal agent to a real artifact', async () => {
    const res = await request(app)
      .post('/parseAndCompile')
      .send({
        assets: [
          { type: 'AgentScript', name: 'AgentScript', content: MINIMAL_AGENT },
        ],
        afScriptVersion: '2.1.3',
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.compiledArtifact).toBeTruthy();
    expect(res.body.errors).toEqual([]);
    expect(typeof res.body.dslVersion).toBe('string');
  });

  it('compiles example.agent to a real artifact', async () => {
    const source = readFileSync(join(__dirname, 'example.agent'), 'utf-8');

    const res = await request(app)
      .post('/parseAndCompile')
      .send({
        assets: [{ type: 'AgentScript', name: 'AgentScript', content: source }],
        afScriptVersion: '2.1.3',
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('success');
    expect(res.body.compiledArtifact).toBeTruthy();
    expect(res.body.errors).toEqual([]);
  });

  it('reports compilation errors for invalid source', async () => {
    const res = await request(app)
      .post('/parseAndCompile')
      .send({
        assets: [
          {
            type: 'AgentScript',
            name: 'AgentScript',
            content: 'this is not valid agentscript :::',
          },
        ],
        afScriptVersion: '2.1.3',
      });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('failure');
    expect(res.body.compiledArtifact).toBeNull();
    expect(res.body.errors.length).toBeGreaterThan(0);
    expect(res.body.errors[0]).toHaveProperty('errorType');
    expect(res.body.errors[0]).toHaveProperty('description');
  });
});
