import type { TemplatePart } from '@agentscript/language';
import type { CompilerContext } from '../compiler-context.js';
import type { SystemMessage } from '../types.js';
import type { ParsedSystem } from '../parsed-types.js';
import { compileTemplate } from '../expressions/compile-template.js';
import { extractSourcedString } from '../ast-helpers.js';
import type { Sourceable, Sourced } from '../sourced.js';

/**
 * Compile system messages (welcome, error) from the system block.
 */
export function compileSystemMessages(
  systemBlock: ParsedSystem | undefined,
  ctx: CompilerContext
): SystemMessage[] {
  if (!systemBlock) return [];

  const messages = systemBlock.messages;
  if (!messages) return [];

  const result: SystemMessage[] = [];

  // Welcome message
  const welcome = messages.welcome;
  if (welcome) {
    const msg = compileMessageValue(welcome, ctx);
    // Use !== undefined to preserve explicitly empty strings (welcome: "")
    if (msg !== undefined) {
      const systemMsg: Sourceable<SystemMessage> = {
        message: msg,
        message_type: 'Welcome',
      };
      result.push(systemMsg as SystemMessage);
    }
  }

  // Error message
  const error = messages.error;
  if (error) {
    const msg = compileMessageValue(error, ctx);
    // Use !== undefined to preserve explicitly empty strings (error: "")
    if (msg !== undefined) {
      const systemMsg: Sourceable<SystemMessage> = {
        message: msg,
        message_type: 'Error',
      };
      result.push(systemMsg as SystemMessage);
    }
  }

  return result;
}

/**
 * Serialize system messages to JSON string for additional_parameters.
 */
export function serializeSystemMessagesForAdditionalParams(
  systemMessages: SystemMessage[]
): string | undefined {
  if (systemMessages.length === 0) return undefined;

  const jsonArr = systemMessages.map(m => ({
    message: m.message,
    messageType: m.message_type,
  }));

  // Match Python json.dumps(separators=(', ', ': '))
  // JSON.stringify doesn't support custom separators, so we build manually
  const parts = jsonArr.map(m => {
    const msgEsc = JSON.stringify(m.message);
    const typeEsc = JSON.stringify(m.messageType);
    return `{"message": ${msgEsc}, "messageType": ${typeEsc}}`;
  });
  return `[${parts.join(', ')}]`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compileMessageValue(
  value: unknown,
  ctx: CompilerContext
): string | Sourced<string> | undefined {
  // Template with parts — must check before extractSourcedString which
  // would return the raw .content string without compiling interpolations
  if (value && typeof value === 'object' && 'parts' in value) {
    const parts = (value as { parts: TemplatePart[] }).parts;
    return compileTemplate(parts, ctx, { isSystemMessage: true });
  }

  // Plain string
  const str = extractSourcedString(value);
  if (str !== undefined) return str;

  return undefined;
}
