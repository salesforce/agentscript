/**
 * Build UnifiedAgentSpecification nodes from parsed AgentFabric AST blocks.
 * Mirrors the _build_*_node() methods from the Python adaptor.
 */

import type {
  Node,
  AgentNode,
  ActionNode,
  HandoffAction,
  HandoffActionUnion,
  ActionCallableReference,
  LLMRef,
  ToolUnion,
  MCPTool,
  A2ATool,
  StateVariable,
  NodeSystemLimits,
} from './unified-agent-specification.js';
import { ObjectTypes } from './unified-agent-specification.js';
import {
  isNamedMap,
  decomposeAtMemberExpression,
  Identifier,
  WithClause,
  Ellipsis,
  SubscriptExpression,
  StringLiteral,
  NumberLiteral,
  BooleanLiteral,
  NoneLiteral,
  VariableDeclarationNode,
} from '@agentscript/language';
import type { Expression } from '@agentscript/language';
import {
  normalizeId,
  resolveTarget,
  normalizeTemplate,
  extractString,
  extractNumber,
  extractLlmFieldReference,
  iterateCollection,
  combineGlobalSystemInstructions,
  extractProcedureText,
  extractTransitionReference,
  toPlainData,
} from './utils.js';
import {
  compileExecuteDoProcedure,
  compileExecuteExpression,
  collectExecuteVariableEnv,
  type ExecuteVariableEnv,
} from './compile-execute-do.js';

/** Extract top-level `system.instructions` as the global system prompt for all agent nodes. */
function extractGlobalSystemInstructions(ast: Record<string, unknown>): string {
  const system = ast.system;
  if (system == null || typeof system !== 'object') return '';
  return extractString((system as Record<string, unknown>).instructions) ?? '';
}

// ── Shared helpers ──────────────────────────────────────────────────

function buildOnInit(firstNode: boolean): ActionCallableReference[] | null {
  if (firstNode) {
    return [
      {
        type: ObjectTypes.ACTION,
        ref: 'IdentityAction',
        'state-updates': [
          {
            request: "normalize_headers(variables['request'])",
          },
        ],
      },
    ];
  }
  return null;
}

/** Strip optional `@llm.` prefix from a config/node LLM reference. */
function stripLlmRef(raw: string | undefined): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  const t = String(raw).trim();
  if (!t) return undefined;
  if (t.startsWith('@llm.')) return t.slice(5);
  return t;
}

function extractLlmRefFromText(text: string): string | undefined {
  const m = text.match(/@llm\.([A-Za-z0-9_-]+)/);
  return m?.[1];
}

function extractDefaultLlmRefFromSource(source: string): string | undefined {
  const lines = source.split(/\r?\n/);
  let inConfig = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!inConfig) {
      if (trimmed === 'config:') inConfig = true;
      continue;
    }
    if (trimmed.length === 0) continue;
    if (!line.startsWith('  ')) break;
    const m = line.match(/^\s{2}default_llm:\s*(.+)\s*$/);
    if (m) return extractLlmRefFromText(m[1]);
  }
  return undefined;
}

function extractNodeLlmRefFromSource(
  source: string,
  nodeType: string,
  nodeName: string
): string | undefined {
  const lines = source.split(/\r?\n/);
  const escapedType = nodeType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedName = nodeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headerRe = new RegExp(`^${escapedType}\\s+${escapedName}:\\s*$`);

  for (let i = 0; i < lines.length; i++) {
    if (!headerRe.test(lines[i].trim())) continue;
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      if (!line.startsWith('  ')) return undefined;
      if (line.startsWith('    ')) continue;
      const m = line.match(/^\s{2}llm:\s*(.+)\s*$/);
      if (m) return extractLlmRefFromText(m[1]);
    }
  }
  return undefined;
}

interface SourceNodeTool {
  actionDefName: string;
  llmInputs: string[];
  boundInputs: Record<string, string>;
}

interface CollectedToolInputs {
  llmInputs: string[];
  boundInputs: Record<string, string>;
}

function parseNodeToolsFromSource(
  source: string,
  nodeType: string,
  nodeName: string
): SourceNodeTool[] {
  const lines = source.split(/\r?\n/);
  const escapedType = nodeType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedName = nodeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headerRe = new RegExp(`^${escapedType}\\s+${escapedName}:\\s*$`);

  for (let i = 0; i < lines.length; i++) {
    if (!headerRe.test(lines[i].trim())) continue;

    let actionsLine = -1;
    let actionsIndent = 0;
    let reasoningLine = -1;
    let reasoningIndent = 0;
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      if (!line.startsWith('  ')) return [];
      const actionsMatch = line.match(/^(\s*)actions:\s*$/);
      if (actionsMatch) {
        actionsLine = j;
        actionsIndent = actionsMatch[1]?.length ?? 0;
        break;
      }
      const reasoningMatch = line.match(/^(\s*)reasoning:\s*$/);
      if (reasoningMatch) {
        reasoningLine = j;
        reasoningIndent = reasoningMatch[1]?.length ?? 0;
        break;
      }
    }
    if (actionsLine === -1 && reasoningLine !== -1) {
      for (let j = reasoningLine + 1; j < lines.length; j++) {
        const line = lines[j];
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        const indent = line.match(/^(\s*)/)?.[1]?.length ?? 0;
        if (indent <= reasoningIndent) break;
        const actionsMatch = line.match(/^(\s*)actions:\s*$/);
        if (actionsMatch) {
          actionsLine = j;
          actionsIndent = actionsMatch[1]?.length ?? 0;
          break;
        }
      }
    }
    if (actionsLine === -1) return [];

    const result: SourceNodeTool[] = [];
    let current: SourceNodeTool | undefined;
    let currentEntryIndent = actionsIndent + 2;
    for (let k = actionsLine + 1; k < lines.length; k++) {
      const line = lines[k];
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      const indent = line.match(/^(\s*)/)?.[1]?.length ?? 0;
      if (indent <= actionsIndent) break;

      const entryMatch = trimmed.match(/^([\w-]+):\s*@actions\.([\w-]+)\s*$/);
      if (entryMatch) {
        current = {
          actionDefName: entryMatch[2],
          llmInputs: [],
          boundInputs: {},
        };
        currentEntryIndent = indent;
        result.push(current);
        continue;
      }

      const withMatch = trimmed.match(/^with\s+([\w-]+)\s*=\s*(.+)\s*$/);
      if (withMatch && current && indent > currentEntryIndent) {
        const key = withMatch[1];
        const raw = withMatch[2].trim();
        if (raw === '...') {
          current.llmInputs.push(key);
        } else {
          const quoted = raw.match(/^(['"])(.*)\1$/);
          current.boundInputs[key] = quoted ? quoted[2] : raw;
        }
      }
    }
    return result;
  }

  return [];
}

function extractConfigString(value: unknown): string | undefined {
  const s = extractString(value);
  if (s !== undefined && s !== '[object Object]') return s;
  const plain = toPlainData(value);
  if (
    typeof plain === 'string' ||
    typeof plain === 'number' ||
    typeof plain === 'boolean'
  ) {
    return String(plain);
  }
  return undefined;
}

function parseEnumYamlListString(value: string): string[] | undefined {
  const lines = value.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length === 0) return undefined;

  const parsed: string[] = [];
  for (const line of lines) {
    const match = line.match(/^\s*-\s+(.+)\s*$/);
    if (!match) return undefined;
    const raw = match[1].trim();
    const quoted = raw.match(/^(['"])(.*)\1$/);
    parsed.push(quoted ? quoted[2] : raw);
  }
  return parsed.length > 0 ? parsed : undefined;
}

function normalizeOutputStructureEnums(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(v => normalizeOutputStructureEnums(v));
  }
  if (!value || typeof value !== 'object') return value;

  const rec = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, fieldValue] of Object.entries(rec)) {
    if (key === 'enum' && typeof fieldValue === 'string') {
      out[key] = parseEnumYamlListString(fieldValue) ?? fieldValue;
      continue;
    }
    out[key] = normalizeOutputStructureEnums(fieldValue);
  }
  return out;
}

/**
 * Resolve the LLM ref for an agent node and optionally attach
 * `output-structure-ref` when outputs are declared on the node.
 *
 * When the node omits `llm`, uses `defaultLlmRef` from `config.default_llm` if set,
 * otherwise falls back to the connection name `"default"`.
 */
function resolveLLMRef(
  nodeEntry: Record<string, unknown>,
  nodeType: string,
  nodeId: string,
  llmEntries: Map<string, Record<string, unknown>> | undefined,
  outputStructures: Record<string, Record<string, unknown>>,
  defaultLlmRef: string | undefined,
  source: string | undefined,
  llmNameAliases: Map<string, string> | undefined
): LLMRef {
  const explicitParsed = stripLlmRef(extractLlmFieldReference(nodeEntry.llm));
  const explicitSource = source
    ? extractNodeLlmRefFromSource(source, nodeType, nodeId)
    : undefined;
  const explicit = explicitParsed ?? explicitSource;
  const fromConfig = stripLlmRef(defaultLlmRef);
  const providerName =
    (explicit && (llmNameAliases?.get(explicit) ?? explicit)) ??
    (fromConfig && (llmNameAliases?.get(fromConfig) ?? fromConfig)) ??
    'default';

  const llmEntryKey =
    (explicitParsed &&
      llmEntries &&
      llmEntries.has(explicitParsed) &&
      explicitParsed) ||
    (fromConfig && llmEntries && llmEntries.has(fromConfig) && fromConfig) ||
    [...(llmNameAliases?.entries() ?? [])].find(
      ([parsed, canonical]) =>
        canonical === providerName && Boolean(llmEntries?.has(parsed))
    )?.[0] ||
    providerName;

  const configuration: Record<string, string> = {};
  const llmConfig = llmEntries?.get(llmEntryKey);
  if (llmConfig) {
    const stringFields = [
      'model',
      'reasoning_effort',
      'thinking_level',
      'response_logprobs',
    ] as const;
    const numberFields = [
      'temperature',
      'top_p',
      'max_output_tokens',
      'thinking_budget',
      'top_logprobs',
    ] as const;

    for (const field of stringFields) {
      const value = extractConfigString(llmConfig[field]);
      if (value !== undefined) {
        configuration[field] = value;
      }
    }
    for (const field of numberFields) {
      const value = extractNumber(llmConfig[field]);
      if (value !== undefined) {
        configuration[field] = String(value);
      }
    }
  }

  // If the node declares outputs, register it under a stable key and
  // link it via llm.output-structure-ref (without mutating provider ref).
  const outputStructure =
    nodeType === 'generator'
      ? ((nodeEntry.outputs as Record<string, unknown> | undefined) ??
        undefined)
      : ((nodeEntry.reasoning as Record<string, unknown> | undefined)
          ?.outputs as Record<string, unknown> | undefined);
  if (outputStructure) {
    const normalizedNodeId = normalizeId(nodeId);
    const outputStructureRef = `os_${normalizedNodeId}`;
    // Extract the properties map as a plain dict for the runtime
    const properties = outputStructure.properties as
      | Record<string, unknown>
      | undefined;
    if (properties) {
      const plain = toPlainData(properties);
      outputStructures[outputStructureRef] =
        (normalizeOutputStructureEnums(plain) as Record<string, unknown>) ??
        ({} as Record<string, unknown>);
    } else {
      const plain = toPlainData(outputStructure);
      outputStructures[outputStructureRef] =
        (normalizeOutputStructureEnums(plain) as Record<string, unknown>) ??
        ({} as Record<string, unknown>);
    }
    return {
      ref: providerName,
      configuration,
      'output-structure-ref': outputStructureRef,
    };
  }

  return { ref: providerName, configuration };
}

function buildAgentTools(
  nodeTools: Map<string, Record<string, unknown>> | undefined,
  actionDefs: Map<string, Record<string, unknown>> | undefined,
  env: ExecuteVariableEnv,
  source: string | undefined,
  nodeType: string,
  nodeName: string
): ToolUnion[] | null {
  const sourceTools =
    source !== undefined
      ? parseNodeToolsFromSource(source, nodeType, nodeName)
      : [];
  if (!nodeTools && sourceTools.length === 0) return null;

  const tools: ToolUnion[] = [];
  const parsedEntries: Array<{
    actionDefName: string;
    bodyStatements: unknown[];
    fallbackLlmInputs: string[];
    fallbackBoundInputs: Record<string, string>;
  }> = [];

  for (const [, toolEntry] of nodeTools ?? []) {
    const rawColinear =
      toolEntry.value ??
      toolEntry.__colinear ??
      toolEntry.colinear ??
      toolEntry.__value;
    const colinearRef = decomposeAtMemberExpression(rawColinear);

    let actionDefName: string | undefined;
    if (colinearRef && colinearRef.namespace === 'actions') {
      actionDefName = colinearRef.property;
    } else {
      const colinearValue = extractString(rawColinear);
      if (colinearValue) {
        actionDefName = colinearValue.startsWith('@actions.')
          ? colinearValue.substring(9)
          : colinearValue;
      }
    }
    if (!actionDefName) continue;

    const body = (toolEntry.body as { statements?: unknown[] } | undefined) ?? {
      statements: Array.isArray(toolEntry.statements)
        ? toolEntry.statements
        : [],
    };
    parsedEntries.push({
      actionDefName,
      bodyStatements: body?.statements ?? [],
      fallbackLlmInputs: [],
      fallbackBoundInputs: {},
    });
  }

  for (const st of sourceTools) {
    if (parsedEntries.some(p => p.actionDefName === st.actionDefName)) continue;
    parsedEntries.push({
      actionDefName: st.actionDefName,
      bodyStatements: [],
      fallbackLlmInputs: st.llmInputs,
      fallbackBoundInputs: st.boundInputs,
    });
  }

  for (const entry of parsedEntries) {
    const actionDefName = entry.actionDefName;
    if (actionDefs && actionDefs.has(actionDefName)) {
      const actionDef = actionDefs.get(actionDefName)!;
      const kind = extractString(actionDef.kind);

      if (kind === 'mcp:tool' || kind === 'a2a:send_message') {
        const collected = collectToolInputs(entry, env, actionDef);
        const tool = createCompiledAgentTool(kind, actionDefName, collected);
        if (tool) tools.push(tool);
      }
    }
  }

  return tools.length > 0 ? tools : null;
}

/**
 * Input parameter names declared on an action_definition `inputs:` map (declaration order).
 */
export function listActionDefInputNames(
  actionDef: Record<string, unknown>
): string[] {
  const names: string[] = [];
  for (const [name] of iterateCollection(actionDef.inputs)) {
    if (name) names.push(name);
  }
  return names;
}

/**
 * Implicit parameter names allowed in `with` clauses without being declared
 * in the action's `inputs:` map.
 */
export const IMPLICIT_WITH_PARAMS = new Set(['http_headers']);

/**
 * Lowercase all JSON/dict-literal keys in an expression string so that
 * HTTP header names comply with RFC 9110 case-insensitivity.
 */
export function lowercaseHttpHeaderKeys(expr: string): string {
  return expr.replace(
    /"([^"]+)"\s*:/g,
    (_, key: string) => `"${key.toLowerCase()}":`
  );
}

function collectToolInputs(
  entry: {
    bodyStatements: unknown[];
    fallbackLlmInputs: string[];
    fallbackBoundInputs: Record<string, string>;
  },
  env: ExecuteVariableEnv,
  actionDef: Record<string, unknown>
): CollectedToolInputs {
  const llmInputs = [...entry.fallbackLlmInputs];
  const boundInputs = { ...entry.fallbackBoundInputs };

  for (const stmt of entry.bodyStatements) {
    if (!(stmt instanceof WithClause)) continue;
    if (stmt.value instanceof Ellipsis) {
      llmInputs.push(stmt.param);
      continue;
    }

    const compiled = compileExecuteExpression(stmt.value, env, 'run-body');
    boundInputs[stmt.param] =
      stmt.param === 'http_headers'
        ? lowercaseHttpHeaderKeys(compiled)
        : compiled;
  }

  const llmSeen = new Set(llmInputs);
  for (const name of listActionDefInputNames(actionDef)) {
    if (Object.prototype.hasOwnProperty.call(boundInputs, name)) continue;
    if (llmSeen.has(name)) continue;
    llmInputs.push(name);
    llmSeen.add(name);
  }

  return { llmInputs, boundInputs };
}

function createCompiledAgentTool(
  kind: string,
  actionDefName: string,
  collected: CollectedToolInputs
): ToolUnion | null {
  if (kind !== 'mcp:tool' && kind !== 'a2a:send_message') {
    return null;
  }

  const tool: MCPTool | A2ATool = {
    type: kind === 'mcp:tool' ? 'mcp_tool' : 'a2a',
    ref: `${actionDefName}-client`,
    enabled: true,
  };

  if (Object.keys(collected.boundInputs).length > 0) {
    tool['bound-inputs'] = collected.boundInputs;
  }
  if (collected.llmInputs.length > 0) {
    tool['llm-inputs'] = collected.llmInputs;
  }

  return tool;
}

function buildHandoffTarget(target: string | null): HandoffAction[] {
  if (!target) return [];
  return [
    {
      type: ObjectTypes.HANDOFF,
      target: normalizeId(target),
    },
  ];
}

/**
 * Build the orchestration instructions wrapper.
 * Mirrors _build_instructions() in the Python adaptor.
 */
function buildOrchestrationInstructions(instructions: string): string {
  const parts: string[] = [];

  parts.push(
    'You are a task decomposition expert that analyzes user requests, ' +
      'identifies required sub-tasks, selects appropriate tools, and ' +
      'synthesizes final answers.\n'
  );

  parts.push(
    '1. **Decompose** the query into atomic sub-tasks\n' +
      '2. **Match** each sub-task to the appropriate tool below\n' +
      '3. **Execute** tools in optimal sequence\n' +
      '4. **Synthesize** results into final response\n'
  );

  parts.push(
    'Here is an Example of how to break down a user prompt\n' +
      "**User Query:** 'Analyze Q2 earnings for Tesla and compare to Ford in EUR'\n" +
      '**Sub-tasks:**\n' +
      '1. Get Tesla financials (USD) → Financial Summary Tool\n' +
      '2. Get Ford financials (USD) → Financial Summary Tool\n' +
      '3. Convert USD figures to EUR → Currency Converter Tool\n' +
      '4. Perform comparative analysis → Built-in Analysis Module\n'
  );

  parts.push(
    "The User's instructions section contains directives " +
      '*YOU MUST* follow when deciding which action to take next.\n\n' +
      "### User's instructions\n\n"
  );
  parts.push(normalizeTemplate(instructions));
  parts.push('\n');

  parts.push(
    '### Instructions for executing steps, selecting tools and generating output\n\n' +
      '- Execute the list of steps in order. For each step, determine if ' +
      'invoking a tool is necessary\n' +
      '- When you reach a step that requires a tool, look at the available ' +
      'tools and conversation history to determine the *single best tool* ' +
      'to call next.\n'
  );

  parts.push(
    '### Constraints\n\n' +
      '- Use the conversation history to avoid redundant tool calls and ' +
      'to track progress toward the goal.\n'
  );

  return parts.join('\n');
}

// ── Extract on_exit target ──────────────────────────────────────────

function extractOnExitTarget(onExitProcedure: unknown): string | null {
  if (!onExitProcedure) return null;

  // Prefer procedure-emitted text to avoid matching unrelated references that
  // may exist in serialized AST internals.
  const emitted = extractProcedureText(onExitProcedure);
  const text =
    emitted || (typeof onExitProcedure === 'string' ? onExitProcedure : '');

  // Match only explicit transition targets.
  const match = text.match(/transition\s+to\s+@(\w+)\.(\w[\w-]*)/i);
  if (match) {
    return match[2];
  }
  return null;
}

// ── System limits extraction ────────────────────────────────────────

function extractSystemLimits(
  entry: Record<string, unknown>
): NodeSystemLimits | undefined {
  const reasoning = entry.reasoning as Record<string, unknown> | undefined;
  if (!reasoning) return undefined;

  const maxLoops = extractNumber(reasoning.max_number_of_loops);
  const maxErrors = extractNumber(reasoning.max_consecutive_errors);
  const timeout = extractNumber(reasoning.task_timeout_secs);

  if (maxLoops == null && maxErrors == null && timeout == null) {
    return undefined;
  }

  const limits: NodeSystemLimits = {};
  if (maxLoops != null) limits['max-reasoning-iterations'] = maxLoops;
  if (maxErrors != null) limits['max-consecutive-errors'] = maxErrors;
  if (timeout != null) limits['task-timeout-secs'] = timeout;
  return limits;
}

// ── Node builders ───────────────────────────────────────────────────

function buildOrchestrationNode(
  name: string,
  entry: Record<string, unknown>,
  isInitialNode: boolean,
  llmEntries: Map<string, Record<string, unknown>> | undefined,
  actionDefs: Map<string, Record<string, unknown>> | undefined,
  outputStructures: Record<string, Record<string, unknown>>,
  globalSystemInstructions: string,
  defaultLlmRef: string | undefined,
  source: string | undefined,
  llmNameAliases: Map<string, string> | undefined,
  env: ExecuteVariableEnv
): Node[] {
  const normalizedName = normalizeId(name);
  const onExitTarget = resolveTarget(
    extractOnExitTarget(entry.on_exit) ?? null
  );

  const systemInstructions = combineGlobalSystemInstructions(
    globalSystemInstructions,
    extractProcedureText(
      (entry.system as Record<string, unknown> | undefined)?.instructions
    )
  );
  const prompt = extractProcedureText(
    (entry.reasoning as Record<string, unknown> | undefined)?.instructions
  );

  const agentNode: AgentNode = {
    name: normalizedName,
    label: extractString(entry.label) ?? null,
    description: extractString(entry.description) ?? null,
    type: ObjectTypes.AGENT,
    llm: resolveLLMRef(
      entry,
      'orchestrator',
      name,
      llmEntries,
      outputStructures,
      defaultLlmRef,
      source,
      llmNameAliases
    ),
    'on-init': buildOnInit(isInitialNode),
    'system-prompt': normalizeTemplate(prompt),
    'focus-prompt': buildOrchestrationInstructions(systemInstructions),
    tools: buildAgentTools(
      (entry.reasoning as Record<string, unknown> | undefined)?.actions as
        | Map<string, Record<string, unknown>>
        | undefined,
      actionDefs,
      env,
      source,
      'orchestrator',
      name
    ),
    'after-reasoning': buildHandoffTarget(onExitTarget),
  };
  const systemLimits = extractSystemLimits(entry);
  if (systemLimits) agentNode['system-limits'] = systemLimits;
  return [agentNode];
}

function buildReasoningNode(
  name: string,
  entry: Record<string, unknown>,
  isInitialNode: boolean,
  llmEntries: Map<string, Record<string, unknown>> | undefined,
  actionDefs: Map<string, Record<string, unknown>> | undefined,
  outputStructures: Record<string, Record<string, unknown>>,
  globalSystemInstructions: string,
  defaultLlmRef: string | undefined,
  source: string | undefined,
  llmNameAliases: Map<string, string> | undefined,
  env: ExecuteVariableEnv
): Node[] {
  const normalizedName = normalizeId(name);
  const onExitTarget = resolveTarget(
    extractOnExitTarget(entry.on_exit) ?? null
  );

  const systemInstructions = combineGlobalSystemInstructions(
    globalSystemInstructions,
    extractProcedureText(
      (entry.system as Record<string, unknown> | undefined)?.instructions
    )
  );
  const prompt = extractProcedureText(
    (entry.reasoning as Record<string, unknown> | undefined)?.instructions
  );

  const agentNode: AgentNode = {
    name: normalizedName,
    label: extractString(entry.label) ?? null,
    description: extractString(entry.description) ?? null,
    type: ObjectTypes.AGENT,
    llm: resolveLLMRef(
      entry,
      'subagent',
      name,
      llmEntries,
      outputStructures,
      defaultLlmRef,
      source,
      llmNameAliases
    ),
    'on-init': buildOnInit(isInitialNode),
    'system-prompt': normalizeTemplate(prompt),
    'focus-prompt': systemInstructions.trim()
      ? normalizeTemplate(systemInstructions)
      : null,
    tools: buildAgentTools(
      (entry.reasoning as Record<string, unknown> | undefined)?.actions as
        | Map<string, Record<string, unknown>>
        | undefined,
      actionDefs,
      env,
      source,
      'subagent',
      name
    ),
    'after-reasoning': buildHandoffTarget(onExitTarget),
  };
  const systemLimits = extractSystemLimits(entry);
  if (systemLimits) agentNode['system-limits'] = systemLimits;
  return [agentNode];
}

function buildGenerateNode(
  name: string,
  entry: Record<string, unknown>,
  isInitialNode: boolean,
  llmEntries: Map<string, Record<string, unknown>> | undefined,
  outputStructures: Record<string, Record<string, unknown>>,
  globalSystemInstructions: string,
  defaultLlmRef: string | undefined,
  source: string | undefined,
  llmNameAliases: Map<string, string> | undefined
): Node[] {
  const normalizedName = normalizeId(name);
  const onExitTarget = resolveTarget(
    extractOnExitTarget(entry.on_exit) ?? null
  );

  const systemInstructions = combineGlobalSystemInstructions(
    globalSystemInstructions,
    extractProcedureText(
      (entry.system as Record<string, unknown> | undefined)?.instructions
    )
  );
  const prompt = extractProcedureText(entry.prompt);

  const agentNode: AgentNode = {
    name: normalizedName,
    label: extractString(entry.label) ?? null,
    description: extractString(entry.description) ?? null,
    type: ObjectTypes.AGENT,
    llm: resolveLLMRef(
      entry,
      'generator',
      name,
      llmEntries,
      outputStructures,
      defaultLlmRef,
      source,
      llmNameAliases
    ),
    'on-init': buildOnInit(isInitialNode),
    'system-prompt': normalizeTemplate(prompt),
    'focus-prompt': systemInstructions.trim()
      ? normalizeTemplate(systemInstructions)
      : null,
    tools: null,
    'after-reasoning': buildHandoffTarget(onExitTarget),
  };
  return [agentNode];
}

function buildExecuteNode(
  name: string,
  entry: Record<string, unknown>,
  isInitialNode: boolean,
  actionDefs: Map<string, Record<string, unknown>> | undefined,
  ast: Record<string, unknown>
): Node[] {
  const normalizedName = normalizeId(name);
  const onExitTarget = resolveTarget(
    extractOnExitTarget(entry.on_exit) ?? null
  );

  const compiledTools = compileExecuteDoProcedure(
    entry.do,
    actionDefs,
    ast,
    normalizedName
  );
  const tools: ActionCallableReference[] =
    compiledTools.length > 0
      ? compiledTools
      : [{ ref: 'IdentityAction', 'state-updates': [] }];

  const node: ActionNode = {
    name: normalizedName,
    type: ObjectTypes.ACTION,
    label: extractString(entry.label) ?? null,
    tools,
    'on-init': buildOnInit(isInitialNode),
    'on-exit': onExitTarget ? buildHandoffTarget(onExitTarget) : null,
    'add-tool-result-to-chat-history': false,
    'output-template': null,
  };

  return [node];
}

const SWITCH_TARGET_NAMESPACES = new Set([
  'orchestrator',
  'subagent',
  'generator',
  'executor',
  'router',
  'echo',
]);

function asSwitchTarget(value: unknown): string | undefined {
  const candidates: unknown[] = [value];
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    if (rec.value !== undefined) candidates.push(rec.value);
  }

  for (const candidate of candidates) {
    const ref = decomposeAtMemberExpression(candidate);
    if (ref && SWITCH_TARGET_NAMESPACES.has(ref.namespace)) {
      return normalizeId(ref.property);
    }

    const s = extractString(candidate);
    if (s === undefined || s === '[object Object]') continue;
    const m = s.match(/^@(\w+)\.([\w-]+)$/);
    if (!m) continue;
    if (!SWITCH_TARGET_NAMESPACES.has(m[1])) continue;
    return normalizeId(m[2]);
  }
  return undefined;
}

function asObjectList(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(
      (v): v is Record<string, unknown> => v != null && typeof v === 'object'
    );
  }
  if (value && typeof value === 'object' && Symbol.iterator in value) {
    const out: Record<string, unknown>[] = [];
    for (const item of value as Iterable<unknown>) {
      const candidate =
        Array.isArray(item) && item.length === 2 ? item[1] : item;
      if (candidate && typeof candidate === 'object') {
        out.push(candidate as Record<string, unknown>);
      }
    }
    return out;
  }
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>;
    if (Array.isArray(rec.items)) {
      return rec.items.filter(
        (v): v is Record<string, unknown> => v != null && typeof v === 'object'
      );
    }
  }
  return [];
}

function buildSwitchNode(
  name: string,
  entry: Record<string, unknown>,
  isInitialNode: boolean,
  env: ExecuteVariableEnv
): Node[] {
  const normalizedName = normalizeId(name);

  const onExit: HandoffAction[] = [];

  const routes = asObjectList(entry.routes);
  for (const route of routes) {
    if (!route || typeof route !== 'object') continue;
    const r = route as Record<string, unknown>;
    const target = asSwitchTarget(r.target);
    const whenRaw = extractString(r.when);
    const when =
      whenRaw && whenRaw !== '[object Object]'
        ? whenRaw
        : r.when && typeof r.when === 'object'
          ? compileExecuteExpression(r.when as Expression, env, 'execute')
          : undefined;
    if (!target || !when || when === '[object Object]') {
      continue;
    }
    onExit.push({
      type: ObjectTypes.HANDOFF,
      target,
      enabled: when.trim(),
    });
  }

  const otherwiseBlock = entry.otherwise as Record<string, unknown> | undefined;
  if (otherwiseBlock && typeof otherwiseBlock === 'object') {
    const otherwiseTarget = asSwitchTarget(otherwiseBlock.target);
    if (otherwiseTarget) {
      onExit.push({
        type: ObjectTypes.HANDOFF,
        target: otherwiseTarget,
      });
    }
  }

  const node: ActionNode = {
    name: normalizedName,
    type: ObjectTypes.ACTION,
    label: extractString(entry.label) ?? null,
    tools: [],
    'on-init': buildOnInit(isInitialNode),
    'on-exit': onExit.length > 0 ? onExit : null,
    'add-tool-result-to-chat-history': false,
    'output-template': null,
  };

  return [node];
}

function buildEchoNode(
  name: string,
  entry: Record<string, unknown>,
  isInitialNode: boolean,
  env: ExecuteVariableEnv
): Node[] {
  const normalizedName = normalizeId(name);
  const onExitTarget = resolveTarget(
    extractOnExitTarget(entry.on_exit) ?? null
  );

  const tmpVar = `__${normalizedName}_value`;
  let stateUpdateValue: string;

  if (
    entry.task != null &&
    typeof entry.task === 'object' &&
    '__kind' in entry.task
  ) {
    stateUpdateValue = compileExecuteExpression(entry.task as Expression, env);
  } else {
    const message = extractString(entry.message) ?? '';
    const outputJson = JSON.stringify({
      state: 'completed',
      message: {
        kind: 'text',
        role: 'agent',
        parts: [{ kind: 'text', text: message }],
      },
    });
    stateUpdateValue = `template::${normalizeTemplate(outputJson)}`;
  }

  const stateUpdates = [
    { [tmpVar]: stateUpdateValue },
    {
      outputs: `add(state.outputs, "${normalizedName}", state.${tmpVar})`,
    },
  ];

  const node: ActionNode = {
    name: normalizedName,
    type: ObjectTypes.ACTION,
    label: extractString(entry.label) ?? null,
    tools: [
      {
        ref: 'IdentityAction',
        'state-updates': stateUpdates,
      },
    ],
    'on-init': buildOnInit(isInitialNode),
    'on-exit': onExitTarget ? buildHandoffTarget(onExitTarget) : null,
    'add-tool-result-to-chat-history': false,
    'output-template': null,
  };

  const echoDescription = extractString(entry.description);
  if (echoDescription !== undefined && echoDescription !== '') {
    node.description = echoDescription;
  }

  return [node];
}

// ── _node_input tracking injection ──────────────────────────────────

function isProducingNode(node: Node): boolean {
  if (node.type === ObjectTypes.AGENT) return true;
  if (node.type === ObjectTypes.ACTION) {
    const action = node as ActionNode;
    return action.tools.some(t => t.ref !== 'IdentityAction');
  }
  return false;
}

function nodeContainsNodeInputRef(node: Node): boolean {
  return JSON.stringify(node).includes('state._node_input');
}

function appendHandoffBreadcrumb(
  handoffs: HandoffActionUnion[],
  sourceName: string
): void {
  for (const h of handoffs) {
    if ((h as HandoffAction).type !== ObjectTypes.HANDOFF) continue;
    const handoff = h as HandoffAction;
    const updates = handoff['state-updates'] ?? [];
    updates.push({ _handoff_source: `'${sourceName}'` });
    handoff['state-updates'] = updates;
  }
}

function prependNodeInputLookup(node: Node): void {
  const lookup: ActionCallableReference = {
    type: ObjectTypes.ACTION,
    ref: 'IdentityAction',
    'state-updates': [
      { _node_input: "get(system.node_outputs, state._handoff_source, '')" },
    ],
  };
  const existing: HandoffActionUnion[] =
    (node as AgentNode | ActionNode)['on-init'] ?? [];
  (node as AgentNode | ActionNode)['on-init'] = [lookup, ...existing];
}

/**
 * Post-process compiled nodes to inject _node_input tracking plumbing.
 *
 * 1. Producing nodes get a `_handoff_source` breadcrumb on every handoff.
 * 2. Nodes whose compiled output references `state._node_input` get an
 *    on-init IdentityAction that resolves the deferred lookup.
 *
 * Returns true if any injection occurred (caller should add state variables).
 */
export function injectNodeInputTracking(nodes: Node[]): boolean {
  let injected = false;

  for (const node of nodes) {
    if (!isProducingNode(node)) continue;

    const agentNode = node as AgentNode;
    if (agentNode['after-reasoning']) {
      appendHandoffBreadcrumb(agentNode['after-reasoning'], node.name);
      injected = true;
    }

    const actionNode = node as ActionNode;
    if (actionNode['on-exit']) {
      appendHandoffBreadcrumb(actionNode['on-exit'], node.name);
      injected = true;
    }
  }

  for (const node of nodes) {
    if (nodeContainsNodeInputRef(node)) {
      prependNodeInputLookup(node);
      injected = true;
    }
  }

  return injected;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Build all nodes from parsed AST blocks.
 * Iterates blocks in definition order and creates the appropriate node types.
 */
export function buildNodes(
  ast: Record<string, unknown>,
  llmEntries: Map<string, Record<string, unknown>> | undefined,
  actionDefs: Map<string, Record<string, unknown>> | undefined,
  initialNode: string,
  /** Original source — used by source-based fallbacks (llm/tool extraction). */
  source?: string,
  llmNameAliases?: Map<string, string>
): {
  nodes: Node[];
  outputStructures: Record<string, Record<string, unknown>>;
} {
  const outputStructures: Record<string, Record<string, unknown>> = {};
  const result: Node[] = [];
  const env = collectExecuteVariableEnv(ast);
  const globalSystemInstructions = extractGlobalSystemInstructions(ast);
  const config = ast.config as Record<string, unknown> | undefined;
  const defaultLlmFromConfig =
    extractLlmFieldReference(config?.default_llm) ??
    (source ? extractDefaultLlmRefFromSource(source) : undefined);

  const nodeBlocks: Array<{
    type: string;
    entries: Map<string, Record<string, unknown>>;
  }> = [];

  // Collect all node-type blocks (NamedMap or Map — not `instanceof Map`)
  for (const nodeType of [
    'orchestrator',
    'subagent',
    'generator',
    'executor',
    'router',
    'echo',
  ]) {
    const block = ast[nodeType];
    for (const [name, entry] of iterateCollection(block)) {
      nodeBlocks.push({
        type: nodeType,
        entries: new Map([[name, entry]]),
      });
    }
  }

  for (const { type, entries } of nodeBlocks) {
    for (const [name, entry] of entries) {
      let nodes: Node[];
      const isInitialNode = normalizeId(name) === normalizeId(initialNode);

      switch (type) {
        case 'orchestrator':
          nodes = buildOrchestrationNode(
            name,
            entry,
            isInitialNode,
            llmEntries,
            actionDefs,
            outputStructures,
            globalSystemInstructions,
            defaultLlmFromConfig,
            source,
            llmNameAliases,
            env
          );
          break;
        case 'subagent':
          nodes = buildReasoningNode(
            name,
            entry,
            isInitialNode,
            llmEntries,
            actionDefs,
            outputStructures,
            globalSystemInstructions,
            defaultLlmFromConfig,
            source,
            llmNameAliases,
            env
          );
          break;
        case 'generator':
          nodes = buildGenerateNode(
            name,
            entry,
            isInitialNode,
            llmEntries,
            outputStructures,
            globalSystemInstructions,
            defaultLlmFromConfig,
            source,
            llmNameAliases
          );
          break;
        case 'executor':
          nodes = buildExecuteNode(name, entry, isInitialNode, actionDefs, ast);
          break;
        case 'router':
          nodes = buildSwitchNode(name, entry, isInitialNode, env);
          break;
        case 'echo':
          nodes = buildEchoNode(name, entry, isInitialNode, env);
          break;
        default:
          continue;
      }

      result.push(...nodes);
    }
  }

  return {
    nodes: result,
    outputStructures,
  };
}

function primitiveTypeString(type: Expression): string {
  if (type instanceof Identifier) return type.name;
  if (
    type instanceof SubscriptExpression &&
    type.object instanceof Identifier
  ) {
    return `${type.object.name}[]`;
  }
  return 'string';
}

function defaultFromVariableExpression(expr: Expression | undefined): unknown {
  if (expr === undefined) return undefined;
  if (expr instanceof StringLiteral) return expr.value;
  if (expr instanceof NumberLiteral) return expr.value;
  if (expr instanceof BooleanLiteral) return expr.value;
  if (expr instanceof NoneLiteral) return null;
  return undefined;
}

function defaultForDataType(dataType: string): unknown {
  if (dataType === 'object') return {};
  if (dataType.endsWith('[]')) return [];
  if (dataType === 'number') return 0;
  if (dataType === 'boolean') return false;
  return '';
}

/**
 * Build state variable entries from the `variables:` block (excluding reserved `outputs`).
 */
function buildUserDeclaredStateVariables(
  ast: Record<string, unknown>
): StateVariable[] {
  const result: StateVariable[] = [];
  const vars = ast.variables;
  if (!isNamedMap(vars)) return result;

  for (const [name, entry] of vars) {
    if (!(entry instanceof VariableDeclarationNode)) continue;
    const n = normalizeId(name);
    if (n === 'outputs') continue;

    const dataType = primitiveTypeString(entry.type);
    const explicit = defaultFromVariableExpression(entry.defaultValue);
    const defaultVal =
      explicit !== undefined ? explicit : defaultForDataType(dataType);

    result.push({
      name: n,
      label: name,
      'data-type': dataType,
      description: '',
      default: defaultVal,
    });
  }

  return result;
}

/**
 * Build graph state variables: built-in `outputs` map plus declarations from `variables:`.
 */
export function buildStateVariables(
  ast: Record<string, unknown>
): StateVariable[] {
  const outputs: StateVariable = {
    name: 'outputs',
    label: 'Node outputs',
    'data-type': 'object',
    description:
      'Map of action/execute node outputs in state namespace (agent outputs are in system.node_outputs)',
    default: {},
  };

  const user = buildUserDeclaredStateVariables(ast);
  return [outputs, ...user.filter(v => v.name !== 'outputs')];
}

/**
 * Resolve the initial node from the trigger's on_message transition target.
 */
export function resolveInitialNode(
  triggers: Map<string, Record<string, unknown>>
): string {
  const [, triggerEntry] = triggers.entries().next().value as [
    string,
    Record<string, unknown>,
  ];
  const transitionRef = extractTransitionReference(triggerEntry.on_message);
  const targetMatch = transitionRef.match(
    /^@([A-Za-z_][\w]*)\.([A-Za-z0-9_-]+)$/
  )!;
  return normalizeId(targetMatch[2]);
}

/**
 * Collect echo node names that are a2a:response type.
 */
export function collectResponseNodeNames(
  echoEntries: Map<string, Record<string, unknown>> | undefined
): string[] {
  const names = new Set<string>();
  if (!echoEntries) return [];

  for (const [name, entry] of echoEntries) {
    const kind = extractString((entry as Record<string, unknown>).kind);
    if (kind === 'a2a:response') {
      names.add(normalizeId(name));
    }
  }

  return [...names];
}
