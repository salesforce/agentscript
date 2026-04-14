import type { CompilerContext } from '../compiler-context.js';
import type {
  GlobalAgentConfiguration,
  ContextVariable,
  AdditionalParameters,
} from '../types.js';
import type { ParsedConfig, ParsedKnowledge } from '../parsed-types.js';
import { DEFAULT_AGENT_TYPE } from '../constants.js';
import {
  extractStringValue,
  extractBooleanValue,
  extractNumberValue,
  extractSourcedString,
  extractSourcedBoolean,
} from '../ast-helpers.js';
import type { Sourceable } from '../sourced.js';
import { deriveLabel } from '../utils.js';

/**
 * Access a dynamic field on ParsedConfig by key.
 *
 * ParsedConfig is generated from the dialect schema and only exposes
 * statically-known fields.  Some fields (e.g. `template_name`,
 * `additional_parameter__*`) are added dynamically.  This helper
 * centralises the single `as unknown as Record` cast needed to reach them.
 */
function configField(config: ParsedConfig, key: string): unknown {
  return (config as unknown as Record<string, unknown>)[key];
}

/**
 * Compile the global agent configuration from the parsed AST.
 */
export function compileAgentConfiguration(
  config: ParsedConfig | undefined,
  contextVariables: ContextVariable[],
  ctx: CompilerContext
): GlobalAgentConfiguration {
  if (!config) {
    ctx.error('Missing config block');
    return {
      developer_name: '',
      label: '',
      description: '',
      enable_enhanced_event_logs: false,
      agent_type: DEFAULT_AGENT_TYPE,
      default_agent_user: '',
      context_variables: contextVariables,
    };
  }

  const developerName =
    extractSourcedString(config['developer_name']) ??
    extractSourcedString(config['agent_name']) ??
    '';
  const enableEnhancedEventLogs =
    extractSourcedBoolean(config['enable_enhanced_event_logs']) ?? false;
  const rawAgentType =
    extractStringValue(config['agent_type']) ?? DEFAULT_AGENT_TYPE;
  const rawAgentTypeSourced =
    extractSourcedString(config['agent_type']) ?? DEFAULT_AGENT_TYPE;
  // Map legacy alias to canonical enum value
  const agentType = (
    rawAgentType === 'AgentforceServiceAgent'
      ? 'EinsteinServiceAgent'
      : rawAgentTypeSourced
  ) as Sourceable<GlobalAgentConfiguration['agent_type']>;
  const defaultAgentUser =
    extractSourcedString(config['default_agent_user']) ?? '';
  const templateName = extractSourcedString(
    configField(config, 'agent_template')
  );

  const developerNamePlain =
    extractStringValue(config['developer_name']) ??
    extractStringValue(config['agent_name']) ??
    '';
  const agentLabelPlain = extractStringValue(config['agent_label']) ?? '';
  const label = deriveLabel(developerNamePlain, agentLabelPlain || undefined);
  const description =
    extractSourcedString(config['agent_description']) ??
    extractSourcedString(config['description']) ??
    label;

  const result: Sourceable<GlobalAgentConfiguration> = {
    developer_name: developerName,
    label,
    description,
    enable_enhanced_event_logs: enableEnhancedEventLogs,
    agent_type: agentType,
    context_variables: contextVariables,
  };

  // Only include default_agent_user if it's not empty
  const defaultAgentUserPlain =
    extractStringValue(config['default_agent_user']) ?? '';
  if (defaultAgentUserPlain) {
    result.default_agent_user = defaultAgentUser;
  }

  if (templateName !== undefined) {
    result.template_name = templateName;
  }

  ctx.setScriptPath(result, 'config');

  return result as GlobalAgentConfiguration;
}

/**
 * Extract additional parameters from config block.
 */
export function extractAdditionalParameters(
  config: ParsedConfig | undefined,
  knowledgeBlock: ParsedKnowledge | undefined
): AdditionalParameters | undefined {
  const params: AdditionalParameters = {};
  let hasParams = false;

  const ADDITIONAL_PARAM_PREFIX = 'additional_parameter__';

  if (config) {
    // Generic extraction for all additional_parameter__* fields
    for (const key of Object.keys(config)) {
      if (key.startsWith(ADDITIONAL_PARAM_PREFIX)) {
        const paramName = key.slice(ADDITIONAL_PARAM_PREFIX.length);
        const raw = configField(config, key);
        const boolVal = extractBooleanValue(raw);
        if (boolVal !== undefined) {
          params[paramName] = boolVal;
          hasParams = true;
          continue;
        }
        const numVal = extractNumberValue(raw);
        if (numVal !== undefined) {
          params[paramName] = numVal;
          hasParams = true;
          continue;
        }
        const strVal = extractStringValue(raw);
        if (strVal !== undefined) {
          params[paramName] = strVal;
          hasParams = true;
        }
      }
    }

    const debug = extractBooleanValue(config['debug']);
    if (debug !== undefined) {
      params.debug = debug;
      hasParams = true;
    }

    const maxTokens = extractNumberValue(config['max_tokens']);
    if (maxTokens !== undefined) {
      params.max_tokens = maxTokens;
      hasParams = true;
    }

    const temperature = extractNumberValue(config['temperature']);
    if (temperature !== undefined) {
      params.temperature = temperature;
      hasParams = true;
    }
  }

  if (knowledgeBlock) {
    const ragFeatureConfigId = extractStringValue(
      knowledgeBlock['rag_feature_config_id']
    );
    if (ragFeatureConfigId) {
      params.rag_feature_config_id = ragFeatureConfigId;
      hasParams = true;
    }
  }

  return hasParams ? params : undefined;
}

/**
 * Extract company and role from config block.
 */
export function extractCompanyAndRole(config: ParsedConfig | undefined): {
  company: Sourceable<string> | null;
  role: Sourceable<string> | null;
} {
  if (!config) return { company: null, role: null };

  const company = extractSourcedString(config['company']) ?? null;
  const role = extractSourcedString(config['role']) ?? null;

  return { company, role };
}
