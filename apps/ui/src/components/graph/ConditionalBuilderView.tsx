/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Builder view for conditional editing inside the graph drawer.
 * Looks up the IfStatement in the AST and renders it with IfStatementEditor.
 */

import { useMemo } from 'react';
import type { Statement } from '@agentscript/language';
import type { AgentScriptAST } from '~/lib/parser';
import { findTopicBlock } from '~/lib/ast-utils';
import type { ConditionalEdgeData } from '~/lib/ast-to-graph';
import { useAppStore } from '~/store';
import { IfStatementEditor } from '~/components/builder/statements/IfStatementEditor';

interface ConditionalBuilderViewProps {
  data: ConditionalEdgeData;
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
        body: Statement[];
        orelse: Statement[];
      };
      const condText = ifStmt.condition?.__emit?.({ indent: 0 }) ?? '';
      if (condText === conditionKey) return stmt;

      // Check elif chains
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

/** Get statements from a ProcedureValue field. */
function getProcedureStatements(procedure: unknown): Statement[] {
  if (!procedure || typeof procedure !== 'object') return [];
  const proc = procedure as { statements?: Statement[] };
  return proc.statements ?? [];
}

/** Search all statement locations in a topic block for the matching IfStatement. */
function findIfStatementInTopic(
  ast: AgentScriptAST,
  topicName: string,
  conditionKey: string
): Statement | null {
  // Find the topic block
  const block = findTopicBlock(ast, topicName);
  if (!block) return null;

  const topicBlock = block as Record<string, unknown>;

  // Search after_reasoning
  const afterStmts = getProcedureStatements(topicBlock.after_reasoning);
  let found = findIfStatement(afterStmts, conditionKey);
  if (found) return found;

  // Search reasoning.instructions
  const reasoning = topicBlock.reasoning as Record<string, unknown> | undefined;
  if (reasoning) {
    const instrStmts = getProcedureStatements(reasoning.instructions);
    found = findIfStatement(instrStmts, conditionKey);
    if (found) return found;
  }

  // Search before_reasoning
  const beforeStmts = getProcedureStatements(topicBlock.before_reasoning);
  found = findIfStatement(beforeStmts, conditionKey);
  if (found) return found;

  return null;
}

/** Render a simple summary of statements (for nested branches). */
function renderStatementsSummary(
  statements: Array<{ __kind: string; [key: string]: unknown }>,
  prefix: string
) {
  if (statements.length === 0) {
    return (
      <p className="py-1 text-xs italic text-muted-foreground">No statements</p>
    );
  }

  return (
    <div className="space-y-1">
      {statements.map((stmt, i) => (
        <div
          key={`${prefix}-${i}`}
          className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700 dark:border-[#404040] dark:bg-[#2d2d2d] dark:text-gray-300"
        >
          <span className="font-medium text-gray-500 dark:text-gray-400">
            {formatStatementKind(stmt.__kind)}
          </span>
          {getStatementSummary(stmt)}
        </div>
      ))}
    </div>
  );
}

function formatStatementKind(kind: string): string {
  return kind.replace(/Statement$|Clause$/, '');
}

function getStatementSummary(stmt: {
  __kind: string;
  [key: string]: unknown;
}): string {
  if (stmt.__kind === 'TransitionStatement') {
    return ' \u2192 transition';
  }
  if (stmt.__kind === 'ToClause') {
    return ' \u2192 to';
  }
  return '';
}

export function ConditionalBuilderView({ data }: ConditionalBuilderViewProps) {
  const ast = useAppStore(state => state.source.ast) as AgentScriptAST | null;

  const ifStatement = useMemo(() => {
    if (!ast) return null;
    return findIfStatementInTopic(
      ast,
      data.sourceTopicName,
      data.conditionalKey
    );
  }, [ast, data.sourceTopicName, data.conditionalKey]);

  if (!ifStatement) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
        <p className="text-sm text-muted-foreground">
          Could not locate the conditional statement in the AST.
        </p>
        <p className="text-xs text-muted-foreground/70">
          Topic: {data.sourceTopicName}
        </p>
      </div>
    );
  }

  return (
    <IfStatementEditor
      statement={
        ifStatement as Parameters<typeof IfStatementEditor>[0]['statement']
      }
      allDiagnostics={[]}
      onUpdate={() => {
        // Condition editing from the drawer is read-only for now.
        // Full editing support requires CST mutation wiring.
      }}
      renderStatements={renderStatementsSummary}
    />
  );
}
