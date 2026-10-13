/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * File references tests — compile-time AST walk that captures
 * @system_variables.uploaded_files references and emits a per-node
 * `file_references` array describing subscript/slice forms + optional gates.
 */
import { describe, it, expect } from 'vitest';
import { compile } from '../src/compile.js';
import { parseSource } from './test-utils.js';
import type { SubAgentNode } from '../src/types.js';
import { DiagnosticSeverity } from '@agentscript/types';

describe('workflow file references', () => {
  const header = `
config:
    developer_name: "FileBot"
    file_upload:
        mode: "managed"
variables:
    answer: mutable string = ""
        description: "Answer"
start_agent main:
    reasoning:
        instructions: ->
            | File: {!@system_variables.uploaded_files[0]}
`;

  it.each([
    ['say', 'say "Files: {!@system_variables.uploaded_files}"'],
    [
      'ask for',
      'ask for @variables.answer\n            instructions: |\n                Read {!@system_variables.uploaded_files}',
    ],
  ])(
    'warns for managed attachments in workflow %s prompt text',
    (_label, stmt) => {
      const { output, diagnostics } = compile(
        parseSource(`${header}
workflow flow:
    description: "Flow"
    steps: ->
        ${stmt}
`)
      );
      expect(diagnostics).toEqual([
        expect.objectContaining({
          severity: DiagnosticSeverity.Warning,
          message: expect.stringContaining(
            'managed file attachments are not supported for workflow nodes'
          ),
        }),
      ]);
      expect(
        output.agent_version.nodes.find(n => n.type === 'workflow')
      ).not.toHaveProperty('file_references');
      expect(
        output.agent_version.nodes.find(n => n.developer_name === 'main')
      ).toHaveProperty('file_references', [{ index: 0 }]);
    }
  );

  it.each(['auto', 'disabled', 'error'])(
    'does not warn about unsupported workflow attachments in %s mode',
    mode => {
      const { diagnostics } = compile(
        parseSource(`${header.replace('"managed"', `"${mode}"`)}
workflow flow:
    description: "Flow"
    steps: ->
        say "Files: {!@system_variables.uploaded_files}"
`)
      );
      expect(diagnostics).toEqual([]);
    }
  );

  it('allows file-state references in workflow action bindings', () => {
    const { output, diagnostics } = compile(
      parseSource(`${header}
workflow flow:
    description: "Flow"
    actions:
        read_file:
            description: "Read file"
            target: "flow://ReadFile"
            inputs:
                fileId: string
    steps: ->
        run @actions.read_file
            with fileId = @system_variables.uploaded_files[1].id
`)
    );
    expect(diagnostics).toEqual([]);
    expect(
      output.agent_version.nodes.find(n => n.type === 'workflow')
    ).toMatchObject({
      steps: [
        {
          directives: [
            {
              bound_inputs: {
                fileId: 'system.uploaded_files[1].id',
              },
            },
          ],
        },
      ],
    });
  });

  it.each([false, true])(
    'keeps workflow references isolated and warns on surfaces (connected node: %s)',
    connected => {
      const { output, diagnostics } = compile(
        parseSource(`${header}
workflow first:
    description: "First"
    steps: ->
        say "First: {!@system_variables.uploaded_files}"
workflow second:
    description: "Second"
    step work: ->
        say "Second: {!@system_variables.uploaded_files}"
${
  connected
    ? `
connected_subagent remote:
    target: "agent://Remote"
    description: "Remote"
`
    : ''
}
connection messaging:
    reasoning:
        instructions: |
            Files: {!@system_variables.uploaded_files[3]}
`)
      );
      const warnings = diagnostics.filter(
        d => d.severity === DiagnosticSeverity.Warning
      );
      expect(
        diagnostics.filter(d => d.severity === DiagnosticSeverity.Error)
      ).toEqual([]);
      expect(warnings.map(d => d.message)).toEqual([
        expect.stringContaining('not supported for workflow nodes'),
        expect.stringContaining('not supported for workflow nodes'),
        expect.stringContaining('outside a node body'),
      ]);
      for (const node of output.agent_version.nodes) {
        if (node.developer_name !== 'main') {
          expect(node).not.toHaveProperty('file_references');
        }
      }
    }
  );
});

describe('file_references capture', () => {
  it('should capture bare @system_variables.uploaded_files as {all:true}', () => {
    const source = `
config:
    agent_name: "FileBot"
    file_upload:
        mode: "managed"

start_agent main:
    reasoning:
        instructions: ->
            | Files: {!@system_variables.uploaded_files}
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes[0] as SubAgentNode & {
      file_references?: unknown[];
    };

    expect(node.file_references).toEqual([{ all: true }]);
  });

  it('should capture len(...) as {all:true} (bare list access)', () => {
    const source = `
config:
    agent_name: "FileBot"
    file_upload:
        mode: "managed"

start_agent main:
    state:
        count: int
    reasoning:
        instructions: ->
            | Count: {!len(@system_variables.uploaded_files)}
        actions: ->
            set @variables.count = len(@system_variables.uploaded_files)
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes[0] as SubAgentNode & {
      file_references?: unknown[];
    };

    // Both references capture {all:true} (deduped to one entry)
    expect(node.file_references).toEqual([{ all: true }]);
  });

  it('should capture [0] subscript as {index:0}', () => {
    const source = `
config:
    agent_name: "FileBot"
    file_upload:
        mode: "managed"

start_agent main:
    reasoning:
        instructions: ->
            | First file: {!@system_variables.uploaded_files[0].id}
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes[0] as SubAgentNode & {
      file_references?: unknown[];
    };

    expect(node.file_references).toEqual([{ index: 0 }]);
  });

  it('should capture negative index [-1] as {index:-1}', () => {
    const source = `
config:
    agent_name: "FileBot"
    file_upload:
        mode: "managed"

start_agent main:
    reasoning:
        instructions: ->
            | Last file: {!@system_variables.uploaded_files[-1].name}
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes[0] as SubAgentNode & {
      file_references?: unknown[];
    };

    expect(node.file_references).toEqual([{ index: -1 }]);
  });

  it('should capture [0:3] slice as {slice:{start:0,stop:3}}', () => {
    const source = `
config:
    agent_name: "FileBot"
    file_upload:
        mode: "managed"

start_agent main:
    reasoning:
        instructions: ->
            | First three: {!@system_variables.uploaded_files[0:3]}
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes[0] as SubAgentNode & {
      file_references?: unknown[];
    };

    expect(node.file_references).toEqual([
      { slice: { start: 0, stop: 3, step: null } },
    ]);
  });

  it('should capture [:3] slice with open start as {slice:{start:null,stop:3}}', () => {
    const source = `
config:
    agent_name: "FileBot"
    file_upload:
        mode: "managed"

start_agent main:
    reasoning:
        instructions: ->
            | First three: {!@system_variables.uploaded_files[:3]}
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes[0] as SubAgentNode & {
      file_references?: unknown[];
    };

    expect(node.file_references).toEqual([
      { slice: { start: null, stop: 3, step: null } },
    ]);
  });

  it('should capture [2:] slice with open stop as {slice:{start:2,stop:null}}', () => {
    const source = `
config:
    agent_name: "FileBot"
    file_upload:
        mode: "managed"

start_agent main:
    reasoning:
        instructions: ->
            | From third: {!@system_variables.uploaded_files[2:]}
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes[0] as SubAgentNode & {
      file_references?: unknown[];
    };

    expect(node.file_references).toEqual([
      { slice: { start: 2, stop: null, step: null } },
    ]);
  });

  it('should capture multiple distinct references', () => {
    const source = `
config:
    agent_name: "FileBot"
    file_upload:
        mode: "managed"

start_agent main:
    reasoning:
        instructions: ->
            | All: {!@system_variables.uploaded_files}
            | First: {!@system_variables.uploaded_files[0]}
            | Last: {!@system_variables.uploaded_files[-1]}
            | Slice: {!@system_variables.uploaded_files[0:2]}
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes[0] as SubAgentNode & {
      file_references?: unknown[];
    };

    expect(node.file_references).toHaveLength(4);
    expect(node.file_references).toContainEqual({ all: true });
    expect(node.file_references).toContainEqual({ index: 0 });
    expect(node.file_references).toContainEqual({ index: -1 });
    expect(node.file_references).toContainEqual({
      slice: { start: 0, stop: 2, step: null },
    });
  });

  it('should deduplicate identical references', () => {
    const source = `
config:
    agent_name: "FileBot"
    file_upload:
        mode: "managed"

start_agent main:
    reasoning:
        instructions: ->
            | File A: {!@system_variables.uploaded_files[0].id}
            | File B: {!@system_variables.uploaded_files[0].name}
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes[0] as SubAgentNode & {
      file_references?: unknown[];
    };

    // Both [0] references should be deduped to one entry
    expect(node.file_references).toEqual([{ index: 0 }]);
  });

  it('should capture .id member access (subscript is captured, not the .id)', () => {
    const source = `
config:
    agent_name: "FileBot"
    file_upload:
        mode: "managed"

start_agent main:
    reasoning:
        instructions: ->
            | File ID: {!@system_variables.uploaded_files[0].id}
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes[0] as SubAgentNode & {
      file_references?: unknown[];
    };

    // Capture the [0] subscript; .id is a sub-member access
    expect(node.file_references).toEqual([{ index: 0 }]);
  });

  it('should attach gate when reference is inside if conditional', () => {
    const source = `
config:
    agent_name: "FileBot"
    file_upload:
        mode: "managed"

start_agent main:
    state:
        needs_doc: bool
    reasoning:
        instructions: ->
            if @variables.needs_doc:
                | Files: {!@system_variables.uploaded_files}
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes[0] as SubAgentNode & {
      file_references?: unknown[];
    };

    expect(node.file_references).toHaveLength(1);
    const entry = node.file_references![0] as Record<string, unknown>;
    expect(entry.all).toBe(true);
    expect(entry.enabled).toBeDefined();
    expect(typeof entry.enabled).toBe('string');
    // Gate should contain the compiled condition variable
    expect(entry.enabled as string).toContain('AgentScriptInternal_condition');
  });

  it('should NOT include gate key when reference is unconditional', () => {
    const source = `
config:
    agent_name: "FileBot"
    file_upload:
        mode: "managed"

start_agent main:
    reasoning:
        instructions: ->
            | Files: {!@system_variables.uploaded_files}
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes[0] as SubAgentNode & {
      file_references?: unknown[];
    };

    expect(node.file_references).toEqual([{ all: true }]);
    // `enabled` key should not be present at all (not undefined, not null)
    const entry = node.file_references![0] as Record<string, unknown>;
    expect('enabled' in entry).toBe(false);
  });

  it('should omit file_references when no uploaded_files reference exists', () => {
    const source = `
config:
    agent_name: "FileBot"
    file_upload:
        mode: "managed"

start_agent main:
    reasoning:
        instructions: ->
            | Hello world
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes[0] as SubAgentNode & {
      file_references?: unknown[];
    };

    // file_references should not be defined (not empty array, but absent)
    expect(node.file_references).toBeUndefined();
  });

  it('should warn and skip capture for dynamic subscript [@variables.i]', () => {
    const source = `
config:
    agent_name: "FileBot"
    file_upload:
        mode: "managed"

start_agent main:
    state:
        i: int
    reasoning:
        instructions: ->
            | File: {!@system_variables.uploaded_files[@variables.i]}
`;
    const { output, diagnostics } = compile(parseSource(source));
    const node = output.agent_version.nodes[0] as SubAgentNode & {
      file_references?: unknown[];
    };

    // No capture (dynamic subscript)
    expect(node.file_references).toBeUndefined();

    // Should emit a warning diagnostic
    const warnings = diagnostics.filter(d => d.severity === 2); // Warning
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some(d => d.message.includes('dynamic subscript'))).toBe(
      true
    );
  });

  it('should warn and skip capture for dynamic slice bounds', () => {
    const source = `
config:
    agent_name: "FileBot"
    file_upload:
        mode: "managed"

start_agent main:
    state:
        start: int
    reasoning:
        instructions: ->
            | Files: {!@system_variables.uploaded_files[@variables.start:3]}
`;
    const { output, diagnostics } = compile(parseSource(source));
    const node = output.agent_version.nodes[0] as SubAgentNode & {
      file_references?: unknown[];
    };

    // No capture (dynamic slice bound)
    expect(node.file_references).toBeUndefined();

    // Should emit a warning diagnostic
    const warnings = diagnostics.filter(d => d.severity === 2); // Warning
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some(d => d.message.includes('Slice bounds'))).toBe(true);
  });

  it('should capture the step for a stepped slice [0:9:2] (exact strided selection)', () => {
    const source = `
config:
    agent_name: "FileBot"
    file_upload:
        mode: "managed"

start_agent main:
    reasoning:
        instructions: ->
            | Every other: {!@system_variables.uploaded_files[0:9:2]}
`;
    const { output, diagnostics } = compile(parseSource(source));
    const node = output.agent_version.nodes[0] as SubAgentNode & {
      file_references?: unknown[];
    };

    // The step is carried through verbatim so the runtime applies the exact
    // strided selection (fifo[0:9:2] → files 0, 2, 4, 6, 8) rather than
    // over-selecting the whole 0:9 range.
    expect(node.file_references).toEqual([
      { slice: { start: 0, stop: 9, step: 2 } },
    ]);

    // No slice-related warning — a valid stepped slice is captured exactly, so
    // neither the "must be integer literals" nor the "step must not be 0" guard
    // (the only slice diagnostics this compiler emits) should fire.
    const warnings = diagnostics.filter(d => d.severity === 2); // Warning
    expect(warnings.some(d => d.message.includes('Slice'))).toBe(false);
  });

  it('should capture a negative step [::-1] (reverse — same membership)', () => {
    const source = `
config:
    agent_name: "FileBot"
    file_upload:
        mode: "managed"

start_agent main:
    reasoning:
        instructions: ->
            | Reversed: {!@system_variables.uploaded_files[::-1]}
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes[0] as SubAgentNode & {
      file_references?: unknown[];
    };

    expect(node.file_references).toEqual([
      { slice: { start: null, stop: null, step: -1 } },
    ]);
  });

  it('should warn and skip capture for a zero step [0:9:0] (invalid Python slice)', () => {
    const source = `
config:
    agent_name: "FileBot"
    file_upload:
        mode: "managed"

start_agent main:
    reasoning:
        instructions: ->
            | Bad: {!@system_variables.uploaded_files[0:9:0]}
`;
    const { output, diagnostics } = compile(parseSource(source));
    const node = output.agent_version.nodes[0] as SubAgentNode & {
      file_references?: unknown[];
    };

    // step=0 raises ValueError when applied in Python; the compiler refuses to
    // emit a descriptor the runtime would choke on.
    expect(node.file_references).toBeUndefined();

    const warnings = diagnostics.filter(d => d.severity === 2); // Warning
    expect(
      warnings.some(d => d.message.includes('Slice step must not be 0'))
    ).toBe(true);
  });

  it('should warn and skip capture for a dynamic step [0:9:@variables.n]', () => {
    const source = `
config:
    agent_name: "FileBot"
    file_upload:
        mode: "managed"

start_agent main:
    state:
        n: int
    reasoning:
        instructions: ->
            | Files: {!@system_variables.uploaded_files[0:9:@variables.n]}
`;
    const { output, diagnostics } = compile(parseSource(source));
    const node = output.agent_version.nodes[0] as SubAgentNode & {
      file_references?: unknown[];
    };

    // A non-literal step cannot be pre-resolved → skip capture + surface it.
    expect(node.file_references).toBeUndefined();

    const warnings = diagnostics.filter(d => d.severity === 2); // Warning
    expect(warnings.some(d => d.message.includes('Slice bounds'))).toBe(true);
  });

  it('should differentiate gated vs ungated references (distinct entries)', () => {
    const source = `
config:
    agent_name: "FileBot"
    file_upload:
        mode: "managed"

start_agent main:
    state:
        needs_doc: bool
    reasoning:
        instructions: ->
            | Unconditional: {!@system_variables.uploaded_files[0]}
            if @variables.needs_doc:
                | Conditional: {!@system_variables.uploaded_files[0]}
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes[0] as SubAgentNode & {
      file_references?: unknown[];
    };

    // Two distinct entries: one without `enabled`, one with `enabled`
    expect(node.file_references).toHaveLength(2);

    const ungated = node.file_references!.find(
      e => !(e as Record<string, unknown>).enabled
    ) as Record<string, unknown>;
    const gated = node.file_references!.find(
      e => (e as Record<string, unknown>).enabled
    ) as Record<string, unknown>;

    expect(ungated).toEqual({ index: 0 });
    expect(gated.index).toBe(0);
    expect(typeof gated.enabled).toBe('string');
  });

  it('should attach file_references to both subagent and router nodes', () => {
    const source = `
config:
    agent_name: "MultiNode"
    file_upload:
        mode: "managed"

start_agent router:
    model_config:
        model: "hyperclassifier://my-model"
    reasoning:
        instructions: ->
            | Router files: {!@system_variables.uploaded_files}

topic worker:
    reasoning:
        instructions: ->
            | Worker files: {!@system_variables.uploaded_files[0]}
`;
    const { output } = compile(parseSource(source));

    const routerNode = output.agent_version.nodes.find(
      n => n.developer_name === 'router'
    ) as SubAgentNode & { file_references?: unknown[] };
    const workerNode = output.agent_version.nodes.find(
      n => n.developer_name === 'worker'
    ) as SubAgentNode & { file_references?: unknown[] };

    expect(routerNode.file_references).toEqual([{ all: true }]);
    expect(workerNode.file_references).toEqual([{ index: 0 }]);
  });

  it('should NOT capture a reference used only in action bindings (not prompt text)', () => {
    // Only prompt text the LLM reads drives MANAGED visibility. When a file is
    // referenced solely in action bindings — a reasoning tool's `with` clause,
    // its `available when`, a post-action `run ... with`, a `set` value, or a
    // @utils.setVariables `set` — the value resolves from session state, not the
    // request's attachment channel, so filtering attachments never starves it.
    // The compiler must emit NO file_references for a node whose only references
    // live in these binding positions; capturing would over-attach a file the
    // model was never told about.
    const source = `
config:
    agent_name: "FileBot"
    file_upload:
        mode: "managed"

start_agent main:
    state:
        needs_upload: bool
        do_send: bool
        first_file: string
    actions:
        upload_doc:
            description: "Upload a doc"
            target: "flow://upload_doc"
            inputs:
                doc: string
    after_reasoning:
        if @variables.needs_upload:
            run @actions.upload_doc
                with doc=@system_variables.uploaded_files[0].id
    reasoning:
        instructions: ->
            | Handle uploads
        actions:
            do_upload: @actions.upload_doc
                with doc=@system_variables.uploaded_files[0].id
                available when @variables.do_send
                if @variables.do_send:
                    run @actions.upload_doc
                        with doc=@system_variables.uploaded_files[1].id
            stash: @utils.setVariables
                set @variables.first_file = @system_variables.uploaded_files[0].id
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes[0] as SubAgentNode & {
      file_references?: unknown[];
    };

    // No reference lives in prompt text, so nothing is captured — the file's
    // content is never attached, and the action bindings still resolve it from
    // state.
    expect(node.file_references).toBeUndefined();
  });

  it('should warn (not silently drop) for uploaded_files in a connection surface (compiled outside the node loop)', () => {
    // Connection surfaces compile AFTER the per-node loop, so a reference in a
    // surface's instructions lands in a detached accumulator and never attaches
    // to a node. That would make MANAGED fail closed on the file with no
    // signal — so the compiler must surface it rather than drop it silently.
    const source = `
config:
    agent_name: "FileBot"
    file_upload:
        mode: "managed"

connection messaging:
    reasoning:
        instructions: |
            Refer to file {!@system_variables.uploaded_files[0]}

start_agent main:
    reasoning:
        instructions: ->
            | Body without file refs
`;
    const { output, diagnostics } = compile(parseSource(source));
    const node = output.agent_version.nodes.find(
      n => n.developer_name === 'main'
    ) as SubAgentNode & { file_references?: unknown[] };

    // The reference is NOT attached to any node (it is outside a node body)…
    expect(node.file_references).toBeUndefined();
    // …but the loss is surfaced as a diagnostic.
    const warnings = diagnostics.filter(d => d.severity === 2); // Warning
    expect(warnings.some(d => d.message.includes('outside a node body'))).toBe(
      true
    );
  });

  it('should attach a global system.instructions reference to every node', () => {
    // Global `system.instructions` is injected into every node's prompt, so a
    // reference there is compiled once per node inside the capture window and
    // must fan out onto all of them — router and subagent alike. (Contrast the
    // surface case above, which lands outside the loop and warns instead.)
    const source = `
config:
    agent_name: "FileBot"
    file_upload:
        mode: "managed"

system:
    instructions: |
        Refer to {!@system_variables.uploaded_files[0]}

start_agent router:
    model_config:
        model: "hyperclassifier://my-model"
    reasoning:
        instructions: ->
            | Router body without file refs

topic worker:
    reasoning:
        instructions: ->
            | Worker body without file refs
`;
    const { output } = compile(parseSource(source));
    const routerNode = output.agent_version.nodes.find(
      n => n.developer_name === 'router'
    ) as SubAgentNode & { file_references?: unknown[] };
    const workerNode = output.agent_version.nodes.find(
      n => n.developer_name === 'worker'
    ) as SubAgentNode & { file_references?: unknown[] };

    // The one global reference lands identically on both nodes.
    expect(routerNode.file_references).toEqual([{ index: 0 }]);
    expect(workerNode.file_references).toEqual([{ index: 0 }]);
  });

  it('should handle bracket form @system_variables["uploaded_files"]', () => {
    const source = `
config:
    agent_name: "FileBot"
    file_upload:
        mode: "managed"

start_agent main:
    reasoning:
        instructions: ->
            | Files: {!@system_variables["uploaded_files"]}
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes[0] as SubAgentNode & {
      file_references?: unknown[];
    };

    expect(node.file_references).toEqual([{ all: true }]);
  });

  // Two sibling `if`s that each capture a file reference must gate on DISTINCT
  // slots. Sharing one slot is safe for inline `enabled` but not for file gates,
  // which resolve against the node's final state — where a shared slot holds
  // only the last sibling's value.
  it('should give sibling file-gated if-chains distinct condition slots', () => {
    const source = `
config:
    agent_name: "FileBot"
    file_upload:
        mode: "managed"

start_agent main:
    state:
        a: bool
        b: bool
    reasoning:
        instructions: ->
            if @variables.a:
                | Doc A: {!@system_variables.uploaded_files[0]}
            if @variables.b:
                | Doc B: {!@system_variables.uploaded_files[1]}
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes[0] as SubAgentNode & {
      file_references?: unknown[];
    };

    expect(node.file_references).toHaveLength(2);
    const gates = node.file_references!.map(
      e => (e as Record<string, unknown>).enabled as string
    );
    // First `if` keeps slot 1; the second is reserved slot 2.
    expect(gates[0]).not.toBe(gates[1]);
    expect(gates[0]).toBe('state.AgentScriptInternal_condition_1');
    expect(gates[1]).toBe('state.AgentScriptInternal_condition_2');
  });

  it('should give sibling file-gated else-if chains distinct condition slots', () => {
    // First chain uses slots 1..2; being file-gated it reserves them, so the
    // second chain gets slots 3..4 rather than colliding on slot 1.
    const source = `
config:
    agent_name: "FileBot"
    file_upload:
        mode: "managed"

start_agent main:
    state:
        a: bool
        b: bool
        c: bool
        d: bool
    reasoning:
        instructions: ->
            if @variables.a:
                | Doc A: {!@system_variables.uploaded_files[0]}
            else if @variables.b:
                | (no file here)
            if @variables.c:
                | Doc C: {!@system_variables.uploaded_files[1]}
            else if @variables.d:
                | (no file here)
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes[0] as SubAgentNode & {
      file_references?: unknown[];
    };

    expect(node.file_references).toHaveLength(2);
    const gates = node.file_references!.map(
      e => (e as Record<string, unknown>).enabled as string
    );
    expect(gates[0]).toContain('state.AgentScriptInternal_condition_1');
    expect(gates[1]).toContain('state.AgentScriptInternal_condition_3');
    expect(gates[0]).not.toBe(gates[1]);
  });

  it('should over-select (not under-select) for the mixed bracket+index form @system_variables["uploaded_files"][0]', () => {
    // The mixed form indexes the bracket-string subscript rather than the
    // canonical `.uploaded_files` member, so it does not reach the index
    // extraction branch: the inner bracket form captures {all:true} and the
    // outer [0] is not narrowed. This over-selects (a superset of {index:0}),
    // which is fail-safe for MANAGED — it never drops file 0. Authors should
    // prefer the canonical `.uploaded_files[0]` (captured exactly as
    // {index:0}); this test pins the documented fallback for the obscure form.
    const source = `
config:
    agent_name: "FileBot"
    file_upload:
        mode: "managed"

start_agent main:
    reasoning:
        instructions: ->
            | File: {!@system_variables["uploaded_files"][0]}
`;
    const { output } = compile(parseSource(source));
    const node = output.agent_version.nodes[0] as SubAgentNode & {
      file_references?: unknown[];
    };

    expect(node.file_references).toEqual([{ all: true }]);
  });

  // Golden fixture: every other test asserts one node's `file_references` in
  // isolation, which makes the *assembled* artifact hard to picture. This one
  // compiles a whole multi-node agent and pins the full per-node table — the
  // shape a reviewer actually reads: router (no refs) + three topics exercising
  // index / gated-index / slice / no-refs, side by side.
  it('should emit the full per-node file_references table for a multi-node agent (assembled shape)', () => {
    const source = `
config:
    agent_name: "ScopingBot"
    file_upload:
        mode: "managed"

start_agent router:
    model_config:
        model: "hyperclassifier://my-model"
    state:
        needs_doc: bool
    reasoning:
        instructions: ->
            | Route the request.

topic doc_reader:
    reasoning:
        instructions: ->
            | Read: {!@system_variables.uploaded_files[0].name}
            if @variables.needs_doc:
                | Extra: {!@system_variables.uploaded_files[1]}

topic multi_doc:
    reasoning:
        instructions: ->
            | Compare: {!@system_variables.uploaded_files[0:2]}

topic chit_chat:
    reasoning:
        instructions: ->
            | Just chat, no files.
`;
    const { output } = compile(parseSource(source));

    const table = output.agent_version.nodes.map(n => [
      n.developer_name,
      (n as SubAgentNode & { file_references?: unknown[] }).file_references ??
        null,
    ]);

    expect(table).toEqual([
      // router references no files → key absent (rendered here as null)
      ['router', null],
      // doc_reader: unconditional [0] + gated [1] (the `if` carries a slot gate)
      [
        'doc_reader',
        [
          { index: 0 },
          { index: 1, enabled: 'state.AgentScriptInternal_condition_1' },
        ],
      ],
      // multi_doc: an explicit slice descriptor with an open step
      ['multi_doc', [{ slice: { start: 0, stop: 2, step: null } }]],
      // chit_chat references no files → key absent
      ['chit_chat', null],
    ]);
  });
});

describe('file_references emission gating by file_upload.mode', () => {
  // Emission happens ONLY under `file_upload.mode: managed` — the sole mode
  // whose runtime consumes the descriptors (the reasoner's `_apply_managed_mode`
  // filters request attachments to referenced files). `auto` / `error` /
  // `disabled` and an absent block (which defaults to `auto`) never read them,
  // so the compiler emits nothing there rather than shipping dead data.
  const nodeFor = (source: string) => {
    const { output } = compile(parseSource(source));
    return output.agent_version.nodes[0] as SubAgentNode & {
      file_references?: unknown[];
    };
  };

  const bodyWithRef = `
start_agent main:
    reasoning:
        instructions: ->
            | First file: {!@system_variables.uploaded_files[0].id}
`;

  it("emits file_references when file_upload.mode is 'managed'", () => {
    const node = nodeFor(`
config:
    agent_name: "GateBot"
    file_upload:
        mode: "managed"
${bodyWithRef}`);
    expect(node.file_references).toEqual([{ index: 0 }]);
  });

  it('suppresses file_references when file_upload is absent (defaults to auto)', () => {
    const node = nodeFor(`
config:
    agent_name: "GateBot"
${bodyWithRef}`);
    expect(node.file_references).toBeUndefined();
  });

  for (const mode of ['auto', 'error', 'disabled'] as const) {
    it(`suppresses file_references when file_upload.mode is '${mode}'`, () => {
      const node = nodeFor(`
config:
    agent_name: "GateBot"
    file_upload:
        mode: "${mode}"
${bodyWithRef}`);
      // Only managed scopes files; every other mode ignores the descriptors, so
      // emitting them would be dead data the runtime never reads.
      expect(node.file_references).toBeUndefined();
    });
  }

  it('does not warn about out-of-node references when uploads are not managed', () => {
    // A reference in a connection surface normally warns under managed (it never
    // attaches to a node). Outside managed, capture is off entirely, so there is
    // nothing to track — the walk must stay silent rather than emit a misleading
    // warning for a mode that ignores file_references anyway.
    const { diagnostics } = compile(
      parseSource(`
config:
    agent_name: "GateBot"
    file_upload:
        mode: "auto"

connection messaging:
    reasoning:
        instructions: ->
            | Files: {!@system_variables.uploaded_files}
`)
    );
    const fileWarnings = diagnostics.filter(d =>
      d.message.includes('uploaded_files')
    );
    expect(fileWarnings).toHaveLength(0);
  });
});
