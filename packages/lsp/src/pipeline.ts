/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Document update pipeline - dialect-agnostic parse/lint/compile.
 *
 * Uses LanguageService from @agentscript/language for parse + lint in one pass.
 * Compile is optional and only available for dialects that support it.
 */

import type { LanguageService } from '@agentscript/language';
import { createLanguageService, resolveDialect } from '@agentscript/language';
import type { Diagnostic } from 'vscode-languageserver';
import { toLspDiagnostic } from './adapters/types.js';
import type { DocumentState } from './document-store.js';
import type { LspConfig } from './lsp-config.js';

// Re-export for consumers that imported from pipeline
export { resolveDialect } from '@agentscript/language';
export type { VersionDiagnostic, ResolvedDialect } from '@agentscript/language';

/** Diagnostic source for all dialect-annotation diagnostics. */
const DIAG_SOURCE = 'language-server';

/**
 * Process a document: parse, lint, and optionally compile.
 *
 * @param uri - Document URI
 * @param source - Document source text
 * @param config - LSP configuration (dialects, parser, compile hook)
 * @param existingService - Reuse an existing LanguageService if dialect hasn't changed
 * @returns DocumentState with parse/lint/compile results
 */
export function processDocument(
  uri: string,
  source: string,
  config: LspConfig,
  existingService?: LanguageService
): DocumentState {
  const diagnostics: Diagnostic[] = [];
  const { dialect, versionDiagnostic, unknownDialect } = resolveDialect(
    source,
    config
  );

  // Add version constraint diagnostic
  if (versionDiagnostic) {
    diagnostics.push({
      range: {
        start: {
          line: versionDiagnostic.line,
          character: versionDiagnostic.versionStart,
        },
        end: {
          line: versionDiagnostic.line,
          character:
            versionDiagnostic.versionStart + versionDiagnostic.versionLength,
        },
      },
      severity: versionDiagnostic.severity,
      message: versionDiagnostic.message,
      source: DIAG_SOURCE,
      code: 'invalid-version',
      data: { suggestedVersions: versionDiagnostic.suggestedVersions },
    });
  }

  // Add unknown dialect error
  if (unknownDialect) {
    const available = unknownDialect.availableNames.join(', ');
    diagnostics.push({
      range: {
        start: {
          line: unknownDialect.line,
          character: unknownDialect.nameStart,
        },
        end: {
          line: unknownDialect.line,
          character: unknownDialect.nameStart + unknownDialect.nameLength,
        },
      },
      severity: 1, // Error
      message: `Unknown dialect "${unknownDialect.name}". Available dialects: ${available}`,
      source: DIAG_SOURCE,
      code: 'unknown-dialect',
      data: { availableNames: unknownDialect.availableNames },
    });
  }

  // Reuse or create LanguageService for the resolved dialect
  let service: LanguageService;
  if (existingService && existingService.dialectConfig.name === dialect.name) {
    service = existingService;
  } else {
    service = createLanguageService({ dialect });
  }

  // Parse with the injected parser and update the language service
  try {
    const tree = config.parser.parse(source);
    service.update(tree.rootNode);
  } catch (error) {
    diagnostics.push({
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      },
      severity: 1, // Error
      message: `Parse error: ${error instanceof Error ? error.message : String(error)}`,
      source: DIAG_SOURCE,
    });
  }

  // Collect diagnostics from the language service (parse + lint)
  for (const diag of service.diagnostics) {
    diagnostics.push(toLspDiagnostic(diag));
  }

  // Optional compile (agentforce-only) — uses the already-parsed AST
  let compileOutput: unknown = null;
  const compileHook = config.compile?.(dialect.name);
  if (compileHook && service.ast) {
    try {
      const result = compileHook.compile(service.ast, source);
      compileOutput = result.output ?? null;
      for (const diag of result.diagnostics) {
        diagnostics.push(toLspDiagnostic(diag));
      }
    } catch (error) {
      diagnostics.push({
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
        severity: 1,
        message: `Compilation failed: ${error instanceof Error ? error.message : String(error)}`,
        source: DIAG_SOURCE,
      });
    }
  }

  // Sort diagnostics by position (line, character), then severity.
  // Position-first ensures VS Code's marker navigation ("View Problem")
  // finds the correct diagnostic at the cursor position rather than
  // jumping to a higher-severity diagnostic at a different location.
  diagnostics.sort((a, b) => {
    const lineDiff = a.range.start.line - b.range.start.line;
    if (lineDiff !== 0) return lineDiff;
    const charDiff = a.range.start.character - b.range.start.character;
    if (charDiff !== 0) return charDiff;
    return (a.severity ?? 0) - (b.severity ?? 0);
  });

  return {
    uri,
    source,
    ast: service.ast,
    store: service.store,
    service,
    diagnostics,
    compileOutput,
  };
}
