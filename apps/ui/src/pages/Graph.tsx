/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useCallback } from 'react';
import { useParams, useNavigate } from 'react-router';
import { ChevronLeft } from 'lucide-react';

import { Graph as SharedGraph } from '@agentscript/graph-ui';
import type { ParsedAgentforce as AgentScriptAST } from '@agentscript/agentforce-dialect';
import { useAppStore } from '~/store';
import { ErrorBoundary } from '~/components/shared/ErrorBoundary';
import { PanelHeader } from '~/components/panels/PanelHeader';
import { Button } from '~/components/ui/button';
import { GraphDrawer } from '~/components/graph/GraphDrawer';

export function Graph() {
  const { agentId, topicId } = useParams();
  const navigate = useNavigate();
  const ast = useAppStore(
    state => state.source.ast
  ) as unknown as AgentScriptAST | null;
  const theme = useAppStore(state => state.theme.theme);
  const setSelectedNodeId = useAppStore(state => state.setSelectedNodeId);
  const openGraphDrawer = useAppStore(state => state.openGraphDrawer);
  const openActionDrawer = useAppStore(state => state.openActionDrawer);
  const closeGraphDrawer = useAppStore(state => state.closeGraphDrawer);

  const isTopicDetail = !!topicId;

  const handleTopicOpen = useCallback(
    (topicName: string) => {
      void navigate(`/agents/${agentId}/graph/${topicName}`);
    },
    [agentId, navigate]
  );

  const handleBackToOverview = useCallback(() => {
    void navigate(`/agents/${agentId}/graph`);
  }, [agentId, navigate]);

  return (
    <ErrorBoundary fallbackMessage="The graph could not be rendered.">
      <div className="flex h-full flex-col overflow-hidden">
        <PanelHeader
          title={isTopicDetail ? `Topic: ${topicId}` : 'Agent Graph'}
          actions={
            isTopicDetail ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 text-gray-600 hover:bg-gray-300/50 hover:text-gray-900 dark:text-[#cccccc] dark:hover:bg-[#454646] dark:hover:text-white"
                onClick={handleBackToOverview}
                title="Back to overview"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            ) : null
          }
        />

        <div className="relative flex-1">
          <SharedGraph
            ast={ast}
            topicId={topicId}
            theme={theme}
            onTopicOpen={handleTopicOpen}
            onActionClick={openActionDrawer}
            onConditionalClick={payload =>
              openGraphDrawer({
                type: 'conditional',
                data: {
                  conditionText: payload.conditionText,
                  sourceTopicName: payload.sourceTopicName,
                  conditionalKey: payload.conditionalKey,
                },
              })
            }
            onNodeClick={payload => {
              if (payload.topicName) {
                const prefix = payload.isStartAgent ? 'start_agent' : 'topic';
                setSelectedNodeId(`${prefix}-${payload.topicName}`);
              }
              if (isTopicDetail && payload.nodeType !== 'reasoning-group') {
                openGraphDrawer({
                  type: 'node',
                  data: {
                    nodeId: payload.nodeId,
                    nodeType: payload.data.nodeType,
                    label: payload.data.label,
                    subtitle: payload.data.subtitle,
                    topicName: payload.data.topicName,
                    conditionText: payload.data.conditionText,
                    conditionLabel: payload.data.conditionLabel,
                    transitionTarget: payload.data.transitionTarget,
                    phaseType: payload.data.phaseType,
                    actionNames: payload.data.actionNames,
                    actionKeys: payload.data.actionKeys,
                    isEmpty: payload.data.isEmpty,
                  },
                });
              }
            }}
            onPaneClick={closeGraphDrawer}
          />
          <GraphDrawer />
        </div>
      </div>
    </ErrorBoundary>
  );
}
