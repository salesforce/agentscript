/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useEffect, useState } from 'react';
import { Link, useParams, useLocation } from 'react-router';
import { PiMagnifyingGlass } from 'react-icons/pi';
import { useAgentStore } from '~/store/agentStore';
import { useAppStore } from '~/store';
import { Button } from './ui/button';
import {
  VscLayoutSidebarLeft,
  VscLayoutSidebarLeftOff,
  VscLayoutPanel,
  VscLayoutPanelOff,
} from 'react-icons/vsc';
import logo from '~/assets/logo.png';
import { AgentCommandBar } from './AgentCommandBar';

export function Header() {
  const { agentId } = useParams();
  const location = useLocation();
  const isStandaloneComponent =
    !agentId && location.pathname.includes('/component');
  // Subscribe to the specific agent so the header updates when the name changes
  const agent = useAgentStore(state =>
    agentId ? state.agents[agentId] : null
  );
  const [commandBarOpen, setCommandBarOpen] = useState(false);

  // Panel state
  const showLeftPanel = useAppStore(state => state.layout.showLeftPanel);
  const showBottomPanel = useAppStore(state => state.layout.showBottomPanel);
  const toggleLeftPanel = useAppStore(state => state.toggleLeftPanel);
  const toggleBottomPanel = useAppStore(state => state.toggleBottomPanel);

  const currentAgentName = agent?.name || 'Untitled Agent';

  // Update browser tab title with agent name
  useEffect(() => {
    if (agentId && agent?.name) {
      document.title = `${agent.name} - AgentScript`;
    } else {
      document.title = 'AgentScript';
    }
    return () => {
      document.title = 'AgentScript';
    };
  }, [agentId, agent?.name]);

  // Keyboard shortcut for command bar (Cmd/Ctrl + P)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'p') {
        event.preventDefault();
        setCommandBarOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <header className="flex h-7 w-full items-center justify-between gap-2 border-b border-[#f1f1f2] bg-[#fafafd] px-2 text-[#606060] dark:border-[#2a2b2c] dark:bg-[#191a1b] dark:text-[#bfbfbf]">
      {/* Left side - Branding */}
      <Link to="/agents" className="flex items-center gap-2">
        <img src={logo} alt="AgentScript Logo" className="h-4 w-4" />
        <span className="text-xs">AgentScript</span>
      </Link>

      {/* Center - Command Bar Trigger */}
      <div className="relative">
        <button
          onClick={() => setCommandBarOpen(true)}
          className="h-5.5 w-lg flex max-w-md cursor-pointer items-center justify-center gap-2 rounded-sm border border-[#e3e3e4] bg-[#ffffff] px-3 text-xs text-[#808080] hover:border-[#e3e3e4] hover:bg-[#f0f0f2] dark:border-[#2f3031] dark:bg-[#272728] dark:text-[#828283] dark:hover:border-[#666666] dark:hover:bg-[#2f2f30] dark:hover:text-[#b0b0b0]"
        >
          <PiMagnifyingGlass />
          <span className="">{currentAgentName || 'Search agents...'}</span>
        </button>
        <AgentCommandBar
          open={commandBarOpen}
          onOpenChange={setCommandBarOpen}
          currentAgentId={agentId}
        />
      </div>

      {/* Right side - Panel toggles (or spacer for balance) */}
      {agentId || isStandaloneComponent ? (
        <div className="flex items-center gap-2">
          {/* Left Panel Toggle (agent pages only) */}
          {agentId && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 hover:bg-gray-300/50 hover:text-gray-900 dark:hover:bg-[#454646] dark:hover:text-white"
              onClick={toggleLeftPanel}
              title={showLeftPanel ? 'Hide Explorer' : 'Show Explorer'}
            >
              {showLeftPanel ? (
                <VscLayoutSidebarLeft className="h-4 w-4" />
              ) : (
                <VscLayoutSidebarLeftOff className="h-4 w-4" />
              )}
            </Button>
          )}

          {/* Bottom Panel Toggle */}
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 hover:bg-gray-300/50 hover:text-gray-900 dark:hover:bg-[#454646] dark:hover:text-white"
            onClick={toggleBottomPanel}
            title={showBottomPanel ? 'Hide Panel' : 'Show Panel'}
          >
            {showBottomPanel ? (
              <VscLayoutPanel className="h-4 w-4" />
            ) : (
              <VscLayoutPanelOff className="h-4 w-4" />
            )}
          </Button>
        </div>
      ) : (
        // Spacer to balance the header layout when on agents list
        <div className="flex items-center gap-2">
          <div className="w-5" />
          <div className="w-5" />
          <div className="w-5" />
        </div>
      )}
    </header>
  );
}
