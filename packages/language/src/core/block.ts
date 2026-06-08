/**
 * Barrel re-export — all block-related APIs live in dedicated modules now.
 * This file exists so that existing `from './block.js'` imports continue to work.
 */

// --- Named map & core types ---
export { BlockBase, NamedMap, collectionLabel } from './named-map.js';
export type { BlockCore } from './named-map.js';

// --- Typed declarations ---
export {
  TypedDeclarationBase,
  VariableDeclarationNode,
  ParameterDeclarationNode,
} from './typed-declarations.js';

// --- Factory functions ---
export { Block } from './block-factory.js';
export { NamedBlock } from './named-block-factory.js';
export {
  CollectionBlock,
  NamedCollectionBlock,
} from './collection-block-factory.js';
export { TypedMap } from './typed-map-factory.js';

// --- Factory types & interfaces ---
export type {
  BlockInstance,
  NamedBlockInstance,
  CollectionBlockInstance,
  BlockClass,
  NamedBlockClass,
  TypedMapClass,
  BlockFactoryOptions,
  NamedBlockOpts,
  CollectionBlockOpts,
  TypedMapOptions,
  FactoryBuilderMethods,
  BlockFactory,
  NamedBlockFactory,
  CollectionBlockFactory,
  NamedCollectionBlockFactory,
  TypedMapFactory,
  _BlockCheck,
  _TypedMapCheck,
  _CollectionCheck,
} from './factory-types.js';

// --- Re-export children types so existing consumers don't need to update imports ---
export {
  FieldChild,
  MapEntryChild,
  MapIndex,
  SequenceItemChild,
  ValueChild,
  StatementChild,
  ErrorBlock,
  emitChildren,
  isNamedBlockValue,
  defineFieldAccessors,
  initChildren,
  extractChildren,
  attachElementText,
} from './children.js';
export type { Emittable, BlockChild } from './children.js';

// Re-export so existing consumers don't need to update imports.
export type { BlockCapability } from './types.js';
