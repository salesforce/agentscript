/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

export { extractGraph } from './extractor.js';
export type {
  GraphNode,
  GraphEdge,
  ExtractedGraph,
  EdgeProvenance,
} from './extractor.js';

export { getGraph } from './get-graph.js';
export type { Graph, ProtocolNode, ProtocolEdge } from './get-graph.js';
