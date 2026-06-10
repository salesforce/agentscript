import { Block, InputsBlock } from '@agentscript/language';

/**
 * Schema URI prefix for generic BYON subagents. Any subagent whose `schema`
 * starts with this prefix is compiled to a BYON node with `byo_client`
 * derived from the URI shape `node://byon/<namespace>/<type>/<version>`.
 */
export const BYON_SCHEMA_PREFIX = 'node://byon/';

/**
 * Parameters block for generic BYON subagents. Accepts arbitrary named
 * sub-groups (e.g. `template`, `auth_config`), each parsed as an InputsBlock
 * containing key → @variables.X bindings.
 */
const ByonParametersBlock = Block(
  'ParametersBlock',
  {},
  { wildcardPrefixes: [{ prefix: '', fieldType: InputsBlock }] }
).describe(
  'Parameter groups. Each key is a named group containing variable bindings (key: @variables.X).'
);

/**
 * Variant-specific overrides for generic BYON subagents (any node://byon/*
 * schema).
 *
 * Layered over `afCustomSubagentFields` in schema.ts, which provides the base
 * custom-subagent fields plus AF cross-cutting blocks (actions, model_config,
 * security). This file owns only what is *specific* to generic BYON —
 * the open parameters shape that accepts arbitrary sub-groups.
 */
export const byonSubagentVariantFields = {
  parameters: ByonParametersBlock,
};
