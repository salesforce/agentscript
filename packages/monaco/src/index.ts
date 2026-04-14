/**
 * @agentscript/monaco
 *
 * Monaco Editor integration for AgentScript with syntax highlighting.
 *
 * Parsing runs in a Web Worker using @agentscript/parser-javascript to keep
 * the main thread responsive.
 */

// Main exports
export { registerAgentScriptLanguage } from './monaco-agentscript';
export {
  languageConfiguration,
  theme,
  lightTheme,
  darkTheme,
  createDiagnosticMarkers,
  initializeTreeSitter,
} from './monaco-agentscript';

// Theme color definitions (single source of truth)
export {
  darkThemeColors,
  lightThemeColors,
  buildMonacoRules,
  buildVscodeRules,
} from './theme';
export type { ThemeColors, TokenStyle } from './theme';

// Parser exports
export { parseAndGetErrors } from './parser-api';

export {
  initializeParser,
  parseAgentScript,
  getHighlightCaptures,
  isParserDisabled,
  disableParser,
  enableParser,
  isParserReady,
  resetParser,
  terminateParser,
  clearCrashCache,
} from './parser-api';

// Type exports
export type {
  SerializedNode,
  HighlightCapture,
  ParseError,
} from './parser-api';

// Hover provider and schema resolver
export { createHoverProvider } from './hover-provider';
export { resolveHoverInfo } from './schema-resolver';
export type {
  SchemaFieldInfo,
  SchemaHoverInfo,
  KeywordHoverInfo,
  HoverInfo,
} from './schema-resolver';

// Worker manager exports (for advanced use)
export { workerParser, WorkerParserManager } from './worker-parser';
export type {
  ParseResult,
  HighlightResult,
  ErrorResult,
} from './worker-parser';
