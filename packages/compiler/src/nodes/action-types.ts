/**
 * Alias action target schemes that map to a canonical Agent JSON form.
 *
 * Scheme validity (the full approved set) is enforced at lint time by
 * `actionTargetSchemeRule` in the agentforce dialect — the compiler only
 * needs the alias→canonical translation and passes anything else through.
 */
const ACTION_TARGET_TYPE_ALIASES: Record<string, string> = {
  prompt: 'generatePromptResponse',
  serviceCatalog: 'createCatalogItemRequest',
  integrationProcedureAction: 'executeIntegrationProcedure',
  expressionSet: 'runExpressionSet',
};

export function toAgentJsonActionTargetType(scheme: string): string {
  return ACTION_TARGET_TYPE_ALIASES[scheme] ?? scheme;
}
