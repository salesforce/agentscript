import type { Range } from '@agentscript/types';

// Re-export the standard LSP Diagnostic interface from the types package,
// ensuring a single diagnostic type across the entire stack.
export { DiagnosticSeverity } from '@agentscript/types';
export type { Diagnostic } from '@agentscript/types';

/** Fallback range for compiler diagnostics that lack source position info. */
export const FALLBACK_RANGE: Range = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 0 },
};
