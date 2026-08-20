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
 * - {@actions.X} (missing !) → should be {!@actions.X}
 * - @variables.X or variables.X (bare reference) → should be {!@variables.X}
 * - @actions.X or actions.X (bare reference) → should be {!@actions.X}
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
 *
 * Also emits Warning diagnostics for prohibited references in
 * system/reasoning instruction text or workflow prompts. In procedural
 * instructions, only Template statements are scanned; run/with/set syntax is
 * intentionally excluded. Prohibited references are configured in
 * PROHIBITED_PROMPT_REFERENCES.
 */

import type { LintPass, PassStore, AstNodeLike } from '@agentscript/language';
import {
  storeKey,
  attachDiagnostic,
  LINT_SOURCE,
  isNamedMap,
} from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import type { CstMeta, Range, SyntaxNode } from '@agentscript/types';

export const instructionTemplateSyntaxKey = storeKey<void>(
  'instruction-template-syntax'
);

interface PatternMatch {
  pattern: string;
  message: string;
  offset: number;
  length: number;
}

interface TextSpan {
  readonly start: number;
  readonly end: number;
}

type BareReferenceNamespace = 'variables' | 'actions';

const BARE_REFERENCE_PATTERN =
  /(^|[^A-Za-z0-9_@.])(@?(variables|actions)\.([A-Za-z_][A-Za-z0-9_]*))(?![A-Za-z0-9_])/g;

interface ProhibitedPromptReference {
  readonly code: string;
  readonly message: string;
  readonly pattern: RegExp;
  readonly allowedInConnectionInstructions?: boolean;
}

const PROHIBITED_PROMPT_REFERENCES: ReadonlyMap<
  string,
  ProhibitedPromptReference
> = new Map([
  [
    '@outputs',
    {
      code: 'instruction-output-reference',
      message:
        "@outputs cannot be referenced in instructions or prompts. Assign the action result to @variables in the set clause immediately following the action's run statement, then reference that variable instead.",
      pattern: /(?<![A-Za-z0-9_@-])@outputs(?![A-Za-z0-9_-])/g,
    },
  ],
  [
    '@inputs',
    {
      code: 'instruction-input-reference',
      message:
        '@inputs can only be referenced in connection instructions. For other Agent Script instructions or prompts, declare the value under variables and reference it with @variables.<name> instead. In Prompt Builder, use $Input merge-field syntax.',
      pattern: /(?<![A-Za-z0-9_@-])@inputs(?![A-Za-z0-9_-])/g,
      allowedInConnectionInstructions: true,
    },
  ],
]);

interface PendingReferenceDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly range: Range;
}

interface CstScanContext {
  mappingPath: readonly string[];
  inInstructionProcedure: boolean;
}

class InstructionTemplateSyntaxPass implements LintPass {
  readonly id = instructionTemplateSyntaxKey;
  readonly description =
    'Validates template syntax patterns in instruction fields';
  readonly requires = [];

  run(_store: PassStore, root: AstNodeLike): void {
    this.scanProhibitedPromptReferences(root);

    // Collect all variable names from the variables: block for bare-name detection
    const variableNames = new Set<string>();
    const rootAny = root as Record<string, unknown>;
    if (rootAny.variables && isNamedMap(rootAny.variables)) {
      for (const [name] of rootAny.variables) {
        variableNames.add(name);
      }
    }

    // Collect all action names from reasoning.actions blocks inside subagents
    // Actions live at the tool level (start_agent.X.reasoning.actions, subagent.X.reasoning.actions), not root
    const actionNames = new Set<string>();
    this.collectActionNames(root, actionNames, new WeakSet<object>());

    // Walk AST to find all System and Reasoning blocks, then scan their instructions
    // visited WeakSet prevents infinite loops when traversing circular AST references
    const visited = new WeakSet<object>();
    this.walkForBlocks(root, visited, variableNames, actionNames);
  }

  /**
   * Scan the raw CST once so malformed template wrappers remain visible and
   * procedural expressions can be excluded by syntax-node kind. Instruction
   * procedures contribute only their Template statements, at any nesting
   * depth; run/with/set expressions are therefore never scanned.
   */
  private scanProhibitedPromptReferences(root: AstNodeLike): void {
    const cstRoot = (root.__cst as CstMeta | undefined)?.node;
    if (!cstRoot) return;

    const diagnostics: PendingReferenceDiagnostic[] = [];
    const seen = new Set<string>();

    const recordMatches = (node: SyntaxNode, context: CstScanContext): void => {
      const inConnectionInstructions =
        context.mappingPath[0]?.startsWith('connection ') === true;
      let lineStarts: readonly number[] | undefined;

      for (const rule of PROHIBITED_PROMPT_REFERENCES.values()) {
        if (
          inConnectionInstructions &&
          rule.allowedInConnectionInstructions === true
        ) {
          continue;
        }

        for (const match of node.text.matchAll(rule.pattern)) {
          const range = this.computeCstRange(
            node,
            (lineStarts ??= this.computeLineStarts(node.text)),
            match.index!,
            match[0].length
          );
          const key = `${rule.code}:${range.start.line}:${range.start.character}`;
          if (seen.has(key)) continue;
          seen.add(key);
          diagnostics.push({
            code: rule.code,
            message: rule.message,
            range,
          });
        }
      }
    };

    const visit = (node: SyntaxNode, context: CstScanContext): void => {
      if (context.inInstructionProcedure && node.type === 'template') {
        recordMatches(node, context);
      }

      if (node.type === 'mapping_element') {
        const keyNode = node.childForFieldName('key');
        const valueNode =
          node.childForFieldName('colinear_value') ??
          node.childForFieldName('block_value');
        const key = keyNode?.text.trim();
        const owner = context.mappingPath.at(-1);
        const isInstruction =
          key === 'instructions' &&
          (owner === 'system' || owner === 'reasoning');
        const isWorkflowPrompt =
          key === 'prompt' && context.mappingPath.includes('workflows');

        for (const child of node.namedChildren) {
          if (child === valueNode && key) {
            const isProcedure =
              child.type === 'procedure' || child.type === 'mapping';

            if (isInstruction && !isProcedure) {
              recordMatches(child, context);
            } else if (isWorkflowPrompt) {
              recordMatches(child, context);
            }

            visit(child, {
              mappingPath: [...context.mappingPath, key],
              inInstructionProcedure:
                context.inInstructionProcedure ||
                (isInstruction && isProcedure),
            });
          } else {
            visit(child, context);
          }
        }
        return;
      }

      for (const child of node.namedChildren) {
        visit(child, context);
      }
    };

    visit(cstRoot, {
      mappingPath: [],
      inInstructionProcedure: false,
    });

    diagnostics.sort(
      (left, right) =>
        left.range.start.line - right.range.start.line ||
        left.range.start.character - right.range.start.character ||
        left.code.localeCompare(right.code)
    );

    for (const diagnostic of diagnostics) {
      attachDiagnostic(root, {
        ...diagnostic,
        severity: DiagnosticSeverity.Warning,
        source: LINT_SOURCE,
      });
    }
  }

  private computeCstRange(
    node: SyntaxNode,
    lineStarts: readonly number[],
    offset: number,
    length: number
  ): Range {
    return {
      start: this.positionAt(
        lineStarts,
        offset,
        node.startPosition.row,
        node.startPosition.column
      ),
      end: this.positionAt(
        lineStarts,
        offset + length,
        node.startPosition.row,
        node.startPosition.column
      ),
    };
  }

  /**
   * Recursively collect action names from reasoning.actions blocks inside all subagents.
   * Actions are defined at the tool level: subagent.X.reasoning.actions
   */
  private collectActionNames(
    node: unknown,
    actionNames: Set<string>,
    visited: WeakSet<object>
  ): void {
    if (!node || typeof node !== 'object') return;
    if (visited.has(node)) return;
    visited.add(node);

    const anyNode = node as Record<string, unknown>;

    // Check if this node has a reasoning.actions field (tool-level actions)
    if (anyNode.reasoning && typeof anyNode.reasoning === 'object') {
      const reasoning = anyNode.reasoning as Record<string, unknown>;
      if (reasoning.actions && isNamedMap(reasoning.actions)) {
        for (const [name] of reasoning.actions) {
          actionNames.add(name);
        }
      }
    }

    // Recurse through all object properties to find nested reasoning.actions blocks
    for (const key in node) {
      if (!Object.hasOwn(node, key)) continue;
      if (key.startsWith('__')) continue; // Skip metadata
      const value = anyNode[key];
      if (value && typeof value === 'object') {
        if (Array.isArray(value)) {
          for (const item of value) {
            this.collectActionNames(item, actionNames, visited);
          }
        } else if (value instanceof Map || isNamedMap(value)) {
          for (const [_, mapValue] of value.entries()) {
            this.collectActionNames(mapValue, actionNames, visited);
          }
        } else {
          this.collectActionNames(value, actionNames, visited);
        }
      }
    }
  }

  private walkForBlocks(
    node: unknown,
    visited: WeakSet<object>,
    variableNames: ReadonlySet<string>,
    actionNames: ReadonlySet<string>
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
        variableNames,
        actionNames
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
            this.walkForBlocks(item, visited, variableNames, actionNames);
          }
        } else if (value instanceof Map || isNamedMap(value)) {
          // Handle both Map and NamedMap (which has .entries() but isn't instanceof Map)
          for (const [_, mapValue] of value.entries()) {
            this.walkForBlocks(mapValue, visited, variableNames, actionNames);
          }
        } else {
          this.walkForBlocks(value, visited, variableNames, actionNames);
        }
      }
    }
  }

  private scanInstructionNode(
    node: AstNodeLike,
    variableNames: ReadonlySet<string>,
    actionNames: ReadonlySet<string>
  ): void {
    switch (node.__kind) {
      case 'StringLiteral':
        this.scanStringLiteral(node, variableNames, actionNames);
        break;
      case 'TemplateExpression':
        this.scanTemplateExpression(node, variableNames, actionNames);
        break;
      case 'ProcedureValue':
        this.scanProcedureValue(node, variableNames, actionNames);
        break;
      default:
        // Unknown instruction node type - skip
        break;
    }
  }

  private scanStringLiteral(
    node: AstNodeLike,
    variableNames: ReadonlySet<string>,
    actionNames: ReadonlySet<string>
  ): void {
    const valueNode = node as { value?: string };
    const text = valueNode.value;
    if (typeof text !== 'string' || !text) return;

    this.scanTextAndAttach(text, node, variableNames, actionNames);
  }

  private scanTemplateExpression(
    node: AstNodeLike,
    variableNames: ReadonlySet<string>,
    actionNames: ReadonlySet<string>
  ): void {
    const templateNode = node as { parts?: AstNodeLike[]; value?: string };

    // For pipe syntax (|), the entire text might be in a single value field
    if (typeof templateNode.value === 'string') {
      this.scanTextAndAttach(
        templateNode.value,
        node,
        variableNames,
        actionNames
      );
      return;
    }

    // For regular templates, scan parts
    if (!Array.isArray(templateNode.parts)) return;

    for (const part of templateNode.parts) {
      if (part.__kind === 'TemplateText') {
        const textNode = part as { value?: string };
        if (typeof textNode.value === 'string') {
          this.scanTextAndAttach(
            textNode.value,
            part,
            variableNames,
            actionNames
          );
        }
      }
    }
  }

  private scanProcedureValue(
    node: AstNodeLike,
    variableNames: ReadonlySet<string>,
    actionNames: ReadonlySet<string>
  ): void {
    const procedureNode = node as { statements?: AstNodeLike[] };
    if (!Array.isArray(procedureNode.statements)) return;

    // Only scan Template statements (pipe/plain text) - procedural
    // directives (IfStatement, WithClause, RunStatement, etc.) are code,
    // not LLM-facing text, so they're not subject to template syntax rules.
    for (const statement of procedureNode.statements) {
      if (statement.__kind === 'Template') {
        this.scanTemplateExpression(statement, variableNames, actionNames);
      }
    }
  }

  private scanTextAndAttach(
    text: string,
    node: AstNodeLike,
    variableNames: ReadonlySet<string>,
    actionNames: ReadonlySet<string>
  ): void {
    const sourceText = (node.__cst as CstMeta | undefined)?.node.text ?? text;
    const matches = this.detectPatterns(sourceText, variableNames, actionNames);
    if (matches.length === 0) return;

    const lineStarts = this.computeLineStarts(sourceText);

    for (const match of matches) {
      const range = this.computeRange(
        node,
        lineStarts,
        match.offset,
        match.length
      );
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
    lineStarts: readonly number[],
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

    return {
      start: this.positionAt(
        lineStarts,
        offset,
        cst.range.start.line,
        cst.range.start.character
      ),
      end: this.positionAt(
        lineStarts,
        offset + length,
        cst.range.start.line,
        cst.range.start.character
      ),
    };
  }

  private computeLineStarts(text: string): number[] {
    const lineStarts = [0];
    let newlineIndex = text.indexOf('\n');

    while (newlineIndex !== -1) {
      lineStarts.push(newlineIndex + 1);
      newlineIndex = text.indexOf('\n', newlineIndex + 1);
    }

    return lineStarts;
  }

  private positionAt(
    lineStarts: readonly number[],
    index: number,
    startLine: number,
    startCharacter: number
  ): Range['start'] {
    let low = 0;
    let high = lineStarts.length;

    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (lineStarts[middle] <= index) {
        low = middle;
      } else {
        high = middle;
      }
    }

    return {
      line: startLine + low,
      character: low === 0 ? startCharacter + index : index - lineStarts[low],
    };
  }

  private detectPatterns(
    text: string,
    variableNames: ReadonlySet<string>,
    actionNames: ReadonlySet<string>
  ): PatternMatch[] {
    const matches: PatternMatch[] = [];

    // Data-holding namespaces valid for template interpolation in instruction text
    // @variables: custom/linked variables defined in variables: block
    // @system_variables: predefined read-only system variables
    // @actions: action definitions from actions: block
    const dataNamespaces = ['variables', 'system_variables', 'actions'];

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

    const knownNames: Readonly<
      Record<BareReferenceNamespace, ReadonlySet<string>>
    > = {
      variables: variableNames,
      actions: actionNames,
    };
    const braceSpans = this.findBalancedBraceSpans(text);
    let braceSpanIndex = 0;

    // Scan once for qualified variable/action references, then validate the
    // captured name with constant-time Set membership. Brace membership is
    // handled separately so the regex never rescans an unbounded prefix or
    // suffix for each candidate.
    for (const match of text.matchAll(BARE_REFERENCE_PATTERN)) {
      const leadingBoundary = match[1];
      const reference = match[2];
      const namespace = match[3] as BareReferenceNamespace;
      const name = match[4];
      const offset = match.index! + leadingBoundary.length;

      if (!knownNames[namespace].has(name)) continue;

      while (
        braceSpanIndex < braceSpans.length &&
        braceSpans[braceSpanIndex].end <= offset
      ) {
        braceSpanIndex += 1;
      }
      const braceSpan = braceSpans[braceSpanIndex];
      if (braceSpan && braceSpan.start <= offset && offset < braceSpan.end) {
        continue;
      }

      const namespaceLabel = namespace === 'variables' ? 'Variable' : 'Action';
      matches.push({
        pattern: reference,
        message: `'${reference}' should be wrapped in template syntax — did you mean {!@${namespace}.${name}}? ${namespaceLabel} references require {! ... } for interpolation.`,
        offset,
        length: reference.length,
      });
    }

    return matches;
  }

  /**
   * Find balanced brace spans in one linear pass. Unmatched braces are ignored
   * so a stray brace cannot hide every later or earlier reference.
   */
  private findBalancedBraceSpans(text: string): TextSpan[] {
    const spans: TextSpan[] = [];
    const openBraces: number[] = [];

    for (let index = 0; index < text.length; index += 1) {
      if (text[index] === '{') {
        openBraces.push(index);
      } else if (text[index] === '}' && openBraces.length > 0) {
        const start = openBraces.pop()!;
        // A completed outer span subsumes any completed nested spans. If an
        // unrelated outer brace remains unfinished, the completed inner span
        // stays available to protect its references.
        while (spans.length > 0 && spans[spans.length - 1].start > start) {
          spans.pop();
        }
        spans.push({ start, end: index + 1 });
      }
    }

    // Preserve the existing behavior for an unfinished template wrapper so it
    // does not also receive misleading "should be wrapped" guidance. Generic
    // unmatched prose braces remain ignored.
    const unfinishedTemplateStart = openBraces.find(start => {
      let markerIndex = start + 1;
      while (/\s/.test(text[markerIndex] ?? '')) markerIndex += 1;
      return text[markerIndex] === '!' || text[markerIndex] === '@';
    });
    if (unfinishedTemplateStart !== undefined) {
      while (
        spans.length > 0 &&
        spans[spans.length - 1].start >= unfinishedTemplateStart
      ) {
        spans.pop();
      }
      spans.push({ start: unfinishedTemplateStart, end: text.length });
    }

    return spans;
  }
}

export function instructionTemplateSyntaxPass(): LintPass {
  return new InstructionTemplateSyntaxPass();
}
