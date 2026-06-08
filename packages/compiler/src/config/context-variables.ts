import {
  MemberExpression,
  NamedMap,
  VariableDeclarationNode,
  decomposeAtMemberExpression,
} from '@agentscript/language';
import type { CompilerContext } from '../compiler-context.js';
import type { ContextVariable } from '../types.js';
import { toContextVariableDataType } from '../variables/variable-utils.js';
import { normalizeDeveloperName } from '../utils.js';
import {
  extractStringValue,
  extractSourcedString,
  extractSourcedDescription,
  getCstRange,
  getExpressionName,
  iterateNamedMap,
} from '../ast-helpers.js';
import type { Sourceable } from '../sourced.js';
import { sourced } from '../sourced.js';

/**
 * Compile linked variables from the AST into ContextVariable[].
 *
 * Linked variables (modifier = "linked") become context variables
 * that reference external data sources.
 */
export function compileContextVariables(
  variables: NamedMap<VariableDeclarationNode> | undefined,
  ctx: CompilerContext
): ContextVariable[] {
  if (!variables) return [];

  const result: ContextVariable[] = [];

  for (const [name, def] of iterateNamedMap(variables)) {
    if (def.modifier?.name !== 'linked') continue;

    const contextVar = compileContextVariable(name, def, ctx);
    if (contextVar) {
      result.push(contextVar);
      ctx.linkedVariableNames.add(name);
    }
  }

  return result;
}

function compileContextVariable(
  name: string,
  def: VariableDeclarationNode,
  ctx: CompilerContext
): ContextVariable | undefined {
  const typeStr = getExpressionName(def.type);
  if (!typeStr) {
    ctx.error(`Variable '${name}' is missing a type`, def.__cst?.range);
    return undefined;
  }

  const dataType = toContextVariableDataType(typeStr);
  if (!dataType) {
    ctx.error(
      `Unsupported context variable type: '${typeStr}' for variable '${name}'`,
      def.__cst?.range
    );
    return undefined;
  }

  // The source field lives inside the properties block of the declaration node
  const properties = def.properties as Record<string, unknown> | undefined;
  const source = extractSourceField(properties?.['source']);

  const label =
    extractSourcedString(properties?.['label']) ?? normalizeDeveloperName(name);
  // When no explicit description, use developer_name with first-letter capitalization
  // (preserving underscores): human_profile_id → Human_Profile_Id
  const description =
    extractSourcedDescription(properties?.['description']) ??
    name.replace(/(?:^|_)\w/g, c => c.toUpperCase());

  const contextVar: Sourceable<ContextVariable> = {
    developer_name: name,
    label,
    description,
    data_type: dataType,
  };

  if (source) {
    contextVar.field_mapping = sourced(
      source,
      getCstRange(properties?.['source'])
    );
  }

  return contextVar as ContextVariable;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Extract source field mapping from a linked variable definition.
 * Handles both string literals ("@Case.AccountId") and
 * MemberExpression AST nodes (@Case.AccountId parsed as expression).
 */
function extractSourceField(value: unknown): string | undefined {
  if (!value) return undefined;

  // Plain string
  const str = extractStringValue(value);
  if (str) return str;

  // MemberExpression: @Object.Field → Object.Field (no @ prefix in output)
  if (value instanceof MemberExpression) {
    const decomposed = decomposeAtMemberExpression(value);
    if (decomposed) {
      return `${decomposed.namespace}.${decomposed.property}`;
    }
  }

  // Object with text/source/value representation
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if ('text' in obj && typeof obj.text === 'string') return obj.text;
    if ('source' in obj && typeof obj.source === 'string') return obj.source;
  }

  return undefined;
}
