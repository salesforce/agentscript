/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileSource } from '../src/index.js';

const source = readFileSync(
  new URL(
    '../../compiler/test/fixtures/scripts/edge_action_non_blocking_cache.agent',
    import.meta.url
  ),
  'utf8'
);

describe('run execution mode through compileSource', () => {
  it('compiles background lifecycle and blocking reasoning invocations from one cached definition', () => {
    const { output, diagnostics, document } = compileSource(source);
    expect(diagnostics.filter(d => d.severity === 1)).toEqual([]);
    if (!('nodes' in output.agent_version))
      throw new Error('Expected a graph agent version');
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'main'
    );
    expect(node).toMatchObject({
      before_reasoning: expect.arrayContaining([
        expect.objectContaining({
          target: 'LookupAccount',
          non_blocking_behavior: 'fire_and_forget',
        }),
      ]),
      action_definitions: expect.arrayContaining([
        expect.objectContaining({
          developer_name: 'LookupAccount',
          cache: { ttl: 60000 },
        }),
      ]),
    });
    if (node?.type !== 'subagent')
      throw new Error('Expected the main subagent');
    expect(
      node.tools?.find(t => t.name === 'lookup_inline')
    ).not.toHaveProperty('non_blocking_behavior');
    expect(
      compileSource(document.emit()).diagnostics.filter(d => d.severity === 1)
    ).toEqual([]);
  });

  it('emits the camelCase wire field without changing the enum value', () => {
    const { output, diagnostics } = compileSource(source, { camelCase: true });
    expect(diagnostics.filter(d => d.severity === 1)).toEqual([]);
    expect(output).toMatchObject({
      agentVersion: {
        nodes: expect.arrayContaining([
          expect.objectContaining({
            developerName: 'main',
            beforeReasoning: expect.arrayContaining([
              expect.objectContaining({
                target: 'LookupAccount',
                nonBlockingBehavior: 'fire_and_forget',
              }),
            ]),
          }),
        ]),
      },
    });
    expect(JSON.stringify(output)).not.toContain('non_blocking_behavior');
  });

  it('reports each invalid option once across lint and compilation', () => {
    const { diagnostics } = compileSource(
      source.replace(
        'execution_mode: "fire_and_forget"',
        'execution_mode: "retrievable"'
      )
    );
    expect(
      diagnostics.filter(d => d.code === 'invalid-run-option')
    ).toHaveLength(1);
  });
});
