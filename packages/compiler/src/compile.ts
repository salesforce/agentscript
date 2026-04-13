/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { VariableDeclarationNode } from '@agentscript/language';
import type { Range } from '@agentscript/types';
import type { Diagnostic } from './diagnostics.js';
import type { AgentDSLAuthoring } from './types.js';
import type { ParsedAgentforce } from './parsed-types.js';
import { CompilerContext } from './compiler-context.js';
import { SCHEMA_VERSION } from './constants.js';
import { validateKnowledgeReferences } from './validation/validate-knowledge-refs.js';
import { validateOutput } from './validation/validate-output.js';
import {
  compileAgentConfiguration,
  extractAdditionalParameters,
} from './config/agent-configuration.js';
import { compileContextVariables } from './config/context-variables.js';
import { compileSecurity } from './config/compile-security.js';
import { compileAgentVersion } from './agent-version/compile-agent-version.js';
import { compileContext } from './context/compile-context.js';
import { agentDslAuthoring, contextConfigurationSchema } from './types.js';

/**
 * Result of the compile() function.
 */
export interface CompileResult {
  /** The AgentJSON output object (plain values — all Sourced<T> unwrapped) */
  output: AgentDSLAuthoring;
  /** Source range data for serializer: (object, key) → Range */
  ranges: WeakMap<object, Map<string, Range>>;
  /** Compiler diagnostics (errors, warnings) */
  diagnostics: Diagnostic[];
}

/**
 * Compile a parsed AgentScript AST into AgentJSON (AgentDSLAuthoring schema v2.0).
 *
 * Output values are plain primitives. Source ranges are tracked in `ranges`
 * (populated automatically by ctx.track()). Pass both to serializeWithSourceMap().
 */
export function compile(ast: ParsedAgentforce): CompileResult {
  const ctx = new CompilerContext();

  // Step 1: Validate @knowledge references
  validateKnowledgeReferences(ast.knowledge, ctx);

  // Step 2: Compile context variables (linked variables)
  const contextVariables = compileContextVariables(ast.variables, ctx);

  // Step 3: Populate mutable variable names in context
  if (ast.variables) {
    for (const [name, varDef] of ast.variables) {
      const def = varDef as VariableDeclarationNode;
      if (def.modifier?.name !== 'linked') {
        ctx.mutableVariableNames.add(name);
      }
    }
  }

  // Step 4: Compile global agent configuration
  const globalConfiguration = compileAgentConfiguration(
    ast.config,
    contextVariables,
    ctx
  );

  // Step 4b: Compile security independently and attach to global configuration
  const security = compileSecurity(ast.security, ctx);
  if (security) {
    globalConfiguration.security = security;
  }

  // Step 5: Extract additional parameters
  const additionalParameters = extractAdditionalParameters(
    ast.config,
    ast.knowledge
  );

  // Step 6: Compile agent version
  const agentVersion = compileAgentVersion(
    ast,
    contextVariables,
    additionalParameters,
    ctx
  );

  // Step 7: Compile context block (script stays top-level; output maps to agent_version)
  const context = compileContext(ast.context, ctx);

  // Step 8: Assemble and track output (unwraps Sourced values, records ranges)
  const output = ctx.track<AgentDSLAuthoring>({
    schema_version: SCHEMA_VERSION,
    global_configuration: globalConfiguration,
    agent_version: agentVersion,
  });

  // Step 9: Validate base output against Zod schema
  validateOutput(output, agentDslAuthoring, ctx);

  // Context is top-level in script but maps to agent_version in compiled output.
  // The generated schema has context at top-level; we validate with that schema
  // but place it under agent_version for the runtime.
  if (context) {
    const contextValidation = contextConfigurationSchema.safeParse(context);
    if (contextValidation.success) {
      const agentVersionOut = output.agent_version as unknown;
      if (Array.isArray(agentVersionOut)) {
        if (agentVersionOut.length > 0) {
          (agentVersionOut[0] as Record<string, unknown>).context = context;
        }
      } else {
        (agentVersionOut as Record<string, unknown>).context = context;
      }
    } else {
      ctx.error(
        `Context validation failed: ${contextValidation.error.message}`
      );
    }
  }

  return {
    output,
    ranges: ctx.ranges,
    diagnostics: ctx.diagnostics,
  };
}
