/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import { parseSource, checkSchemaConformance } from './test-utils.js';
import { DiagnosticSeverity } from '@agentscript/types';

describe('GBA: Node-level bundles', () => {
  const source = `
config:
    developer_name: "TestAgent"
    agent_type: "GoalBasedAgent"
    default_agent_user: "test_user"

bundles:
    targeting:
        target: "bundle://targeting"
    prospecting:
        target: "bundle://prospecting"

start_agent main:
    description: "Entry"

subagent execution:
    description: "Exec"
    bundles:
        - @bundles.targeting
        - @bundles.prospecting
    reasoning:
        instructions: ->
            | Do work.
`;

  it('attaches node-level bundles to subagent', () => {
    const { output, diagnostics } = compile(parseSource(source));
    const errors = diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(errors).toHaveLength(0);

    const executionNode = output.agent_version.nodes.find(
      n => n.developer_name === 'execution'
    );
    expect(executionNode).toBeDefined();
    expect(executionNode!.bundles).toBeDefined();
    expect(executionNode!.bundles).toHaveLength(2);

    const bundleNames = executionNode!.bundles!.map(p => p.name);
    expect(bundleNames).toEqual(['targeting', 'prospecting']);
  });

  it('does not add bundles field when not present', () => {
    const { output } = compile(parseSource(source));

    const mainNode = output.agent_version.nodes.find(
      n => n.developer_name === 'main'
    );
    expect(mainNode).toBeDefined();
    expect(mainNode!.bundles).toBeUndefined();
  });

  it('produces schema-conformant output', () => {
    const { output } = compile(parseSource(source));
    const violations = checkSchemaConformance(output);
    expect(violations).toEqual([]);
  });

  it('handles multiple nodes with and without bundles', () => {
    const multiSource = `
config:
    developer_name: "TestAgent"
    agent_type: "GoalBasedAgent"
    default_agent_user: "test_user"

bundles:
    bundle_a:
        target: "bundle://bundle_a"

start_agent main:
    description: "Entry"

subagent alpha:
    description: "Alpha"
    bundles:
        - @bundles.bundle_a

subagent beta:
    description: "Beta"
`;

    const { output, diagnostics } = compile(parseSource(multiSource));
    const errors = diagnostics.filter(
      d => d.severity === DiagnosticSeverity.Error
    );
    expect(errors).toHaveLength(0);

    const alphaNode = output.agent_version.nodes.find(
      n => n.developer_name === 'alpha'
    );
    const betaNode = output.agent_version.nodes.find(
      n => n.developer_name === 'beta'
    );

    expect(alphaNode!.bundles).toBeDefined();
    expect(alphaNode!.bundles).toHaveLength(1);
    expect(alphaNode!.bundles![0].name).toBe('bundle_a');

    expect(betaNode!.bundles).toBeUndefined();
  });
});
