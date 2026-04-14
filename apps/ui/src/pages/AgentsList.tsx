/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useAgentStore } from '~/store/agentStore';
import { Button } from '~/components/ui/button';
import { Badge } from '~/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import {
  Plus,
  Trash2,
  Search,
  LayoutGrid,
  List,
  ArrowUpDown,
  MoreHorizontal,
  Copy,
  Bot,
  Sparkles,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

type SortOption = 'modified' | 'created' | 'name';
type ViewMode = 'grid' | 'list';

export function AgentsList() {
  const navigate = useNavigate();
  const { createAgent, getAllAgents, deleteAgent } = useAgentStore();
  const agents = getAllAgents();
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('modified');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  const filteredAgents = useMemo(() => {
    let result = agents;

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(agent => {
        const name = (agent.name || '').toLowerCase();
        const description = (agent.description || '').toLowerCase();
        return name.includes(query) || description.includes(query);
      });
    }

    return [...result].sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return (a.name || '').localeCompare(b.name || '');
        case 'created':
          return b.createdAt.getTime() - a.createdAt.getTime();
        case 'modified':
        default:
          return b.lastModified.getTime() - a.lastModified.getTime();
      }
    });
  }, [agents, searchQuery, sortBy]);

  const handleCreateAgent = () => {
    const id = createAgent();
    void navigate(`/agents/${id}/script`);
  };

  const handleDuplicateAgent = (agentId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return;
    const newId = createAgent(`${agent.name} (copy)`);
    const store = useAgentStore.getState();
    store.updateAgent(newId, {
      content: agent.content,
      description: agent.description,
    });
  };

  const handleDeleteAgent = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this agent?')) {
      deleteAgent(id);
    }
  };

  const sortLabel: Record<SortOption, string> = {
    modified: 'Last modified',
    created: 'Date created',
    name: 'Name',
  };

  return (
    <div className="flex h-full w-full flex-col">
      {/* Header */}
      <div className="border-b px-6 pt-6 pb-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight">My Agents</h1>
              {agents.length > 0 && (
                <Badge variant="secondary" className="tabular-nums">
                  {agents.length}
                </Badge>
              )}
            </div>
            <p className="text-muted-foreground mt-1 text-sm">
              Create and manage your AgentScript projects
            </p>
          </div>
          <Button onClick={handleCreateAgent} size="lg">
            <Plus className="mr-2 h-4 w-4" />
            New Agent
          </Button>
        </div>

        {/* Toolbar: search + sort + view toggle */}
        {agents.length > 0 && (
          <div className="mt-4 flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="text-muted-foreground pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search agents..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="bg-card border-input placeholder:text-muted-foreground focus:ring-ring w-full rounded-md border py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-2"
              />
            </div>

            {/* Sort dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 gap-1.5"
                >
                  <ArrowUpDown className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{sortLabel[sortBy]}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setSortBy('modified')}>
                  Last modified
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortBy('created')}>
                  Date created
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSortBy('name')}>
                  Name
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* View toggle */}
            <div className="border-input flex shrink-0 rounded-md border">
              <button
                onClick={() => setViewMode('grid')}
                className={`rounded-l-md p-2 transition-colors ${
                  viewMode === 'grid'
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`rounded-r-md border-l p-2 transition-colors ${
                  viewMode === 'list'
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <List className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {agents.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <div className="bg-primary/10 mb-6 rounded-2xl p-5">
              <Sparkles className="text-primary h-10 w-10" />
            </div>
            <h2 className="mb-2 text-xl font-semibold">
              Create your first agent
            </h2>
            <p className="text-muted-foreground mb-6 max-w-sm text-sm">
              Build AI agents with natural language. Define topics, actions, and
              conversation flows.
            </p>
            <Button onClick={handleCreateAgent} size="lg">
              <Plus className="mr-2 h-4 w-4" />
              New Agent
            </Button>
          </div>
        ) : filteredAgents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Search className="text-muted-foreground mb-4 h-10 w-10 opacity-50" />
            <p className="text-muted-foreground text-sm">
              No agents matching &ldquo;{searchQuery}&rdquo;
            </p>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filteredAgents.map(agent => (
              <div
                key={agent.id}
                onClick={() => void navigate(`/agents/${agent.id}/script`)}
                className="bg-card hover:border-primary/50 group relative cursor-pointer rounded-lg border p-5 transition-all hover:shadow-md"
              >
                {/* Top row: icon + menu */}
                <div className="mb-3 flex items-center justify-between">
                  <div className="bg-primary/10 rounded-lg p-2">
                    <Bot className="text-primary h-4 w-4" />
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        onClick={e => e.stopPropagation()}
                        className="text-muted-foreground hover:text-foreground rounded-md p-1 opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={e =>
                          handleDuplicateAgent(
                            agent.id,
                            e as unknown as React.MouseEvent
                          )
                        }
                      >
                        <Copy className="mr-2 h-4 w-4" />
                        Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={e =>
                          handleDeleteAgent(
                            agent.id,
                            e as unknown as React.MouseEvent
                          )
                        }
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                {/* Name */}
                <h3 className="mb-1 truncate text-sm font-semibold">
                  {agent.name || 'Untitled Agent'}
                </h3>

                {/* Description or placeholder */}
                <p className="text-muted-foreground mb-3 line-clamp-2 min-h-10 text-xs leading-relaxed">
                  {agent.description || 'No description'}
                </p>

                {/* Timestamp */}
                <p className="text-muted-foreground/70 text-[11px]">
                  {formatDistanceToNow(agent.lastModified, { addSuffix: true })}
                </p>
              </div>
            ))}

            {/* New agent card */}
            <button
              onClick={handleCreateAgent}
              className="border-border hover:border-primary/50 hover:bg-card flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed p-5 transition-all"
            >
              <div className="bg-muted mb-2 rounded-lg p-2">
                <Plus className="text-muted-foreground h-4 w-4" />
              </div>
              <span className="text-muted-foreground text-xs font-medium">
                New Agent
              </span>
            </button>
          </div>
        ) : (
          /* List view */
          <div className="rounded-lg border">
            {filteredAgents.map((agent, idx) => (
              <div
                key={agent.id}
                onClick={() => void navigate(`/agents/${agent.id}/script`)}
                className={`hover:bg-accent/50 group flex cursor-pointer items-center gap-4 px-4 py-3 transition-colors ${
                  idx !== 0 ? 'border-t' : ''
                }`}
              >
                <div className="bg-primary/10 shrink-0 rounded-lg p-2">
                  <Bot className="text-primary h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="truncate text-sm font-medium">
                    {agent.name || 'Untitled Agent'}
                  </h3>
                  {agent.description && (
                    <p className="text-muted-foreground mt-0.5 truncate text-xs">
                      {agent.description}
                    </p>
                  )}
                </div>
                <span className="text-muted-foreground/70 hidden shrink-0 text-xs sm:block">
                  {formatDistanceToNow(agent.lastModified, { addSuffix: true })}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      onClick={e => e.stopPropagation()}
                      className="text-muted-foreground hover:text-foreground shrink-0 rounded-md p-1 opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={e =>
                        handleDuplicateAgent(
                          agent.id,
                          e as unknown as React.MouseEvent
                        )
                      }
                    >
                      <Copy className="mr-2 h-4 w-4" />
                      Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={e =>
                        handleDeleteAgent(
                          agent.id,
                          e as unknown as React.MouseEvent
                        )
                      }
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
