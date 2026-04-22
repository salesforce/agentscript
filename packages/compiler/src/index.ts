// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export { compile } from './compile.js';
export type { CompileResult } from './compile.js';

export { serializeWithSourceMap as serialize } from './source-map/source-map-serializer.js';
export type {
  SerializeOptions,
  SerializeResult,
} from './source-map/source-map-serializer.js';

export {
  findGeneratedPosition,
  findOriginalPosition,
} from './source-map/source-map-utils.js';
export type { SourceMapping } from './source-map/source-map-utils.js';

export type { EncodedSourceMap } from '@jridgewell/gen-mapping';

export { buildCursorMap } from './source-map/range-mappings.js';
export type { CursorMap } from './source-map/range-mappings.js';

export type { RangeMap } from './source-map/source-map-serializer.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type {
  AgentDSLAuthoring,
  GlobalAgentConfiguration,
  AgentVersion,
  ContextVariable,
  ContextConfiguration,
  MemoryConfiguration,
  StateVariable,
  SystemMessage,
  ModalityParameters,
  LanguageConfiguration,
  VoiceConfiguration,
  AdditionalParameters,
  AgentNode,
  SubAgentNode,
  RouterNode,
  ModelConfiguration,
  Action,
  HandOffAction,
  Tool,
  SupervisionTool,
  RouterTool,
  PostToolCall,
  ActionDefinition,
  InputParameter,
  OutputParameter,
  Surface,
  OutboundRouteConfig,
  ResponseAction,
  ResponseFormat,
  StateUpdate,
} from './types.js';

export { DiagnosticSeverity } from './diagnostics.js';
export type {
  Diagnostic,
  Diagnostic as CompilerDiagnostic,
} from './diagnostics.js';
