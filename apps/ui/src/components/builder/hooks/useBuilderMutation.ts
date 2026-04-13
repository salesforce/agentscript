/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useCallback, useMemo } from 'react';
import { useParams } from 'react-router';
import { useAppStore } from '~/store';
import { useAgentStore } from '~/store/agentStore';
import { getDialectSchema } from '~/lib/parser';
import { detectDialectId } from '~/lib/detect-dialect';
import { emitDocument } from '@agentscript/language';
import type { FieldType } from '@agentscript/language';
import type { AgentScriptAST } from '~/lib/parser';

/**
 * Hook providing mutation utilities for the Builder.
 *
 * Structural mutations (add/remove blocks) go through emitDocument() to
 * regenerate the full text. The normal parse pipeline then re-creates the AST.
 */
export function useBuilderMutation() {
  const ast = useAppStore(state => state.source.ast) as AgentScriptAST | null;
  const agentscript = useAppStore(state => state.source.agentscript);
  const dialectId = detectDialectId(agentscript);
  const setAgentScript = useAppStore(state => state.setAgentScript);
  const { agentId } = useParams();
  const updateAgentContent = useAgentStore(state => state.updateAgentContent);

  const schema = useMemo(() => getDialectSchema(dialectId), [dialectId]);

  /** Apply a text-producing mutator and push through the pipeline. */
  const applyText = useCallback(
    (newText: string) => {
      setAgentScript(newText);
      if (agentId) {
        updateAgentContent(agentId, newText);
      }
    },
    [setAgentScript, agentId, updateAgentContent]
  );

  /**
   * Emit the full document from the current AST.
   * Use after making modifications to a cloned AST.
   */
  const emitAndApply = useCallback(
    (modifiedAst: Record<string, unknown>) => {
      const newText = emitDocument(
        modifiedAst,
        schema as Record<string, FieldType>
      );
      applyText(newText);
    },
    [schema, applyText]
  );

  return {
    ast,
    schema,
    agentscript,
    applyText,
    emitAndApply,
  };
}
