/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router';
import {
  VscSymbolNamespace,
  VscDebugAltSmall,
  VscGear,
  VscInfo,
  VscColorMode,
  VscListFlat,
  VscTypeHierarchySub,
  VscExtensions,
} from 'react-icons/vsc';
import { IoLaptop, IoMoon, IoSunny } from 'react-icons/io5';
import { cn } from '~/lib/utils';
import { Button } from '~/components/ui/button';
import { Dialog } from '~/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import { useAppStore } from '~/store';
import { SettingsDialogContent } from '~/components/SettingsDialog';
import { AboutDialogContent } from '~/components/AboutDialog';
import { nodeIdToBuilderPath } from '~/components/explorer/astToTreeData';
import { featureFlags } from '~/lib/feature-flags';

// Default navigation buttons for agent pages
const allNavButtons = [
  { route: '/script', icon: VscSymbolNamespace, label: 'Script', flag: null },
  {
    route: '/builder',
    icon: VscListFlat,
    label: 'Builder',
    flag: 'builder' as const,
  },
  { route: '/graph', icon: VscTypeHierarchySub, label: 'Graph', flag: null },
  {
    route: '/simulate',
    icon: VscDebugAltSmall,
    label: 'Simulate',
    flag: 'simulate' as const,
  },
  { route: '/component', icon: VscExtensions, label: 'Component', flag: null },
];

const defaultNavButtons = allNavButtons.filter(
  btn => btn.flag === null || featureFlags[btn.flag]
);

export function NavBar() {
  const { agentId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useAppStore(state => state.theme.theme);
  const setTheme = useAppStore(state => state.setTheme);
  const uiTheme = useAppStore(state => state.theme.uiTheme);
  const setUiTheme = useAppStore(state => state.setUiTheme);
  const selectedNodeId = useAppStore(state => state.layout.selectedNodeId);
  // Which dialog (if any) is open from the settings menu.
  // Using a single state avoids multiple Dialog roots fighting over aria-hidden.
  const [activeDialog, setActiveDialog] = useState<'settings' | 'about' | null>(
    null
  );

  // Construct routes with agentId when available
  const getRoute = (baseRoute: string) => {
    if (agentId) {
      return `/agents/${agentId}${baseRoute}`;
    }
    return baseRoute;
  };

  /**
   * Build a route that carries the current explorer selection into the target view.
   * - Builder: appends the full selectedNodeId as :nodeId
   * - Graph: appends the topic name as :topicId (only for topic/start_agent/action nodes)
   * - Script / Simulate: base route (Script scrolls to selection on mount)
   */
  const getRouteWithSelection = (baseRoute: string) => {
    if (!agentId || !selectedNodeId) return getRoute(baseRoute);

    if (baseRoute === '/builder') {
      return `/agents/${agentId}/builder/${nodeIdToBuilderPath(selectedNodeId)}`;
    }

    if (baseRoute === '/graph') {
      // Extract topic name from various node ID formats
      let topicName: string | undefined;
      if (
        selectedNodeId.startsWith('topic-') ||
        selectedNodeId.startsWith('start_agent-')
      ) {
        topicName = selectedNodeId.replace(/^(topic|start_agent)-/, '');
      } else if (selectedNodeId.includes('-action-')) {
        topicName = selectedNodeId.split('-action-')[0];
      }
      if (topicName) {
        return `/agents/${agentId}/graph/${topicName}`;
      }
    }

    return getRoute(baseRoute);
  };

  const handleThemeChange = (newTheme: 'system' | 'light' | 'dark') => {
    setTheme(newTheme);
  };

  const handleUiThemeChange = (newUiTheme: 'code' | 'visual') => {
    setUiTheme(newUiTheme);
  };

  const themeOptions = [
    { value: 'system', label: 'System', icon: IoLaptop },
    { value: 'light', label: 'Light', icon: IoSunny },
    { value: 'dark', label: 'Dark', icon: IoMoon },
  ] as const;

  const uiThemeOptions = [
    { value: 'code', label: 'IDE' },
    { value: 'visual', label: 'Visual' },
  ] as const;

  return (
    <nav className="flex w-11 flex-col bg-[#fafafd] border-r border-r-[#f1f1f2] pb-1 pt-4 text-[#616161] dark:bg-[#191a1b] dark:border-r dark:border-r-[#2a2b2c] dark:text-[#7b7b7b]">
      {/* Navigation buttons */}
      <div className="flex flex-col gap-5">
        {defaultNavButtons.map(({ route, icon: Icon, label }) => {
          const isActive = location.pathname.includes(route);
          return (
            <button
              key={route}
              onClick={() => {
                // Component page is standalone — navigate without agentId
                if (route === '/component') {
                  void navigate('/agents/component/actions');
                  return;
                }
                if (!agentId) return;
                void navigate(getRouteWithSelection(route));
              }}
              className={cn(
                'flex items-center justify-center border-l-2 py-1 text-[#616161] hover:text-[#292929] dark:text-[#858585] dark:hover:text-[#bfbfbf]',
                isActive
                  ? 'border-[#292929] text-[#292929] dark:border-[#bfbfbf] dark:text-[#bfbfbf]'
                  : 'border-transparent',
                !agentId &&
                  route !== '/component' &&
                  'pointer-events-none opacity-40'
              )}
              title={label}
            >
              <Icon className="h-6 w-6 -ml-0.5" />
            </button>
          );
        })}
      </div>
      <div className="flex-1" /> {/* Spacer */}
      <div className="flex flex-col items-center gap-5 pb-4">
        {/* Settings Menu — Dialog wraps DropdownMenu so Radix coordinates
            focus/aria-hidden between the two layers (see radix-ui#1836). */}
        <Dialog
          open={activeDialog !== null}
          onOpenChange={open => {
            if (!open) setActiveDialog(null);
          }}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost-nav"
                size="nav-icon"
                className="h-auto w-auto cursor-pointer text-[#616161] hover:text-[#292929] focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 data-[state=open]:text-[#292929] dark:text-[#858585] dark:hover:text-[#bfbfbf] dark:data-[state=open]:text-[#bfbfbf]"
                aria-label="Settings menu"
              >
                <VscGear className="h-6! w-6!" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="end">
              {featureFlags.settingsDialog && (
                <>
                  <DropdownMenuItem
                    onSelect={() => setActiveDialog('settings')}
                  >
                    <VscGear />
                    <span>Settings</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <IoSunny />
                  <span>Brightness</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {themeOptions.map(option => {
                    const Icon = option.icon;
                    const isSelected = theme === option.value;
                    return (
                      <DropdownMenuItem
                        key={option.value}
                        onClick={() => handleThemeChange(option.value)}
                      >
                        <Icon />
                        <span>{option.label}</span>
                        {isSelected && (
                          <span className="ml-auto text-sm">✓</span>
                        )}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              {featureFlags.uiThemeSwitcher && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <VscColorMode />
                    <span>UI Theme</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {uiThemeOptions.map(option => {
                      const isSelected = uiTheme === option.value;
                      return (
                        <DropdownMenuItem
                          key={option.value}
                          onClick={() => handleUiThemeChange(option.value)}
                        >
                          <span>{option.label}</span>
                          {isSelected && (
                            <span className="ml-auto text-sm">✓</span>
                          )}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setActiveDialog('about')}>
                <VscInfo />
                <span>About</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {activeDialog === 'settings' && <SettingsDialogContent />}
          {activeDialog === 'about' && <AboutDialogContent />}
        </Dialog>
      </div>
    </nav>
  );
}
