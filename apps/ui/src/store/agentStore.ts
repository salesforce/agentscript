/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { init } from '@paralleldrive/cuid2';
import type { EditorSelection } from './source';

// Create a custom ID generator with 8 character length
const createId = init({ length: 8 });

export interface Agent {
  id: string;
  name: string;
  description?: string; // Optional description from config.description
  content: string; // Agent script content stored in localStorage
  lastModified: Date;
  createdAt: Date;
  editorSelection?: EditorSelection; // Optional - cursor position and selection
}

interface AgentState {
  agents: Record<string, Agent>;
}

interface AgentActions {
  createAgent: (name?: string) => string;
  createAgentWithId: (id: string, name?: string) => string;
  getAgent: (id: string) => Agent | undefined;
  updateAgent: (id: string, updates: Partial<Omit<Agent, 'id'>>) => void;
  updateAgentContent: (id: string, content: string) => void;
  updateAgentSelection: (id: string, selection: EditorSelection | null) => void;
  deleteAgent: (id: string) => void;
  getAllAgents: () => Agent[];
}

export type AgentStore = AgentState & AgentActions;

// Agent state is stored client-side in localStorage.
export const useAgentStore = create<AgentStore>()(
  persist(
    (set, get) => ({
      agents: {},

      createAgent: (name = 'Untitled Agent') => {
        // Generate 8-character cuid2 for agent ID
        const id = createId();
        const now = new Date();
        const agent: Agent = {
          id,
          name,
          content: '', // Initialize with empty content
          lastModified: now,
          createdAt: now,
        };
        set(state => ({
          agents: { ...state.agents, [id]: agent },
        }));
        return id;
      },

      createAgentWithId: (id: string, name = 'Untitled Agent') => {
        // Create agent with a specific ID (useful for deterministic IDs)
        const now = new Date();
        const agent: Agent = {
          id,
          name,
          content: '', // Initialize with empty content
          lastModified: now,
          createdAt: now,
        };
        set(state => ({
          agents: { ...state.agents, [id]: agent },
        }));
        return id;
      },

      getAgent: (id: string) => {
        return get().agents[id];
      },

      updateAgent: (id: string, updates: Partial<Omit<Agent, 'id'>>) => {
        set(state => {
          const agent = state.agents[id];
          if (!agent) return state;

          return {
            agents: {
              ...state.agents,
              [id]: {
                ...agent,
                ...updates,
                lastModified: new Date(),
              },
            },
          };
        });
      },

      updateAgentContent: (id: string, content: string) => {
        set(state => {
          const agent = state.agents[id];
          if (!agent) return state;

          return {
            agents: {
              ...state.agents,
              [id]: {
                ...agent,
                content,
                lastModified: new Date(),
              },
            },
          };
        });
      },

      updateAgentSelection: (id: string, selection: EditorSelection | null) => {
        set(state => {
          const agent = state.agents[id];
          if (!agent) return state;

          return {
            agents: {
              ...state.agents,
              [id]: {
                ...agent,
                editorSelection: selection || undefined,
                // Don't update lastModified for selection changes
              },
            },
          };
        });
      },

      deleteAgent: (id: string) => {
        set(state => {
          const { [id]: _, ...rest } = state.agents;
          return { agents: rest };
        });
      },

      getAllAgents: () => {
        return Object.values(get().agents).sort(
          (a, b) => b.lastModified.getTime() - a.lastModified.getTime()
        );
      },
    }),
    {
      name: 'agent-storage',
      storage: createJSONStorage(() => localStorage),
      // Custom serializer to handle Date objects
      partialize: state => ({
        agents: Object.fromEntries(
          Object.entries(state.agents).map(([id, agent]) => [
            id,
            {
              ...agent,
              content: agent.content, // Store content in localStorage
              lastModified: agent.lastModified.toISOString(),
              createdAt: agent.createdAt.toISOString(),
            },
          ])
        ),
      }),
      // Custom deserializer to parse Date objects
      merge: (persistedState: unknown, currentState: AgentStore) => {
        interface PersistedAgent {
          id: string;
          name: string;
          content: string;
          lastModified: string;
          createdAt: string;
          editorSelection?: EditorSelection;
        }

        interface PersistedState {
          agents?: Record<string, PersistedAgent>;
        }

        const typedPersisted = persistedState as
          | PersistedState
          | null
          | undefined;
        if (!typedPersisted?.agents) return currentState;

        const agents = Object.fromEntries(
          Object.entries(typedPersisted.agents).map(
            ([id, agent]: [string, PersistedAgent]) => [
              id,
              {
                ...agent,
                content: agent.content || '', // Ensure content exists
                lastModified: new Date(agent.lastModified),
                createdAt: new Date(agent.createdAt),
              },
            ]
          )
        );

        return {
          ...currentState,
          agents,
        };
      },
    }
  )
);
