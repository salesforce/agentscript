/**
 * @agentscript/agentforce — Batteries-included AgentScript SDK for Agentforce.
 *
 * Parse, mutate, emit, lint, and compile AgentScript documents.
 * Uses a pure TypeScript parser — no native addons or WASM required.
 *
 * @example
 * ```typescript
 * import { parse, compileSource } from '@agentscript/agentforce';
 *
 * const doc = parse('system:\n  instructions: "Hello"');
 * console.log(doc.emit());
 *
 * const result = compileSource(source);
 * console.log(result.output);
 * ```
 *
 * @packageDocumentation
 */

// Parser — init() enables WASM tree-sitter; without it, parser-javascript is used
export { init, getParser, executeQuery } from './parser.js';
export type { QueryCapture } from './parser.js';

// generateSemanticTokens — CST-walk override of the @agentscript/language version
export { generateSemanticTokens } from './semantic-tokens.js';

// Primary API
export { parse } from './parse.js';
export { parseComponent, parseComponentDebug } from './parse-component.js';
export {
  getComponentKindConfig,
  getComponentKindOptions,
  type ComponentKindConfig,
  type ComponentParseResult,
} from './component-kind.js';
export { emitComponent, type EmitComponentOptions } from './emit-component.js';
export {
  mutateComponent,
  validateStrictSchema,
  type MutateComponentOptions,
} from './mutate-component.js';
export { Document } from './document.js';
export { compileSource } from './compile.js';
export type { AgentforceCompileResult } from './compile.js';

// Types
export type {
  ComponentKind,
  ComponentResultMap,
  SingularKeys,
  NamedKeys,
  MutationHelpers,
  BlockFieldKeys,
  HistoryEntry,
  SerializedCSTNode,
  ParseComponentDebugResult,
} from './types.js';

// Re-exports from @agentscript/language — all types, classes, and utilities
export * from '@agentscript/language';

// Agentforce dialect — schema, parsed types, and block constructors
export * from '@agentscript/agentforce-dialect';

// Compiler
export { compile, serialize } from '@agentscript/compiler';
export type { AgentDSLAuthoring, CompileResult } from '@agentscript/compiler';
