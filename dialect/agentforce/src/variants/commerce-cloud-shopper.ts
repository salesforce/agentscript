import { Block, InputsBlock } from '@agentscript/language';

/**
 * Schema discriminant value for the Commerce Cloud Shopper subagent variant.
 */
export const COMMERCE_SHOPPER_SCHEMA = 'node://commerce/shopper_agent/v1';

const CommerceShopperParametersBlock = Block('ParametersBlock', {
  template: InputsBlock.describe(
    'Variable bindings: each key maps to a @variables.X expression, e.g., authToken: @variables.authToken.'
  ),
}).describe(
  'Variable binding configuration. Use parameters.template to pre-populate node inputs from agent-level variables.'
);

/**
 * Variant-specific overrides for the Commerce Cloud Shopper subagent.
 *
 * Layered over `afCustomSubagentFields` in schema.ts, which provides the base
 * custom-subagent fields plus AF cross-cutting blocks (actions, model_config,
 * security). This file owns only what is *specific* to commerce — currently
 * the `parameters.template` shape.
 */
export const commerceShopperVariantFields = {
  parameters: CommerceShopperParametersBlock,
};
