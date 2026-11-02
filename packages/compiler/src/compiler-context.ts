/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { Range } from '@agentscript/types';
import { DiagnosticSeverity, FALLBACK_RANGE } from './diagnostics.js';
import type { Diagnostic } from './diagnostics.js';
import type { ContextVariable, StateVariable } from './types.js';
import { Sourced } from './sourced.js';
import type { Sourceable } from './sourced.js';
import { FileReferenceCapture } from './file-reference-capture.js';
import type { CompileOptions } from './compile.js';

export interface ConnectedAgentInputSignature {
  /** Input names that have definition-time defaults (optional at invocation). */
  inputsWithDefaults: Set<string>;
  /** All input names (both required and optional). */
  allInputs: Set<string>;
  /** Authored description, used as the default tool/routing signal. */
  description?: string;
}

export interface ActionInputSignature {
  /** Required declared inputs, in declaration order. */
  requiredInputs: string[];
}

/**
 * Threaded context for the compilation pipeline.
 * Carries diagnostics, variable lookups, and knowledge data.
 *
 * Source ranges are carried by Sourced<T> values — no manual annotation needed.
 * Only setScriptPath() remains for mapping output objects to script-level paths.
 */
export class CompilerContext {
  readonly diagnostics: Diagnostic[] = [];

  readonly optimize: boolean;

  constructor(options?: CompileOptions) {
    this.optimize = options?.optimize ?? true;
  }

  /**
   * Script block paths: compiled output object → script-level path.
   * E.g., the langConfig object maps to "language".
   * Used by validation diagnostics to show human-readable paths.
   */
  private scriptPaths = new WeakMap<object, string>();

  /** Context (linked) variables compiled from config. */
  contextVariables: ContextVariable[] = [];

  /** State (mutable) variables compiled from the AST. */
  stateVariables: StateVariable[] = [];

  /**
   * The graph's initial node (the start_agent developer name, i.e. the router).
   * Resolved once in compileAgentVersion (`agent_version.initial_node`) and read
   * by collect lowering to target the deterministic completion handoff at the
   * router rather than hardcoding "router".
   */
  initialNode: string | undefined;

  /**
   * Diagnostic `code`s already emitted under the once-per-compile policy (see
   * `addDiagnosticOnce`). Guards script-wide notices — e.g. the `ask for`
   * beta-services legal notice — that must surface a single time regardless of
   * how many nodes would independently raise them.
   */
  private readonly onceEmittedCodes = new Set<string>();

  /**
   * Highest chain-link condition slot index used during node compilation.
   * Populated by `compileChainIfDirective` as it walks `else if` chains.
   * The agent_version assembler reads this after node compilation to declare
   * `AgentScriptInternal_condition_1 .. _N` in `state_variables`.
   */
  maxChainConditionSlot: number = 0;

  /** True when at least one node compiles conditional system instructions. */
  usesDynamicSystemInstructions: boolean = false;

  /**
   * Per-node base for condition-slot allocation. Sibling conditionals normally
   * reuse low slots (fine for inline `enabled`, evaluated as each runs), but a
   * file-reference gate is resolved against the node's final state, so its slot
   * must not be reused by a later sibling. Advanced past a conditional's slots
   * only when it captured a file reference; reset per node.
   */
  nodeConditionSlotBase: number = 0;

  /** Knowledge block field values for eager resolution. */
  knowledgeFields: Map<string, string | boolean> = new Map();

  /** Set of variable names that are "linked" (context) variables. */
  linkedVariableNames: Set<string> = new Set();

  /** Set of variable names that are "mutable" (state) variables. */
  mutableVariableNames: Set<string> = new Set();

  /**
   * Map from @actions reference names to their corresponding tool key names.
   * Built per-topic: maps action definition names and topic targets to the
   * reasoning action key that invokes them.
   */
  actionReferenceMap: Map<string, string> = new Map();

  /**
   * Map from @response_actions binding names to their corresponding response_formats definition names.
   * Built per-connection: maps reasoning.response_actions names to the response_formats
   * they reference (e.g., my_choice → messaging_choices).
   */
  responseFormatReferenceMap: Map<string, string> = new Map();

  /**
   * Current connection name (e.g. "service_email") for @inputs reference resolution.
   * Set per-connection during surface compilation.
   */
  connectionName: string | undefined;

  /**
   * Connected agent input signatures: agent developer name → set of input names.
   * Populated during connected agent node compilation for downstream validation
   * of `with` clauses on @connected_subagent.X tool invocations.
   */
  connectedAgentInputs: Map<string, ConnectedAgentInputSignature> = new Map();

  /**
   * Action definition input signatures by target name (per-topic).
   * Populated when compileActionDefinitions runs; consumed by compileTool /
   * compilePostToolAction to default unbound required declared inputs to
   * LLM-filled. Cleared at the start of each topic compilation.
   */
  actionInputSignatures: Map<string, ActionInputSignature> = new Map();

  /**
   * Input signatures for top-level (GBA) actions, by target name. Snapshotted
   * once when the top-level `actions` block is compiled, and — unlike
   * `actionInputSignatures` — NOT cleared per node. A node whose
   * `reasoning.actions` references an inherited top-level action (`@actions.X`)
   * compiles its reasoning tool after its own `compileActionDefinitions` has
   * cleared the per-node signatures, so `setDefaultLlmInputs` falls back to this
   * map to still seed the action's required `llm_inputs`.
   */
  topLevelActionSignatures: Map<string, ActionInputSignature> = new Map();

  /**
   * All `@system_variables.uploaded_files` capture state and logic for this
   * compile, grouped into one object rather than spread across loose flags. Owns
   * the per-node accumulator, the prompt-text / node scopes, the managed-mode
   * gate, and the enclosing-condition stack. See `FileReferenceCapture`.
   */
  readonly fileCapture = new FileReferenceCapture(this);

  addDiagnostic(
    severity: DiagnosticSeverity,
    message: string,
    range?: Range,
    code?: string
  ): void {
    this.diagnostics.push({
      severity,
      message,
      range: range ?? FALLBACK_RANGE,
      code,
      source: 'compiler',
    });
  }

  error(message: string, range?: Range, code?: string): void {
    this.addDiagnostic(DiagnosticSeverity.Error, message, range, code);
  }

  warning(message: string, range?: Range, code?: string): void {
    this.addDiagnostic(DiagnosticSeverity.Warning, message, range, code);
  }

  info(message: string, range?: Range, code?: string): void {
    this.addDiagnostic(DiagnosticSeverity.Information, message, range, code);
  }

  /**
   * Emit a diagnostic at most once per compile, keyed by `code`. The first call
   * for a given `code` emits normally; later calls with the same `code` are
   * no-ops. Use for script-wide notices that must appear a single time even when
   * many nodes would independently raise them (e.g. beta-service legal notices).
   *
   * `code` is required here because it is the de-duplication key — unlike the
   * range-based collapse in `dedupeDiagnostics`, this fires once regardless of
   * where in the source each trigger sits.
   */
  addDiagnosticOnce(
    severity: DiagnosticSeverity,
    message: string,
    code: string,
    range?: Range
  ): void {
    if (this.onceEmittedCodes.has(code)) return;
    this.onceEmittedCodes.add(code);
    this.addDiagnostic(severity, message, range, code);
  }

  errorOnce(message: string, code: string, range?: Range): void {
    this.addDiagnosticOnce(DiagnosticSeverity.Error, message, code, range);
  }

  warningOnce(message: string, code: string, range?: Range): void {
    this.addDiagnosticOnce(DiagnosticSeverity.Warning, message, code, range);
  }

  infoOnce(message: string, code: string, range?: Range): void {
    this.addDiagnosticOnce(
      DiagnosticSeverity.Information,
      message,
      code,
      range
    );
  }

  /**
   * Record the script block path for an output object.
   * Used to map compiled output paths back to script-level paths in diagnostics.
   */
  setScriptPath(target: object, scriptPath: string): void {
    this.scriptPaths.set(target, scriptPath);
  }

  /**
   * Get the script block path for an output object.
   */
  getScriptPath(target: object): string | undefined {
    return this.scriptPaths.get(target);
  }

  /**
   * Get the variable namespace for a given variable name.
   * Returns 'state' for mutable, 'context' for linked, undefined for unknown.
   */
  getVariableNamespace(name: string): 'state' | 'context' | undefined {
    if (this.mutableVariableNames.has(name)) return 'state';
    if (this.linkedVariableNames.has(name)) return 'context';
    return undefined;
  }

  /**
   * Source range storage: (output object, property key) → Range.
   * Populated automatically by track(). Read by the serializer.
   */
  readonly ranges = new WeakMap<object, Map<string, Range>>();

  /**
   * Track an output object: unwrap all Sourced<T> values to plain primitives
   * and record their source ranges in this.ranges.
   *
   * This is the ONE function compiler authors call. No manual annotations,
   * no unwrap(), no type casts.
   *
   * @example
   *   return ctx.track<Tool>({
   *     type: 'action',
   *     description: extractSourcedDescription(def.description) ?? '',
   *     name: extractSourcedString(def.label) ?? name,
   *   });
   */
  track<T extends object>(obj: Sourceable<T>): T {
    this.unwrapSourced(obj as Record<string, unknown>);
    return obj as T;
  }

  private unwrapSourced(obj: Record<string, unknown>): void {
    for (const key of Object.keys(obj)) {
      const val = obj[key];
      if (val instanceof Sourced) {
        obj[key] = val.value;
        if (val.range) {
          let props = this.ranges.get(obj);
          if (!props) {
            props = new Map();
            this.ranges.set(obj, props);
          }
          props.set(key, val.range);
        }
        // Recurse into unwrapped value if it's an object
        if (
          val.value &&
          typeof val.value === 'object' &&
          !Array.isArray(val.value)
        ) {
          this.unwrapSourced(val.value as Record<string, unknown>);
        }
      } else if (Array.isArray(val)) {
        for (const item of val) {
          if (item && typeof item === 'object') {
            this.unwrapSourced(item as Record<string, unknown>);
          }
        }
      } else if (val && typeof val === 'object') {
        this.unwrapSourced(val as Record<string, unknown>);
      }
    }
  }
}
