/**
 * LanguageService — stateful API for editors. Caches parse/lint results
 * between updates. Language intelligence methods are lazy.
 */

import type { SyntaxNode, AstRoot } from './core/types.js';
import type { Diagnostic } from './core/diagnostics.js';
import { Dialect } from './core/dialect.js';
import { LintEngine, PassStore } from './core/analysis/lint.js';
import {
  createSchemaContext,
  type SchemaContext,
} from './core/analysis/scope.js';
import {
  getDocumentSymbols,
  type DocumentSymbol,
} from './core/analysis/symbols.js';
import {
  findDefinitionAtPosition,
  findReferencesAtPosition,
  type DefinitionResult,
  type ReferenceOccurrence,
} from './core/analysis/references.js';
import {
  findEnclosingScope,
  getAvailableNamespaces,
  getCompletionCandidates,
  getFieldCompletions,
  type CompletionCandidate,
} from './core/analysis/completions.js';
import type { ScopeContext } from './core/analysis/scope.js';
import { positionIndexKey } from './core/analysis/position-index.js';
import type { DialectConfig } from './dialect-config.js';

export interface LanguageService {
  update(cstNode: SyntaxNode): void;
  readonly ast: AstRoot | null;
  readonly diagnostics: ReadonlyArray<Diagnostic>;
  readonly store: PassStore | null;
  getSymbols(): DocumentSymbol[];
  getDefinition(line: number, char: number): DefinitionResult | null;
  getReferences(
    line: number,
    char: number,
    includeDeclaration?: boolean
  ): ReferenceOccurrence[];
  getCompletions(
    line: number,
    char: number,
    namespace: string
  ): CompletionCandidate[];
  getNamespaceCompletions(line: number, char: number): CompletionCandidate[];
  getFieldCompletions(line: number, char: number): CompletionCandidate[];
  getEnclosingScope(line: number, char: number): ScopeContext;
  readonly schemaContext: SchemaContext;
  readonly dialectConfig: DialectConfig;
}

class LanguageServiceImpl implements LanguageService {
  readonly schemaContext: SchemaContext;
  readonly dialectConfig: DialectConfig;

  private _ast: AstRoot | null = null;
  private _diagnostics: Diagnostic[] = [];
  private _store: PassStore | null = null;
  private _symbols: DocumentSymbol[] | null = null;

  private readonly dialect: Dialect;
  private readonly source: string;

  constructor(config: { dialect: DialectConfig }) {
    this.dialectConfig = config.dialect;
    this.source = config.dialect.source ?? `${config.dialect.name}-lint`;

    this.schemaContext = createSchemaContext(config.dialect.schemaInfo);

    this.dialect = new Dialect();
  }

  update(cstNode: SyntaxNode): void {
    const result = this.dialect.parse(
      cstNode,
      this.dialectConfig.schemaInfo.schema
    );
    this._ast = result.value;

    // Fresh passes per update — no stale state between updates
    const engine = new LintEngine({
      passes: this.dialectConfig.createRules(),
      source: this.source,
    });
    const engineResult = engine.run(this._ast, this.schemaContext);
    this._store = engineResult.store;
    this._diagnostics = engineResult.diagnostics;

    this._symbols = null;
  }

  get ast(): AstRoot | null {
    return this._ast;
  }

  get diagnostics(): ReadonlyArray<Diagnostic> {
    return this._diagnostics;
  }

  get store(): PassStore | null {
    return this._store;
  }

  getSymbols(): DocumentSymbol[] {
    if (!this._ast) return [];
    if (this._symbols) return this._symbols;
    this._symbols = getDocumentSymbols(this._ast);
    return this._symbols;
  }

  getDefinition(line: number, char: number): DefinitionResult | null {
    if (!this._ast) return null;
    const index = this._store?.get(positionIndexKey);
    return findDefinitionAtPosition(
      this._ast,
      line,
      char,
      this.schemaContext,
      this.getSymbols(),
      index
    );
  }

  getReferences(
    line: number,
    char: number,
    includeDeclaration = true
  ): ReferenceOccurrence[] {
    if (!this._ast) return [];
    const index = this._store?.get(positionIndexKey);
    return findReferencesAtPosition(
      this._ast,
      line,
      char,
      includeDeclaration,
      this.schemaContext,
      this.getSymbols(),
      index
    );
  }

  getCompletions(
    line: number,
    char: number,
    namespace: string
  ): CompletionCandidate[] {
    if (!this._ast) return [];
    const scope = this.getEnclosingScope(line, char);
    return getCompletionCandidates(
      this._ast,
      namespace,
      this.schemaContext,
      scope,
      this.getSymbols(),
      line,
      char
    );
  }

  getNamespaceCompletions(line: number, char: number): CompletionCandidate[] {
    const scope = this.getEnclosingScope(line, char);
    return getAvailableNamespaces(this.schemaContext, scope);
  }

  getFieldCompletions(line: number, char: number): CompletionCandidate[] {
    if (!this._ast) return [];
    return getFieldCompletions(this._ast, line, char, this.schemaContext);
  }

  getEnclosingScope(line: number, char: number): ScopeContext {
    if (!this._ast) return {};
    const index = this._store?.get(positionIndexKey);
    return findEnclosingScope(this._ast, line, char, index);
  }
}

export function createLanguageService(config: {
  dialect: DialectConfig;
}): LanguageService {
  return new LanguageServiceImpl(config);
}
