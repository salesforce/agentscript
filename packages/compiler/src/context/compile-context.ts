import type { ContextConfiguration } from '../types.js';
import type { CompilerContext } from '../compiler-context.js';
import { extractBooleanValue } from '../ast-helpers.js';

/**
 * Compile context configuration from top-level context block.
 *
 * The context block contains:
 * - memory: memory configuration with enabled flag (boolean)
 *
 * @param contextBlock - The parsed context block from AST
 * @param ctx - Compiler context for error reporting
 * @returns Compiled ContextConfiguration or undefined if context block is not present
 */
export function compileContext(
  contextBlock:
    | {
        memory?: { enabled?: { value?: boolean } };
      }
    | null
    | undefined,
  ctx: CompilerContext
): ContextConfiguration | undefined {
  if (!contextBlock) {
    return undefined;
  }

  const result: ContextConfiguration = {};

  // Extract memory configuration if present
  if (contextBlock.memory) {
    const enabled = extractBooleanValue(contextBlock.memory.enabled);

    if (enabled === null || enabled === undefined) {
      ctx.error(
        'Context memory block requires an "enabled" field with a boolean value'
      );
    } else {
      result.memory = { enabled };
    }
  }

  // Return undefined if context block is empty
  if (Object.keys(result).length === 0) {
    return undefined;
  }

  return result;
}
