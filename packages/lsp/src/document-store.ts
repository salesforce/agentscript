/**
 * Document Store - manages per-URI document state.
 *
 * Caches parse results, diagnostics, and compile outputs for each document.
 */

import type {
  AstRoot,
  LanguageService,
  PassStore,
} from '@agentscript/language';
import type { Diagnostic } from 'vscode-languageserver';

export interface DocumentState {
  /** URI of the document */
  uri: string;
  /** Source text */
  source: string;
  /** Parsed AST root */
  ast: AstRoot | null;
  /** Analysis store (for position-based queries) */
  store: PassStore | null;
  /** Language service for this document's dialect */
  service: LanguageService;
  /** LSP diagnostics (merged from parse/lint/compile) */
  diagnostics: Diagnostic[];
  /** Compile output (agentforce-only, JSON-safe) */
  compileOutput: unknown;
}

export class DocumentStore {
  private documents = new Map<string, DocumentState>();

  /**
   * Set or update a document in the store.
   */
  set(state: DocumentState): void {
    this.documents.set(state.uri, state);
  }

  /**
   * Get a document from the store.
   */
  get(uri: string): DocumentState | undefined {
    return this.documents.get(uri);
  }

  /**
   * Check if a document exists.
   */
  has(uri: string): boolean {
    return this.documents.has(uri);
  }

  /**
   * Remove a document from the store.
   */
  delete(uri: string): void {
    this.documents.delete(uri);
  }

  /**
   * Get all document URIs.
   */
  getAllUris(): string[] {
    return Array.from(this.documents.keys());
  }

  /**
   * Get all document states.
   */
  getAllStates(): DocumentState[] {
    return Array.from(this.documents.values());
  }
}
