import type { KeywordInfo } from './types.js';

export const AGENTSCRIPT_PRIMITIVE_TYPES = [
  {
    keyword: 'string',
    description: 'A text value, such as a name, message, or ID.',
  },
  {
    keyword: 'number',
    description: 'A numeric value that can include decimals (e.g., 3.14).',
  },
  { keyword: 'boolean', description: 'A True or False value.' },
  {
    keyword: 'object',
    description: 'A collection of named values (key-value pairs).',
  },
  { keyword: 'currency', description: 'A monetary amount.' },
  {
    keyword: 'date',
    description: 'A calendar date without a time (e.g., 2025-03-15).',
  },
  {
    keyword: 'datetime',
    description: 'A date and time with timezone (e.g., 2025-03-15T10:30:00Z).',
  },
  {
    keyword: 'time',
    description: 'A time of day without a date (e.g., 14:30).',
  },
  {
    keyword: 'timestamp',
    description: 'A point in time represented as a Unix epoch value.',
  },
  { keyword: 'id', description: 'A unique record identifier.' },
  {
    keyword: 'integer',
    description: 'A whole number with no decimal part (e.g., 42).',
  },
  {
    keyword: 'long',
    description:
      'A large whole number for values that may exceed normal integer range.',
  },
] as const satisfies readonly KeywordInfo[];
export type AgentScriptPrimitiveType =
  (typeof AGENTSCRIPT_PRIMITIVE_TYPES)[number]['keyword'];

export const VARIABLE_MODIFIERS = [
  {
    keyword: 'mutable',
    description:
      'A variable that can be changed during the conversation. Use `set` to update its value.',
  },
  {
    keyword: 'linked',
    description:
      'A variable whose value comes from an external system (e.g., a CRM record). Cannot be changed directly.',
  },
] as const satisfies readonly KeywordInfo[];
export type VariableModifier = (typeof VARIABLE_MODIFIERS)[number]['keyword'];

export type AllowedStringValueKind = 'StringLiteral' | 'TemplateExpression';
export const ALLOWED_STRING_VALUE_KINDS = new Set<AllowedStringValueKind>([
  'StringLiteral',
  'TemplateExpression',
]);
export const STRING_VALUE_DEFAULT = Array.from(ALLOWED_STRING_VALUE_KINDS);
