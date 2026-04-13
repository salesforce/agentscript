/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Code view for conditional editing inside the graph drawer.
 * Extracts the source text of the IfStatement from the agentscript source.
 */

import { useMemo } from 'react';
import type { Statement } from '@agentscript/language';
import type { AgentScriptAST } from '~/lib/parser';
import { findTopicBlock } from '~/lib/ast-utils';
import type { ConditionalEdgeData } from '~/lib/ast-to-graph';
import { useAppStore } from '~/store';

interface ConditionalCodeViewProps {
  data: ConditionalEdgeData;
}

interface CstRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

/** Walk statements to find an IfStatement matching the given condition text. */
function findIfStatement(
  statements: Statement[],
  conditionKey: string
): Statement | null {
  for (const stmt of statements) {
    if (stmt.__kind === 'IfStatement') {
      const ifStmt = stmt as {
        condition?: { __emit?(ctx: { indent: number }): string };
        orelse: Statement[];
      };
      const condText = ifStmt.condition?.__emit?.({ indent: 0 }) ?? '';
      if (condText === conditionKey) return stmt;

      if (
        ifStmt.orelse?.length === 1 &&
        ifStmt.orelse[0].__kind === 'IfStatement'
      ) {
        const found = findIfStatement(
          ifStmt.orelse as Statement[],
          conditionKey
        );
        if (found) return found;
      }
    }
  }
  return null;
}

function getProcedureStatements(procedure: unknown): Statement[] {
  if (!procedure || typeof procedure !== 'object') return [];
  const proc = procedure as { statements?: Statement[] };
  return proc.statements ?? [];
}

function findIfStatementInTopic(
  ast: AgentScriptAST,
  topicName: string,
  conditionKey: string
): Statement | null {
  const block = findTopicBlock(ast, topicName);
  if (!block) return null;
  const topicBlock = block as Record<string, unknown>;

  const afterStmts = getProcedureStatements(topicBlock.after_reasoning);
  let found = findIfStatement(afterStmts, conditionKey);
  if (found) return found;

  const reasoning = topicBlock.reasoning as Record<string, unknown> | undefined;
  if (reasoning) {
    const instrStmts = getProcedureStatements(reasoning.instructions);
    found = findIfStatement(instrStmts, conditionKey);
    if (found) return found;
  }

  const beforeStmts = getProcedureStatements(topicBlock.before_reasoning);
  found = findIfStatement(beforeStmts, conditionKey);
  if (found) return found;

  return null;
}

/** Extract source lines using CST range. */
function extractSource(source: string, range: CstRange): string {
  const lines = source.split('\n');
  const startLine = range.start.line;
  const endLine = range.end.line;

  if (startLine >= lines.length) return '';

  const extracted = lines.slice(startLine, endLine + 1);
  if (extracted.length === 0) return '';

  // Trim the first line from the start character
  extracted[0] = extracted[0].slice(range.start.character);
  // Trim the last line to the end character
  if (extracted.length > 1) {
    extracted[extracted.length - 1] = extracted[extracted.length - 1].slice(
      0,
      range.end.character
    );
  } else {
    extracted[0] = extracted[0].slice(
      0,
      range.end.character - range.start.character
    );
  }

  return extracted.join('\n');
}

export function ConditionalCodeView({ data }: ConditionalCodeViewProps) {
  const ast = useAppStore(state => state.source.ast) as AgentScriptAST | null;
  const source = useAppStore(state => state.source.agentscript);

  const codeSnippet = useMemo(() => {
    if (!ast || !source) return null;

    const ifStmt = findIfStatementInTopic(
      ast,
      data.sourceTopicName,
      data.conditionalKey
    );
    if (!ifStmt) return null;

    const cst = (ifStmt as Record<string, unknown>).__cst as
      | { range?: CstRange }
      | undefined;
    if (!cst?.range) return null;

    return extractSource(source, cst.range);
  }, [ast, source, data.sourceTopicName, data.conditionalKey]);

  if (!codeSnippet) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
        <p className="text-sm text-muted-foreground">
          Could not extract source code for this conditional.
        </p>
        <p className="text-xs text-muted-foreground/70">
          Topic: {data.sourceTopicName}
        </p>
      </div>
    );
  }

  return (
    <pre className="overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-3 text-xs leading-relaxed text-gray-800 dark:border-[#404040] dark:bg-[#1e1e1e] dark:text-gray-200">
      <code>{codeSnippet}</code>
    </pre>
  );
}
