/**
 * Parser utilities for AgentScript
 *
 * This module provides parsing functions that run in a Web Worker.
 * The worker keeps parsing off the main thread for better editor responsiveness.
 */

import {
  workerParser,
  type SerializedNode,
  type HighlightCapture,
  type ParseError,
} from './worker-parser';

// Re-export types
export type { SerializedNode, HighlightCapture, ParseError };

// Track if parsing is permanently disabled (e.g., after max restart attempts)
let parsingDisabled = false;
let disableReason: string | null = null;

/**
 * Check if parsing is disabled
 */
export function isParserDisabled(): boolean {
  return parsingDisabled;
}

/**
 * Get the reason why parsing is disabled (if applicable)
 */
export function getDisableReason(): string | null {
  return disableReason;
}

/**
 * Permanently disable parsing
 * This is called when the worker has crashed too many times
 */
export function disableParser(reason: string = 'Unknown error'): void {
  if (parsingDisabled) return;

  console.warn(
    `Parsing has been disabled: ${reason}. Refresh the page to try again.`
  );
  parsingDisabled = true;
  disableReason = reason;
}

/**
 * Re-enable parsing (e.g., after user fixes content)
 */
export function enableParser(): void {
  parsingDisabled = false;
  disableReason = null;
}

/**
 * Initialize the parser (via worker)
 * @returns Promise that resolves when initialization is complete
 * @throws If initialization fails
 */
export async function initializeParser(): Promise<void> {
  if (parsingDisabled) {
    throw new Error(`Parsing is disabled: ${disableReason}`);
  }

  await workerParser.initialize();
}

/**
 * Check if the parser is ready
 */
export function isParserReady(): boolean {
  return workerParser.isReady();
}

/**
 * Parse AgentScript source code
 *
 * @param code - The AgentScript source code to parse
 * @returns The serialized parse tree root node, or null if parsing fails
 */
export async function parseAgentScript(
  code: string
): Promise<SerializedNode | null> {
  if (parsingDisabled) {
    return null;
  }

  const result = await workerParser.parse(code);

  if (!result.success) {
    if (result.error?.includes('Max restart attempts')) {
      disableParser(result.error);
    }
    return null;
  }

  return result.rootNode ?? null;
}

/**
 * Get syntax highlighting captures for AgentScript code
 *
 * @param code - The AgentScript source code
 * @returns Array of highlight captures, or empty array if parsing fails
 */
export async function getHighlightCaptures(
  code: string
): Promise<HighlightCapture[]> {
  if (parsingDisabled) {
    return [];
  }

  const result = await workerParser.highlight(code);

  if (!result.success) {
    if (result.error?.includes('Max restart attempts')) {
      disableParser(result.error);
    }
    return [];
  }

  return result.captures ?? [];
}

/**
 * Parse AgentScript and extract syntax errors
 *
 * @param code - The AgentScript source code to parse
 * @returns Array of syntax errors
 */
export async function parseAndGetErrors(code: string): Promise<ParseError[]> {
  if (parsingDisabled) {
    return [];
  }

  const result = await workerParser.getErrors(code);

  if (!result.success) {
    if (result.error?.includes('Max restart attempts')) {
      disableParser(result.error);
    }
    return [];
  }

  return result.errors ?? [];
}

/**
 * Reset the parser (restarts the worker)
 * @deprecated The worker automatically restarts on crash
 */
export function resetParser(): void {
  console.warn('[resetParser] Worker auto-restarts on crash, no action needed');
}

/**
 * Terminate the worker (for cleanup)
 */
export function terminateParser(): void {
  workerParser.terminate();
}

/**
 * Clear the crash cache
 * Call this when the user edits content to allow re-parsing
 */
export function clearCrashCache(): void {
  workerParser.clearCrashCache();
}
