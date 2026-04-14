/**
 * LSP configuration interfaces.
 *
 * Follows the Volar pattern: the core is pure DI, dialects and parser
 * are passed in by the caller (lsp-server, lsp-browser, or custom server).
 */

import type { DialectConfig, AstRoot } from '@agentscript/language';
import type { SyntaxNode, Diagnostic } from '@agentscript/types';

export interface LspParser {
  parse(source: string): { rootNode: SyntaxNode };
}

export interface QueryCapture {
  name: string;
  text: string;
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export interface QueryExecutor {
  executeQuery(source: string): QueryCapture[];
}

/**
 * Compile hook for transforming a parsed AST into compiled output.
 *
 * The hook receives the already-parsed AST to avoid double-parsing in the LSP
 * pipeline. The original source is passed alongside for diagnostics and source
 * map generation. Compilation is skipped when parsing fails (no valid AST),
 * since parse diagnostics already surface the errors.
 *
 * For standalone source-to-output compilation without an LSP pipeline, use
 * `compileSource()` from `@agentscript/agentforce` instead.
 */
export interface CompileHook {
  compile(
    ast: AstRoot,
    source: string
  ): { diagnostics: Diagnostic[]; output?: unknown };
}

export interface LspConfig {
  /** Available dialects, passed by the caller. */
  dialects: DialectConfig[];
  /** Default dialect name when no `# @dialect:` annotation is present. Defaults to first dialect's name. */
  defaultDialect?: string;
  /** Parser instance used for syntax analysis. */
  parser: LspParser;
  /** Query executor for semantic token highlights. */
  queryExecutor?: QueryExecutor;
  /** Optional compile hook factory. Only agentforce supports compile. */
  compile?: (dialectName: string) => CompileHook | undefined;
  /** Enable completion provider. Default: true. */
  enableCompletionProvider?: boolean;
  /** Enable semantic tokens. Default: true. */
  enableSemanticTokens?: boolean;
  /**
   * Async hook called during onInitialize, before the server returns capabilities.
   * Use this for WASM parser initialization in browser environments.
   */
  onBeforeInitialize?: () => Promise<void>;
}
