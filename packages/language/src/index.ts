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
} from './core/index.js';

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
} from './core/index.js';

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
} from './core/children.js';
export type { Emittable, BlockChild } from './core/children.js';

export {
  DiagnosticSeverity,
  DiagnosticTag,
  createDiagnostic,
  attachDiagnostic,
  undefinedReferenceDiagnostic,
  typeMismatchDiagnostic,
} from './core/diagnostics.js';
export type { Diagnostic } from './core/diagnostics.js';

export type { TStringValue } from './core/primitives.js';

export {
  StringValue,
  NumberValue,
  BooleanValue,
  ProcedureValue,
  ExpressionValue,
  ReferenceValue,
  union,
} from './core/primitives.js';

export { Sequence, ExpressionSequence, SequenceNode } from './core/sequence.js';

export {
  Block,
  NamedBlock,
  TypedMap,
  CollectionBlock,
  NamedCollectionBlock,
  NamedMap,
  TypedDeclarationBase,
  VariableDeclarationNode,
  ParameterDeclarationNode,
  collectionLabel,
} from './core/block.js';

export type {
  BlockCore,
  BlockClass,
  BlockCapability,
  BlockFactory,
  BlockInstance,
  NamedBlockInstance,
  CollectionBlockFactory,
  CollectionBlockInstance,
  NamedCollectionBlockFactory,
  NamedBlockClass,
  NamedBlockFactory,
  TypedMapFactory,
  FactoryBuilderMethods,
  BlockFactoryOptions,
  NamedBlockOpts,
} from './core/block.js';

export type {
  Expression,
  ExpressionKind,
  BinaryOperator,
  UnaryOperator,
  ComparisonOperator,
  TemplatePart,
  TemplatePartKind,
} from './core/expressions.js';

export {
  StringLiteral,
  TemplateExpression,
  TemplateText,
  TemplateInterpolation,
  NumberLiteral,
  BooleanLiteral,
  NoneLiteral,
  ErrorValue,
  Identifier,
  AtIdentifier,
  MemberExpression,
  SubscriptExpression,
  BinaryExpression,
  UnaryExpression,
  ComparisonExpression,
  TernaryExpression,
  CallExpression,
  ListLiteral,
  DictLiteral,
  Ellipsis,
  SpreadExpression,
  TEMPLATE_PART_KINDS,
  isTemplatePartKind,
  parseTemplateParts,
  decomposeAtMemberExpression,
  decomposeMemberExpression,
} from './core/expressions.js';

export type { Statement } from './core/statements.js';

export {
  Template,
  WithClause,
  SetClause,
  ToClause,
  AvailableWhen,
  RunStatement,
  IfStatement,
  TransitionStatement,
  UnknownStatement,
} from './core/statements.js';

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
} from './core/guards.js';

export { Dialect } from './core/dialect.js';
export { emitDocument } from './core/emit.js';

export {
  ESCAPE_TABLE,
  interpretEscape,
  escapeStringValue,
} from './core/string-escapes.js';

export { FieldBuilder, addBuilderMethods } from './core/field-builder.js';
export type {
  FieldMetadata,
  ConstraintMetadata,
  ConstraintCategory,
  ConstrainedBuilder,
  InferFieldValue,
  ResolveConstraints,
  BuilderMethods,
  NumberConstraintMethods,
  StringConstraintMethods,
  GenericConstraintMethods,
  SequenceConstraintMethods,
} from './core/field-builder.js';
export type { DocumentationMetadata, KeywordInfo } from './core/types.js';
export { keywordNames } from './core/types.js';

export {
  VariablePropertiesBlock,
  InputPropertiesBlock,
  OutputPropertiesBlock,
  VariablesBlock,
  InputsBlock,
  OutputsBlock,
  ActionBlock,
  ActionsBlock,
  ReasoningActionBlock,
  ReasoningActionsBlock,
  VARIABLE_MODIFIERS,
  AGENTSCRIPT_PRIMITIVE_TYPES,
} from './blocks.js';

export type { VariableModifier, AgentScriptPrimitiveType } from './blocks.js';

export {
  createSchemaContext,
  getSchemaNamespaces,
  getGlobalScopes,
  resolveNamespaceKeys,
} from './core/analysis/scope.js';

export type { ScopeContext, SchemaContext } from './core/analysis/scope.js';

export {
  getDocumentSymbols,
  getSymbolMembers,
} from './core/analysis/symbols.js';

export type { DocumentSymbol } from './core/analysis/symbols.js';

export {
  findDefinitionAtPosition,
  findReferencesAtPosition,
  resolveReference,
  findAllReferences,
  walkDefinitionKeys,
} from './core/analysis/references.js';

export type {
  ResolvedReference,
  ReferenceOccurrence,
  DefinitionResult,
} from './core/analysis/references.js';

export {
  getCompletionCandidates,
  getAvailableNamespaces,
  findEnclosingScope,
  getFieldCompletions,
  getValueCompletions,
} from './core/analysis/completions.js';

export type { CompletionCandidate } from './core/analysis/completions.js';

export { generateFieldSnippet } from './core/analysis/snippet-gen.js';

export {
  resolveSchemaField,
  formatConstraints,
  formatSchemaHoverMarkdown,
  formatKeywordHoverMarkdown,
  findKeywordInfo,
} from './core/analysis/schema-hover.js';

export type {
  SchemaFieldInfo,
  ResolvedSchemaField,
} from './core/analysis/schema-hover.js';

export { resolveHover } from './core/analysis/hover-resolver.js';

export type {
  NodeAccessor,
  HoverRange,
  SchemaFieldHover,
  KeywordHover,
  HoverResult,
} from './core/analysis/hover-resolver.js';

export {
  LintEngine,
  PassStore,
  DependencyResolutionError,
  storeKey,
  each,
  defineRule,
  schemaContextKey,
} from './core/analysis/lint.js';

export type {
  LintPass,
  StoreKey,
  EachDep,
  Dep,
  ResolveDeps,
} from './core/analysis/lint.js';

export {
  positionIndexKey,
  queryExpressionAtPosition,
  queryDefinitionAtPosition,
  queryScopeAtPosition,
} from './core/analysis/position-index.js';

export type { PositionIndex } from './core/analysis/position-index.js';

export {
  collectDiagnostics,
  recurseAstChildren,
  walkAstExpressions,
  dispatchAstChildren,
  forEachExpressionChild,
} from './core/analysis/ast-walkers.js';

export { symbolTableAnalyzer, symbolTableKey } from './lint/symbol-table.js';
export { undefinedReferencePass } from './lint/undefined-reference.js';
export { duplicateKeyPass } from './lint/duplicate-keys.js';
export { requiredFieldPass } from './lint/required-fields.js';
export { singularCollectionPass } from './lint/singular-collection.js';
export {
  constraintValidationPass,
  constraintValidationKey,
} from './lint/constraint-validation.js';
export { positionIndexPass } from './lint/position-index.js';
export { unreachableCodePass } from './lint/unreachable-code.js';
export { emptyBlockPass } from './lint/empty-block.js';
export { spreadContextPass } from './lint/spread-context.js';
export { unusedVariablePass } from './lint/unused-variable.js';
export {
  expressionValidationPass,
  BUILTIN_FUNCTIONS,
} from './lint/expression-validation.js';
export type { ExpressionValidationOptions } from './lint/expression-validation.js';

export {
  levenshtein,
  findSuggestion,
  formatSuggestionHint,
  resolveColinearAction,
  lintDiagnostic,
  extractOutputRef,
  extractVariableRef,
  LINT_SOURCE,
  SUGGESTION_THRESHOLD,
} from './lint/lint-utils.js';

export type { DialectConfig } from './dialect-config.js';

export { parseDialectAnnotation } from './dialect-annotation.js';
export type { DialectAnnotation } from './dialect-annotation.js';

export { resolveDialect } from './dialect-resolution.js';
export type {
  DialectResolutionConfig,
  VersionDiagnostic,
  ResolvedDialect,
} from './dialect-resolution.js';

export {
  TOKEN_TYPES,
  TOKEN_MODIFIERS,
  CAPTURE_MAP,
  mapCaptureToToken,
  dedupeOverlappingTokens,
  generateSemanticTokens,
} from './semantic-tokens.js';
export type { SemanticToken, HighlightCapture } from './semantic-tokens.js';

export { createLanguageService } from './service.js';
export type { LanguageService } from './service.js';

export { parseAndLint } from './parse-and-lint.js';

export type { OnEnterRule } from './core/indentation.js';
export {
  increaseIndentPattern,
  decreaseIndentPattern,
  onEnterRules,
} from './core/indentation.js';
