/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { PlusIcon } from 'lucide-react';
import { useEffect, useRef, useState, useMemo } from 'react';
import { useNavigate } from 'react-router';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '~/components/ui/command';
import { useAgentStore } from '~/store/agentStore';

interface CommandBarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentAgentId?: string;
}

export function AgentCommandBar({
  open,
  onOpenChange,
  currentAgentId,
}: CommandBarProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const commandRef = useRef<HTMLDivElement>(null);

  // Get all agents from the store
  const getAllAgents = useAgentStore(state => state.getAllAgents);
  const createAgent = useAgentStore(state => state.createAgent);
  const allAgents = useMemo(() => getAllAgents(), [getAllAgents]);

  // Filter agents based on search query
  const filteredAgents = useMemo(() => {
    if (!query.trim()) return allAgents;

    const lowerQuery = query.toLowerCase();
    return allAgents.filter(agent =>
      agent.name.toLowerCase().includes(lowerQuery)
    );
  }, [allAgents, query]);

  // Handle click outside to close
  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (
        commandRef.current &&
        !commandRef.current.contains(event.target as Node)
      ) {
        onOpenChange(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open, onOpenChange]);

  const handleSelect = (agentId: string) => {
    void navigate(`/agents/${agentId}/script`);
    onOpenChange(false);
    setQuery('');
  };

  const handleCreateNew = () => {
    const newAgentId = createAgent('Untitled Agent');
    void navigate(`/agents/${newAgentId}/script`);
    onOpenChange(false);
    setQuery('');
  };

  if (!open) return null;

  return (
    <div className="w-2xl absolute left-1/2 top-0 z-50 -translate-x-1/2 px-4">
      <div
        ref={commandRef}
        className="bg-popover rounded-md border shadow-md dark:bg-[#252526]"
      >
        <Command>
          <CommandInput
            placeholder="Search agents..."
            value={query}
            onValueChange={setQuery}
            autoFocus={true}
          />
          <CommandList>
            <CommandEmpty>No agents found.</CommandEmpty>
            <CommandGroup heading="Actions">
              <CommandItem onSelect={handleCreateNew}>
                <PlusIcon className="mr-2 h-4 w-4" />
                <span>Create New Agent</span>
              </CommandItem>
            </CommandGroup>
            {filteredAgents.length > 0 && (
              <CommandGroup heading="Recent Agents">
                {filteredAgents.map(agent => (
                  <CommandItem
                    key={agent.id}
                    onSelect={() => handleSelect(agent.id)}
                    disabled={agent.id === currentAgentId}
                  >
                    <span className="flex-1">
                      {agent.name || 'Untitled Agent'}
                    </span>
                    {agent.id === currentAgentId && (
                      <span className="text-muted-foreground ml-2 text-xs">
                        Current
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </div>
    </div>
  );
}
