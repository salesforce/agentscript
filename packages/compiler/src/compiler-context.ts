import type { Range } from '@agentscript/types';
import { DiagnosticSeverity, FALLBACK_RANGE } from './diagnostics.js';
import type { Diagnostic } from './diagnostics.js';
import type { ContextVariable, StateVariable } from './types.js';
import { Sourced } from './sourced.js';
import type { Sourceable } from './sourced.js';

export interface ConnectedAgentInputSignature {
  /** Input names that have definition-time defaults (optional at invocation). */
  inputsWithDefaults: Set<string>;
  /** All input names (both required and optional). */
  allInputs: Set<string>;
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
   * Connected agent input signatures: agent developer name → set of input names.
   * Populated during connected agent node compilation for downstream validation
   * of `with` clauses on @connected_subagent.X tool invocations.
   */
  connectedAgentInputs: Map<string, ConnectedAgentInputSignature> = new Map();

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
