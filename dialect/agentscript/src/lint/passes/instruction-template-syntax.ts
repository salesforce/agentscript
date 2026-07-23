/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Instruction template syntax validation.
 *
 * Scans instruction field text for common incorrect template syntax patterns
 * and emits Information-level diagnostics with guidance on correct syntax.
 *
 * Patterns detected:
 * - {@variables.X} (missing !) → should be {!@variables.X}
 * - {@system_variables.X} (missing !) → should be {!@system_variables.X}
 *
 * Scans all instruction forms:
 * - StringLiteral: "quoted string"
 * - TemplateExpression: | pipe syntax
 * - ProcedureValue: only its Template (pipe-text) statements — procedural
 *   directives (if/with/run/etc.) are not scanned.
 *
 * Only scans instruction fields (system.instructions, reasoning.instructions).
 *
 * Diagnostic code: instruction-template-syntax
 */

import type { LintPass, PassStore, AstNodeLike } from '@agentscript/language';
import {
  storeKey,
  attachDiagnostic,
  LINT_SOURCE,
  isNamedMap,
} from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import type { CstMeta, Range } from '@agentscript/types';

export const instructionTemplateSyntaxKey = storeKey<void>(
  'instruction-template-syntax'
);

interface PatternMatch {
  pattern: string;
  message: string;
  offset: number;
  length: number;
}

class InstructionTemplateSyntaxPass implements LintPass {
  readonly id = instructionTemplateSyntaxKey;
  readonly description =
    'Validates template syntax patterns in instruction fields';
  readonly requires = [];

  run(_store: PassStore, root: AstNodeLike): void {
    // Collect all variable names from the variables: block for bare-name detection
    const variableNames: string[] = [];
    const rootAny = root as Record<string, unknown>;
    if (rootAny.variables && isNamedMap(rootAny.variables)) {
      for (const [name] of rootAny.variables) {
        variableNames.push(name);
      }
    }

    // Walk AST to find all System and Reasoning blocks, then scan their instructions
    // visited WeakSet prevents infinite loops when traversing circular AST references
    const visited = new WeakSet<object>();
    this.walkForBlocks(root, visited, variableNames);
  }

  private walkForBlocks(
    node: unknown,
    visited: WeakSet<object>,
    variableNames: string[]
  ): void {
    if (!node || typeof node !== 'object') return;
    if (visited.has(node)) return;
    visited.add(node);

    // Safe cast: node is narrowed to object and AstNodeLike allows index access
    const anyNode = node as unknown as AstNodeLike;

    // Check if this node has an instructions field
    // (applies to SystemBlock, ReasoningBlock, or any object with instructions)
    if (anyNode.instructions && typeof anyNode.instructions === 'object') {
      this.scanInstructionNode(
        anyNode.instructions as AstNodeLike,
        variableNames
      );
    }

    // Recurse through all object properties
    for (const key in node) {
      if (!Object.hasOwn(node, key)) continue;
      if (key.startsWith('__')) continue; // Skip metadata
      if (key === 'instructions') continue; // Already scanned above
      const value = anyNode[key];
      if (value && typeof value === 'object') {
        if (Array.isArray(value)) {
          for (const item of value) {
            this.walkForBlocks(item, visited, variableNames);
          }
        } else if (value instanceof Map || isNamedMap(value)) {
          // Handle both Map and NamedMap (which has .entries() but isn't instanceof Map)
          for (const [_, mapValue] of value.entries()) {
            this.walkForBlocks(mapValue, visited, variableNames);
          }
        } else {
          this.walkForBlocks(value, visited, variableNames);
        }
      }
    }
  }

  private scanInstructionNode(
    node: AstNodeLike,
    variableNames: string[]
  ): void {
    switch (node.__kind) {
      case 'StringLiteral':
        this.scanStringLiteral(node, variableNames);
        break;
      case 'TemplateExpression':
        this.scanTemplateExpression(node, variableNames);
        break;
      case 'ProcedureValue':
        this.scanProcedureValue(node, variableNames);
        break;
      default:
        // Unknown instruction node type - skip
        break;
    }
  }

  private scanStringLiteral(node: AstNodeLike, variableNames: string[]): void {
    const valueNode = node as { value?: string };
    const text = valueNode.value;
    if (typeof text !== 'string' || !text) return;

    this.scanTextAndAttach(text, node, variableNames);
  }

  private scanTemplateExpression(
    node: AstNodeLike,
    variableNames: string[]
  ): void {
    const templateNode = node as { parts?: AstNodeLike[]; value?: string };

    // For pipe syntax (|), the entire text might be in a single value field
    if (typeof templateNode.value === 'string') {
      this.scanTextAndAttach(templateNode.value, node, variableNames);
      return;
    }

    // For regular templates, scan parts
    if (!Array.isArray(templateNode.parts)) return;

    for (const part of templateNode.parts) {
      if (part.__kind === 'TemplateText') {
        const textNode = part as { value?: string };
        if (typeof textNode.value === 'string') {
          this.scanTextAndAttach(textNode.value, part, variableNames);
        }
      }
    }
  }

  private scanProcedureValue(node: AstNodeLike, variableNames: string[]): void {
    const procedureNode = node as { statements?: AstNodeLike[] };
    if (!Array.isArray(procedureNode.statements)) return;

    // Only scan Template statements (pipe/plain text) - procedural
    // directives (IfStatement, WithClause, RunStatement, etc.) are code,
    // not LLM-facing text, so they're not subject to template syntax rules.
    for (const statement of procedureNode.statements) {
      if (statement.__kind === 'Template') {
        this.scanTemplateExpression(statement, variableNames);
      }
    }
  }

  private scanTextAndAttach(
    text: string,
    node: AstNodeLike,
    variableNames: string[]
  ): void {
    const matches = this.detectPatterns(text, variableNames);

    for (const match of matches) {
      const range = this.computeRange(node, match.offset, match.length);
      attachDiagnostic(node, {
        range,
        message: match.message,
        severity: DiagnosticSeverity.Information,
        code: 'instruction-template-syntax',
        source: LINT_SOURCE,
      });
    }
  }

  private computeRange(
    node: AstNodeLike,
    offset: number,
    length: number
  ): Range {
    const cst = node.__cst as CstMeta | undefined;
    if (!cst?.range) {
      return {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
      };
    }

    // Compute precise range for the match
    // For now, use single-line calculation
    // TODO: handle multi-line by computing line/character from offset
    return {
      start: {
        line: cst.range.start.line,
        character: cst.range.start.character + offset,
      },
      end: {
        line: cst.range.start.line,
        character: cst.range.start.character + offset + length,
      },
    };
  }

  private detectPatterns(
    text: string,
    variableNames: string[]
  ): PatternMatch[] {
    const matches: PatternMatch[] = [];

    // Data-holding namespaces valid for template interpolation in instruction text
    // @variables: custom/linked variables defined in variables: block
    // @system_variables: predefined read-only system variables
    // Note: @actions, @outputs, @subagents are NOT valid in {!...} interpolation
    const dataNamespaces = ['variables', 'system_variables'];

    // Detect {@namespace.X} patterns (missing !) for each data-holding namespace
    // Only matches single-level paths - nested paths not yet supported
    for (const namespace of dataNamespaces) {
      // Escape special regex characters in namespace name
      const escapedNamespace = namespace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(
        `\\{\\s*@${escapedNamespace}\\.(\\w+)\\s*\\}`,
        'g'
      );
      for (const match of text.matchAll(regex)) {
        matches.push({
          pattern: match[0],
          message: `Reference syntax should be {!@${namespace}.${match[1]}} (note the exclamation mark). The '!' is required for template interpolation.`,
          offset: match.index!,
          length: match[0].length,
        });
      }
    }

    // Detect bare variable names (e.g., "Use foo" where foo is a defined variable)
    // Precompute {..} spans to exclude matches inside braces
    const braceSpans = this.findBraceSpans(text);

    for (const name of variableNames) {
      // Escape special regex characters in variable name
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escapedName}\\b`, 'g');

      for (const match of text.matchAll(regex)) {
        const offset = match.index!;
        // Skip if this match is inside a {..} span (already handled by other patterns)
        if (this.isInBraceSpan(offset, braceSpans)) continue;

        matches.push({
          pattern: match[0],
          message: `'${name}' looks like a variable name — did you mean {!@variables.${name}}? Variable references require template syntax to be interpolated.`,
          offset,
          length: match[0].length,
        });
      }
    }

    return matches;
  }

  /**
   * Find all {..} character spans in text to exclude bare-name matches inside braces.
   */
  private findBraceSpans(text: string): Array<{ start: number; end: number }> {
    const spans: Array<{ start: number; end: number }> = [];
    const regex = /\{[^}]*\}/g;
    for (const match of text.matchAll(regex)) {
      spans.push({
        start: match.index!,
        end: match.index! + match[0].length,
      });
    }
    return spans;
  }

  /**
   * Check if a given offset falls within any brace span.
   */
  private isInBraceSpan(
    offset: number,
    braceSpans: Array<{ start: number; end: number }>
  ): boolean {
    for (const span of braceSpans) {
      if (offset >= span.start && offset < span.end) {
        return true;
      }
    }
    return false;
  }
}

export function instructionTemplateSyntaxPass(): LintPass {
  return new InstructionTemplateSyntaxPass();
}
