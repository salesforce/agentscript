export type {
  AstNode,
  AstRoot,
  AstNodeLike,
  Parsed,
  ParseResult,
  Schema,
  ColinearFieldKeys,
  FieldType,
  SingularFieldType,
  SchemaInfo,
  CommentTarget,
  SymbolMeta,
  EmitContext,
  InferFields,
  InferFieldType,
  InferEntryType,
  WildcardPrefix,
} from './types.js';

export {
  SymbolKind,
  withCst,
  createNode,
  AstNodeBase,
  getKeyText,
  emitKeyName,
  emitIndent,
  isKeyNode,
  isNamedMap,
  isCollectionFieldType,
  isNamedCollectionFieldType,
  parseCommentNode,
  parseResult,
  leadingComments,
  trailingComments,
  inlineComments,
  buildKindToSchemaKey,
} from './types.js';

export {
  FieldChild,
  MapEntryChild,
  SequenceItemChild,
  ValueChild,
  StatementChild,
  ErrorBlock,
  UntypedBlock,
  emitChildren,
  isNamedBlockValue,
  isEmittable,
  isBlockChild,
  isSingularBlock,
  extractChildren,
  defineFieldAccessors,
} from './children.js';
export type { Emittable, BlockChild } from './children.js';

export {
  createDiagnostic,
  attachDiagnostic,
  undefinedReferenceDiagnostic,
} from './diagnostics.js';

export {
  StringValue,
  NumberValue,
  BooleanValue,
  ProcedureValue,
  ExpressionValue,
  ReferenceValue,
  union,
} from './primitives.js';

export { Sequence, SequenceNode } from './sequence.js';

export { NamedMap, collectionLabel } from './named-map.js';
export type { BlockCore } from './named-map.js';
export {
  TypedDeclarationBase,
  VariableDeclarationNode,
  ParameterDeclarationNode,
} from './typed-declarations.js';
export { Block } from './block-factory.js';
export { NamedBlock } from './named-block-factory.js';
export {
  CollectionBlock,
  NamedCollectionBlock,
} from './collection-block-factory.js';
export { TypedMap } from './typed-map-factory.js';

export type {
  BlockClass,
  BlockFactory,
  BlockFactoryOptions,
  BlockInstance,
  NamedBlockInstance,
  NamedBlockClass,
  NamedBlockFactory,
  NamedBlockOpts,
  CollectionBlockFactory,
  CollectionBlockInstance,
  CollectionBlockOpts,
  NamedCollectionBlockFactory,
  TypedMapFactory,
  TypedMapOptions,
  FactoryBuilderMethods,
} from './factory-types.js';
export type { BlockCapability } from './types.js';

export type {
  Expression,
  ExpressionKind,
  BinaryOperator,
  UnaryOperator,
  ComparisonOperator,
  TemplatePart,
  TemplatePartKind,
} from './expressions.js';

export {
  StringLiteral,
  TemplateExpression,
  TemplateText,
  TemplateInterpolation,
  NumberLiteral,
  BooleanLiteral,
  NoneLiteral,
  Identifier,
  AtIdentifier,
  MemberExpression,
  SubscriptExpression,
  BinaryExpression,
  UnaryExpression,
  ComparisonExpression,
  ListLiteral,
  DictLiteral,
  Ellipsis,
  TEMPLATE_PART_KINDS,
  isTemplatePartKind,
  parseTemplateParts,
  decomposeAtMemberExpression,
  decomposeMemberExpression,
} from './expressions.js';

export type { Statement } from './statements.js';

export {
  Template,
  WithClause,
  SetClause,
  ToClause,
  AvailableWhen,
  TransitionStatement,
  RunStatement,
  IfStatement,
  UnknownStatement,
} from './statements.js';

export {
  isTemplateText,
  isTemplateInterpolation,
  isMemberExpression,
  isIdentifier,
  isStringLiteral,
  isSubscriptExpression,
  isAtIdentifier,
  isIfStatement,
  isTransitionStatement,
  isToClause,
  isSetClause,
  isWithClause,
} from './guards.js';

export { Dialect } from './dialect.js';

export {
  ESCAPE_TABLE,
  interpretEscape,
  escapeStringValue,
} from './string-escapes.js';

export { FieldBuilder, addBuilderMethods } from './field-builder.js';
export type { FieldMetadata, BuilderMethods } from './field-builder.js';
export type { DocumentationMetadata, KeywordInfo } from './types.js';
export { keywordNames } from './types.js';
