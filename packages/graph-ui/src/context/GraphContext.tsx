/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { createContext, useContext, type ReactNode } from 'react';

export interface ActionClickPayload {
  actionDisplayName: string;
  actionIndex: number;
  topicName: string | undefined;
  sourceRange?: import('../ast/ast-to-graph').SourceRange;
}

export interface ConditionalClickPayload {
  edgeId: string;
  conditionText: string;
  sourceTopicName: string;
  conditionalKey: string;
}

export interface GraphContextValue {
  /** Edge IDs to highlight on the current path; null when no selection. */
  highlightedEdgeIds: Set<string> | null;
  /** Host callback when an LLM action pill is clicked. */
  onActionClick?: (payload: ActionClickPayload) => void;
  /** Host callback when a conditional edge label is clicked. */
  onConditionalClick?: (payload: ConditionalClickPayload) => void;
}

const GraphContext = createContext<GraphContextValue>({
  highlightedEdgeIds: null,
});

export function GraphContextProvider({
  value,
  children,
}: {
  value: GraphContextValue;
  children: ReactNode;
}) {
  return (
    <GraphContext.Provider value={value}>{children}</GraphContext.Provider>
  );
}

export function useGraphContext(): GraphContextValue {
  return useContext(GraphContext);
}
