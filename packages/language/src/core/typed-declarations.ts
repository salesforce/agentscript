import type { SymbolMeta } from './types.js';
import { AstNodeBase, SymbolKind } from './types.js';
import type { Expression } from './expressions.js';
import { Identifier } from './expressions.js';
import type { BlockChild } from './children.js';
import type { BlockCore } from './named-map.js';

/** Shared base for typed declarations (variables, parameters). */
export abstract class TypedDeclarationBase extends AstNodeBase {
  abstract readonly __kind: string;
  abstract readonly __symbol: SymbolMeta;
  type: Expression;
  defaultValue?: Expression;
  properties?: BlockCore;
  __children: BlockChild[] = [];

  constructor(data: {
    type: Expression;
    defaultValue?: Expression;
    properties?: BlockCore;
  }) {
    super();
    this.type = data.type;
    this.defaultValue = data.defaultValue;
    this.properties = data.properties;
  }
}

/** Variable declaration node with optional modifier (mutable/linked). */
export class VariableDeclarationNode extends TypedDeclarationBase {
  readonly __kind = 'VariableDeclaration' as const;
  readonly __symbol: SymbolMeta = {
    kind: SymbolKind.Variable,
    noRecurse: true,
  };
  modifier?: Identifier;

  constructor(data: {
    type: Expression;
    defaultValue?: Expression;
    modifier?: Identifier;
    properties?: BlockCore;
  }) {
    super(data);
    this.modifier = data.modifier;
  }
}

/** Parameter declaration node (no modifier). */
export class ParameterDeclarationNode extends TypedDeclarationBase {
  readonly __kind = 'ParameterDeclaration' as const;
  readonly __symbol: SymbolMeta = { kind: SymbolKind.Field, noRecurse: true };

  constructor(data: {
    type: Expression;
    defaultValue?: Expression;
    properties?: BlockCore;
  }) {
    super(data);
  }
}
