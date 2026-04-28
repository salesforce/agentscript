/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type {
  FieldType,
  SyntaxNode,
  ParseResult,
  Parsed,
  CommentTarget,
  Comment,
  KeywordInfo,
} from './types.js';
import {
  withCst,
  getKeyText,
  isKeyNode,
  parseResult,
  isSingularFieldType,
  keywordNames,
  parseCommentNode as sharedParseCommentNode,
} from './types.js';
import type { Dialect } from './dialect.js';
import {
  createDiagnostic,
  DiagnosticSeverity,
  DiagnosticCollector,
} from './diagnostics.js';
import { ErrorValue, Identifier, SubscriptExpression } from './expressions.js';
import { FieldChild, ErrorBlock } from './children.js';
import {
  detectSameRowSplit,
  detectInlineErrorSuffix,
  captureErrorPrefix,
  mergeProperties,
} from './error-recovery.js';
import { findSuggestion } from '../lint/lint-utils.js';
import { NamedMap } from './named-map.js';
import {
  TypedDeclarationBase,
  VariableDeclarationNode,
  ParameterDeclarationNode,
} from './typed-declarations.js';
import type { TypedMapOptions } from './factory-types.js';

// ---------------------------------------------------------------------------
// Types for the parser
// ---------------------------------------------------------------------------

interface ErrorRecoveryResult {
  declType:
    | Identifier
    | SubscriptExpression
    | ErrorValue
    | ReturnType<Dialect['parseVariableDeclaration']>['type'];
  errorPrefix: string | undefined;
  errorPrefixNode: SyntaxNode | undefined;
  mergedElement: SyntaxNode | undefined;
  mergedKeyRemainder: string | undefined;
}

// ---------------------------------------------------------------------------
// TypedMapElement — per-element state extracted from a mapping_element CST node
// ---------------------------------------------------------------------------

class TypedMapElement {
  readonly node: SyntaxNode;
  readonly name: string;
  readonly index: number;
  readonly keyNode: SyntaxNode | null;
  readonly keyChildren: SyntaxNode[];
  readonly leadingComments: Comment[];
  readonly inlineComments: Comment[];

  constructor(node: SyntaxNode, leadingComments: Comment[], index: number) {
    this.node = node;
    this.index = index;
    this.leadingComments = leadingComments;
    const keyNode = node.childForFieldName('key');
    this.keyNode = keyNode;
    this.keyChildren = keyNode?.namedChildren.filter(isKeyNode) ?? [];
    this.name = this.keyChildren[0] ? getKeyText(this.keyChildren[0]) : '';
    this.inlineComments = node.namedChildren
      .filter((c: SyntaxNode) => c.type === 'comment')
      .map((c: SyntaxNode) => sharedParseCommentNode(c, 'inline'));
  }

  get isQuotedKey(): boolean {
    return this.keyChildren[0]?.type === 'string';
  }

  get isCompositeKey(): boolean {
    return this.keyChildren.length > 1;
  }

  get isEmptyKey(): boolean {
    return !this.name && this.keyChildren.length > 0;
  }

  get diagnosticRange(): SyntaxNode {
    return this.keyNode ?? this.node;
  }

  getColinearNode(): SyntaxNode | null {
    return (
      this.node.childForFieldName('colinear_value') ??
      this.node.childForFieldName('expression')
    );
  }

  hasErrors(): boolean {
    return this.node.children.some((c: SyntaxNode) => c.type === 'ERROR');
  }

  getAttachedComments(): Comment[] {
    return [
      ...this.leadingComments.map(c => ({
        ...c,
        attachment: 'leading' as const,
      })),
      ...this.inlineComments.map(c => ({
        ...c,
        attachment: 'inline' as const,
      })),
    ];
  }

  getRawValueText(): string {
    const text = this.node.text;
    const colonIdx = text.indexOf(':');
    return colonIdx >= 0 ? text.substring(colonIdx + 1).trimStart() : '';
  }

  getBlockNode(): SyntaxNode | null {
    return (
      this.node.childForFieldName('block_value') ??
      this.node.namedChildren.find((c: SyntaxNode) => c.type === 'mapping') ??
      null
    );
  }
}

/** Method Object that encapsulates the TypedMap parse() logic. */
export class TypedMapParser<T extends TypedDeclarationBase> {
  private readonly dc = new DiagnosticCollector();
  private readonly mergedElementIndices = new Set<number>();
  private elementNodes: SyntaxNode[] = [];
  private readonly declarations: NamedMap<T>;
  private readonly blockLabel: string;
  private readonly hasModifier: boolean;
  private readonly modifiers: readonly KeywordInfo[];
  private readonly primitiveTypes: readonly KeywordInfo[];
  private readonly propertiesBlock: FieldType;
  private readonly dialect: Dialect;
  private readonly options: TypedMapOptions;
  private readonly reservedNames: string[];

  constructor(
    declarations: NamedMap<T>,
    blockLabel: string,
    hasModifier: boolean,
    modifiers: readonly KeywordInfo[],
    primitiveTypes: readonly KeywordInfo[],
    propertiesBlock: FieldType,
    dialect: Dialect,
    options: TypedMapOptions
  ) {
    this.declarations = declarations;
    this.blockLabel = blockLabel;
    this.hasModifier = hasModifier;
    this.modifiers = modifiers;
    this.primitiveTypes = primitiveTypes;
    this.propertiesBlock = propertiesBlock;
    this.dialect = dialect;
    this.options = options;
    this.reservedNames = [
      ...keywordNames(primitiveTypes),
      ...keywordNames(modifiers),
      'list',
    ];
  }

  /** Walk all mapping elements and return the populated NamedMap. */
  run(node: SyntaxNode): ParseResult<NamedMap<T>> {
    const { elements, trailingComments } = this.collectElements(node);
    this.elementNodes = elements.map(el => el.node);
    let lastParsed: CommentTarget | undefined;

    for (const element of elements) {
      lastParsed = this.processElement(element) ?? lastParsed;
    }

    if (trailingComments.length > 0 && lastParsed) {
      const asTrailing = trailingComments.map(c => ({
        ...c,
        attachment: 'trailing' as const,
      }));
      lastParsed.__comments = [...(lastParsed.__comments ?? []), ...asTrailing];
    }

    this.declarations.__diagnostics = this.dc.own;
    const parsed = withCst(this.declarations, node) as Parsed<NamedMap<T>>;
    return parseResult(parsed, this.dc.all);
  }

  /** Dispatch a single mapping element to the appropriate handler. */
  private processElement(element: TypedMapElement): CommentTarget | undefined {
    if (this.mergedElementIndices.has(element.index)) return undefined;

    this.validateKey(element);

    const colinearNode = element.getColinearNode();
    if (colinearNode) {
      return this.processColinearElement(element, colinearNode);
    }

    if (element.name && element.hasErrors()) {
      return this.processErrorElement(element);
    }

    if (element.name) {
      this.processMissingTypeElement(element);
    }

    return undefined;
  }

  /**
   * Process an element that has a value after the colon.
   *
   * @example
   * ```
   * mutable customer_name: string = "Jane"
   * age: number
   * linked account_id: string
   * ```
   */
  private processColinearElement(
    element: TypedMapElement,
    colinearNode: SyntaxNode
  ): Parsed<TypedDeclarationBase> {
    const fieldSpec = this.dialect.parseVariableDeclaration(colinearNode);

    this.validateReservedName(element);

    const errorResolution = this.resolveErrorRecovery(
      element,
      colinearNode,
      fieldSpec.type
    );

    this.validateModifier(element, fieldSpec, colinearNode);

    // Type validation
    if (this.primitiveTypes.length > 0) {
      this.validateType(element, errorResolution.declType, colinearNode);
    }

    // Build declaration
    const decl =
      this.hasModifier && fieldSpec.modifier
        ? new VariableDeclarationNode({
            type: errorResolution.declType,
            defaultValue: fieldSpec.defaultValue,
            modifier: fieldSpec.modifier,
          })
        : new ParameterDeclarationNode({
            type: errorResolution.declType,
            defaultValue: fieldSpec.defaultValue,
          });

    const declaration = withCst(decl, element.node);
    const comments = element.getAttachedComments();
    if (comments.length > 0) {
      declaration.__comments = comments;
    }

    // Attach properties
    if (errorResolution.mergedElement) {
      mergeProperties(
        declaration,
        element.node,
        errorResolution.mergedElement,
        errorResolution.mergedKeyRemainder,
        this.propertiesBlock,
        this.dialect,
        this.dc
      );
    } else {
      const blockNode = element.getBlockNode();
      if (blockNode && isSingularFieldType(this.propertiesBlock)) {
        const propResult = this.propertiesBlock.parse(blockNode, this.dialect);
        if (propResult.value && typeof propResult.value === 'object') {
          declaration.properties = propResult.value;
          declaration.__children.push(
            new FieldChild('properties', propResult.value, this.propertiesBlock)
          );
        }
        this.dc.merge(propResult);
      }
    }

    // Error block for round-trip preservation
    if (errorResolution.errorPrefix) {
      const errorBlock = new ErrorBlock(
        errorResolution.errorPrefix,
        colinearNode.startCol
      );
      declaration.__children.unshift(errorBlock);

      if (this.hasModifier) {
        this.emitInvalidModifierDiagnostic(
          errorResolution.errorPrefix,
          element,
          errorResolution.errorPrefixNode ?? colinearNode
        );
      }
    }

    this.validateDuplicateName(element);

    this.declarations.set(element.name, declaration as Parsed<T>);
    return declaration;
  }

  /**
   * Emit a diagnostic for an element with a name but nothing after the colon.
   *
   * @example
   * ```
   * customer_name:
   * ```
   */
  private processMissingTypeElement(element: TypedMapElement): void {
    const typeNames = keywordNames(this.primitiveTypes);
    const hint =
      typeNames.length > 0
        ? `Expected a type after ':' (${typeNames.slice(0, 5).join(', ')}, ...)`
        : `Expected a type after ':'`;
    this.dc.add(
      createDiagnostic(
        element.node,
        `Missing type for ${this.blockLabel} '${element.name}'. ${hint}`,
        DiagnosticSeverity.Error,
        'missing-type',
        { expected: typeNames }
      )
    );
  }

  /**
   * Handle an element whose CST contains ERROR nodes but no colinear value.
   * Preserves the raw text so the round-trip emitter can reproduce it.
   *
   * @example
   * ```
   * name: stri
   * ```
   */
  private processErrorElement(
    element: TypedMapElement
  ): CommentTarget | undefined {
    const rawValueText = element.getRawValueText();
    if (!rawValueText) return undefined;

    const errorType = withCst(new ErrorValue(rawValueText), element.node);
    const decl = this.hasModifier
      ? new VariableDeclarationNode({ type: errorType })
      : new ParameterDeclarationNode({ type: errorType });
    const declaration = withCst(decl, element.node);

    const comments = element.getAttachedComments();
    if (comments.length > 0) {
      declaration.__comments = comments;
    }

    this.validateDuplicateName(element);

    this.declarations.set(element.name, declaration as Parsed<T>);
    return declaration;
  }

  /** Walk CST children, grouping comments with their following mapping element. */
  private collectElements(node: SyntaxNode): {
    elements: TypedMapElement[];
    trailingComments: Comment[];
  } {
    const elements: TypedMapElement[] = [];
    let pendingComments: Comment[] = [];

    for (const child of node.namedChildren) {
      if (child.type === 'comment') {
        pendingComments.push(sharedParseCommentNode(child, 'leading'));
        continue;
      }
      if (child.type === 'mapping_element') {
        elements.push(
          new TypedMapElement(child, pendingComments, elements.length)
        );
        pendingComments = [];
        continue;
      }
      pendingComments = [];
    }

    return { elements, trailingComments: pendingComments };
  }

  /** Validate the element's key: composite keys, empty names, and key patterns. */
  private validateKey(element: TypedMapElement): void {
    /* e.g. `first.last: string` — multiple key segments */
    if (element.isCompositeKey) {
      const range = element.diagnosticRange;
      this.dc.add(
        createDiagnostic(
          range,
          `Composite key '${range.text?.replace(/:$/, '') ?? element.name}' is not allowed; expected a single name`,
          DiagnosticSeverity.Error,
          'composite-key'
        )
      );
    }

    /* e.g. `"": string` — key resolves to an empty string */
    if (element.isEmptyKey) {
      this.dc.add(
        createDiagnostic(
          element.diagnosticRange,
          'Empty field name is not allowed',
          DiagnosticSeverity.Error,
          'empty-field-name'
        )
      );
    }

    /* e.g. `123abc: string` — doesn't match /^[a-zA-Z][a-zA-Z0-9_]*$/ */
    if (element.name && this.options.keyPattern) {
      try {
        if (!new RegExp(this.options.keyPattern).test(element.name)) {
          this.dc.add(
            createDiagnostic(
              element.keyChildren[0] ?? element.diagnosticRange,
              `'${element.name}' does not match required pattern /${this.options.keyPattern}/`,
              DiagnosticSeverity.Error,
              'invalid-key-pattern'
            )
          );
        }
      } catch {
        // Invalid pattern - skip validation
      }
    }
  }

  /** Emit a diagnostic if the element's key is an unquoted reserved keyword. */
  private validateReservedName(element: TypedMapElement): void {
    if (!element.name || element.isQuotedKey) return;
    if (!this.reservedNames.includes(element.name)) return;
    this.dc.add(
      createDiagnostic(
        element.keyChildren[0],
        `'${element.name}' is a reserved keyword and cannot be used as a variable name. Reserved: ${this.reservedNames.join(', ')}`,
        DiagnosticSeverity.Error,
        'reserved-name',
        { found: element.name, expected: this.reservedNames }
      )
    );
  }

  /** Emit a diagnostic if the modifier keyword is not in the allowed list. */
  private validateModifier(
    element: TypedMapElement,
    fieldSpec: ReturnType<Dialect['parseVariableDeclaration']>,
    colinearNode: SyntaxNode
  ): void {
    if (!this.hasModifier || !fieldSpec.modifier) return;
    this.emitInvalidModifierDiagnostic(
      fieldSpec.modifier.name,
      element,
      colinearNode
    );
  }

  /** Emit an invalid-modifier diagnostic if modifierText is not in the allowed list. */
  private emitInvalidModifierDiagnostic(
    modifierText: string,
    element: TypedMapElement,
    rangeNode: SyntaxNode
  ): void {
    const modifierNames = keywordNames(this.modifiers);
    if (modifierNames.includes(modifierText)) return;
    const suggestion = findSuggestion(modifierText, modifierNames);
    const hint = suggestion
      ? `Did you mean '${suggestion}'?`
      : `Valid modifiers: ${modifierNames.join(', ')}`;
    this.dc.add(
      createDiagnostic(
        rangeNode,
        `Unknown modifier '${modifierText}' for ${this.blockLabel} ${element.name}. ${hint}`,
        DiagnosticSeverity.Error,
        'invalid-modifier',
        { found: modifierText, expected: modifierNames }
      )
    );
  }

  /** Emit a diagnostic if the element's name is already defined in the map. */
  private validateDuplicateName(element: TypedMapElement): void {
    if (!element.name || !this.declarations.has(element.name)) return;
    this.dc.add(
      createDiagnostic(
        element.diagnosticRange,
        `'${element.name}' is already defined in ${this.blockLabel}`,
        DiagnosticSeverity.Error,
        'duplicate-name'
      )
    );
  }

  /** Orchestrate error recovery: captured prefix, inner errors, same-row split, inline suffix. */
  private resolveErrorRecovery(
    element: TypedMapElement,
    colinearNode: SyntaxNode,
    rawDeclType: ReturnType<Dialect['parseVariableDeclaration']>['type']
  ): ErrorRecoveryResult {
    let declType = rawDeclType;
    let errorPrefix: string | undefined;
    let errorPrefixNode: SyntaxNode | undefined;
    let mergedElement: SyntaxNode | undefined;
    let mergedKeyRemainder: string | undefined;

    const captured = captureErrorPrefix(element.node, colinearNode);

    /* e.g. `mutable mutble name: string` — ERROR nodes inside the declaration itself */
    let innerErrorPrefix: string | undefined;
    if (colinearNode.type === 'variable_declaration') {
      const innerParts: string[] = [];
      for (const child of colinearNode.children) {
        if (child.type === 'ERROR') {
          const text = child.text?.trim();
          if (text) innerParts.push(text);
        }
      }
      if (innerParts.length > 0) {
        innerErrorPrefix = innerParts.join(' ');
      }
    }

    const split = detectSameRowSplit(
      this.elementNodes,
      element.index,
      colinearNode,
      rawDeclType
    );
    /* e.g. `name: mutble string` parsed as two elements on the same row — merge them back */
    if (split) {
      errorPrefix = captured
        ? `${captured.text}${split.errorPrefix}`
        : split.errorPrefix;
      if (captured) errorPrefixNode = captured.errorNode;
      declType = split.declType;
      mergedElement = split.mergedElement;
      mergedKeyRemainder = split.mergedKeyRemainder;
      this.mergedElementIndices.add(element.index + 1);
    } else {
      const suffix = detectInlineErrorSuffix(
        element.node,
        colinearNode,
        rawDeclType
      );
      /* e.g. `name: xyz string` — unrecognized text between colon and type on the same line */
      if (suffix) {
        errorPrefix = captured
          ? `${captured.text}${suffix.errorPrefix}`
          : suffix.errorPrefix;
        errorPrefixNode = suffix.errorNode;
        declType = suffix.declType;
      } else if (captured) {
        errorPrefix = captured.text;
        errorPrefixNode = captured.errorNode;
      }
    }

    /* e.g. `name: mutble lnked string` — prefix `mutble` + inner `lnked` → `mutble lnked` */
    if (innerErrorPrefix) {
      errorPrefix = errorPrefix
        ? `${errorPrefix} ${innerErrorPrefix}`
        : innerErrorPrefix;
    }

    return {
      declType,
      errorPrefix,
      errorPrefixNode,
      mergedElement,
      mergedKeyRemainder,
    };
  }

  /** Validate the declared type against allowed primitive types. */
  private validateType(
    element: TypedMapElement,
    declType: ErrorRecoveryResult['declType'],
    colinearNode: SyntaxNode
  ): void {
    if (declType instanceof Identifier) {
      const typeName = declType.name;
      const typeNames = keywordNames(this.primitiveTypes);
      if (!typeNames.includes(typeName)) {
        const suggestion = findSuggestion(typeName, typeNames);
        const hint = suggestion
          ? `Did you mean '${suggestion}'?`
          : `Valid types: ${typeNames.join(', ')}`;
        this.dc.add(
          createDiagnostic(
            declType.__cst ? declType.__cst.range : colinearNode,
            `Unknown type '${typeName}' for ${this.blockLabel} ${element.name}. ${hint}`,
            DiagnosticSeverity.Error,
            'unknown-type',
            { found: typeName, expected: typeNames }
          )
        );
      }
    } else if (declType instanceof SubscriptExpression) {
      this.validateSubscriptType(element, declType);
    }
  }

  private validateSubscriptType(
    element: TypedMapElement,
    declType: SubscriptExpression
  ): void {
    const obj = declType.object;
    const idx = declType.index;

    if (!(obj instanceof Identifier) || obj.name !== 'list') {
      const typeName =
        obj instanceof Identifier ? obj.name : obj.__emit({ indent: 0 });
      this.dc.add(
        createDiagnostic(
          obj as Parsed<object>,
          `'${typeName}' does not support type parameters. Only 'list' supports type parameters (e.g., list[string]).`,
          DiagnosticSeverity.Error,
          'invalid-type-parameter',
          { found: typeName }
        )
      );
    } else if (idx instanceof SubscriptExpression) {
      this.dc.add(
        createDiagnostic(
          idx as Parsed<object>,
          `Nested list types are not supported (e.g., list[list[string]]). Use a flat list type like list[string].`,
          DiagnosticSeverity.Error,
          'nested-list-type'
        )
      );
    } else if (idx instanceof Identifier) {
      const elemType = idx.name;
      const elemTypeNames = keywordNames(this.primitiveTypes);
      if (!elemTypeNames.includes(elemType)) {
        const suggestion = findSuggestion(elemType, elemTypeNames);
        const hint = suggestion
          ? `Did you mean '${suggestion}'?`
          : `Valid element types: ${elemTypeNames.join(', ')}`;
        this.dc.add(
          createDiagnostic(
            idx as Parsed<object>,
            `Unknown list element type '${elemType}' for ${this.blockLabel} ${element.name}. ${hint}`,
            DiagnosticSeverity.Error,
            'unknown-type',
            { found: elemType, expected: elemTypeNames }
          )
        );
      }
    }
  }
}
