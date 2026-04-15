/**
 * Variable validation rules for Agentforce.
 *
 * Validates:
 * - Variable name constraints (no leading/trailing underscores, no consecutive underscores except __c suffix)
 * - Source property usage (mutable cannot have source, linked must have source)
 * - Linked variable type constraints (cannot be list, object, or have defaults)
 *
 * Diagnostics: invalid-variable-name, mutable-variable-cannot-have-source,
 *              linked-variable-missing-source, linked-variable-cannot-be-list,
 *              linked-variable-cannot-be-object, linked-variable-cannot-have-default
 */

import type { AstNodeLike, NamedMap } from '@agentscript/language';
import type { LintPass } from '@agentscript/language';
import {
  storeKey,
  attachDiagnostic,
  lintDiagnostic,
  isNamedMap,
} from '@agentscript/language';
import { typeMapKey } from '@agentscript/agentscript-dialect';
import type { PassStore } from '@agentscript/language';
import type { AstRoot } from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import { getBlockRange as getDeclRange } from '../utils.js';

class VariableValidationPass implements LintPass {
  readonly id = storeKey('variable-validation');
  readonly description =
    'Validates variable names and linked variable constraints';
  readonly requires = [typeMapKey];

  run(store: PassStore, root: AstRoot): void {
    const typeMap = store.get(typeMapKey);
    if (!typeMap) return;

    const varsMap = (root as Record<string, unknown>).variables;
    if (!varsMap || !isNamedMap(varsMap)) return;

    for (const [name, decl] of varsMap as NamedMap<unknown>) {
      if (!decl || typeof decl !== 'object') continue;
      const node = decl as AstNodeLike;
      const range = getDeclRange(node);
      const properties = node.properties as Record<string, unknown> | undefined;

      // --- Variable name validation ---
      this.validateName(name, node, range);

      // --- Get variable info from typeMap ---
      const info = typeMap.variables.get(name);

      // --- Source property validation ---
      this.validateSourceProperty(
        name,
        node,
        range,
        info?.modifier,
        properties
      );

      // --- Linked variable constraints ---
      if (info?.modifier === 'linked') {
        this.validateLinkedVariable(name, node, range, info.type);
      }
    }
  }

  private validateName(
    name: string,
    node: AstNodeLike,
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    }
  ): void {
    if (name.startsWith('_')) {
      attachDiagnostic(
        node,
        lintDiagnostic(
          range,
          `Variable name '${name}' cannot start with an underscore.`,
          DiagnosticSeverity.Error,
          'invalid-variable-name'
        )
      );
    }

    const endsWith__c = name.endsWith('__c');

    if (name.endsWith('_') && !endsWith__c) {
      attachDiagnostic(
        node,
        lintDiagnostic(
          range,
          `Variable name '${name}' cannot end with an underscore (except __c suffix).`,
          DiagnosticSeverity.Error,
          'invalid-variable-name'
        )
      );
    }

    // Check for consecutive underscores
    if (name.includes('__')) {
      if (!endsWith__c) {
        // Name has __ but doesn't end with __c
        attachDiagnostic(
          node,
          lintDiagnostic(
            range,
            `Variable name '${name}' cannot contain consecutive underscores (except __c suffix).`,
            DiagnosticSeverity.Error,
            'invalid-variable-name'
          )
        );
      } else if (name.slice(0, -3).includes('__')) {
        // Name ends with __c but has __ elsewhere (e.g., "Account__Number__c")
        attachDiagnostic(
          node,
          lintDiagnostic(
            range,
            `Variable name '${name}' cannot contain consecutive underscores (except __c suffix).`,
            DiagnosticSeverity.Error,
            'invalid-variable-name'
          )
        );
      }
    }
  }

  private validateSourceProperty(
    name: string,
    node: AstNodeLike,
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    },
    modifier: string | undefined,
    properties: Record<string, unknown> | undefined
  ): void {
    const hasSource = properties?.['source'] != null;

    if (modifier === 'mutable' && hasSource) {
      attachDiagnostic(
        node,
        lintDiagnostic(
          range,
          `Mutable variable '${name}' cannot have a source property. Only linked variables can have a source.`,
          DiagnosticSeverity.Error,
          'mutable-variable-cannot-have-source'
        )
      );
    }

    if (modifier === 'linked' && !hasSource) {
      attachDiagnostic(
        node,
        lintDiagnostic(
          range,
          `Linked variable '${name}' must have a source property (e.g., source: @MessagingSession.Id).`,
          DiagnosticSeverity.Error,
          'linked-variable-missing-source'
        )
      );
    }
  }

  private validateLinkedVariable(
    name: string,
    node: AstNodeLike,
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    },
    typeText: string
  ): void {
    // Cannot be a list type
    if (typeText.startsWith('list[') || typeText.startsWith('list(')) {
      attachDiagnostic(
        node,
        lintDiagnostic(
          range,
          `Context variable '${name}' cannot be a list.`,
          DiagnosticSeverity.Error,
          'linked-variable-cannot-be-list'
        )
      );
    }

    // Cannot be an object type
    if (typeText === 'object') {
      attachDiagnostic(
        node,
        lintDiagnostic(
          range,
          `Context variable '${name}' cannot be an object.`,
          DiagnosticSeverity.Error,
          'linked-variable-cannot-be-object'
        )
      );
    }

    // Cannot have a default value
    const obj = node as Record<string, unknown>;
    if (obj.defaultValue != null) {
      attachDiagnostic(
        node,
        lintDiagnostic(
          range,
          `Context variable '${name}' cannot have a default value.`,
          DiagnosticSeverity.Error,
          'linked-variable-cannot-have-default'
        )
      );
    }
  }
}

export function variableValidationRule(): LintPass {
  return new VariableValidationPass();
}
