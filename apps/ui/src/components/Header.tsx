/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useEffect, useState } from 'react';
import { Link, useParams, useLocation, useNavigate } from 'react-router';
import {
  Search,
  PanelLeft,
  PanelRight,
  PanelBottom,
  Code2,
  ListTree,
  Network,
  Play,
  Package,
  Settings,
  Sun,
  Moon,
  Laptop,
  Info,
  Palette,
  ChevronRight,
} from 'lucide-react';
import { useAgentStore } from '~/store/agentStore';
import { useAppStore } from '~/store';
import { Button } from './ui/button';
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
import { Dialog } from '~/components/ui/dialog';
import logo from '~/assets/logo.png';
import { AgentCommandBar } from './AgentCommandBar';
import { SettingsDialogContent } from '~/components/SettingsDialog';
import { AboutDialogContent } from '~/components/AboutDialog';
import { nodeIdToBuilderPath } from '~/components/explorer/astToTreeData';
import { featureFlags } from '~/lib/feature-flags';
import { cn } from '~/lib/utils';

const allNavTabs = [
  { route: '/script', icon: Code2, label: 'Script', flag: null },
  {
    route: '/builder',
    icon: ListTree,
    label: 'Builder',
    flag: 'builder' as const,
  },
  { route: '/graph', icon: Network, label: 'Graph', flag: null },
  {
    route: '/simulate',
    icon: Play,
    label: 'Simulate',
    flag: 'simulate' as const,
  },
  { route: '/component', icon: Package, label: 'Component', flag: null },
];

const navTabs = allNavTabs.filter(t => t.flag === null || featureFlags[t.flag]);

export function Header() {
  const { agentId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const isStandaloneComponent =
    !agentId && location.pathname.includes('/component');
  const isScriptView = location.pathname.includes('/script');
  const isComponentView = location.pathname.includes('/component');
  const agent = useAgentStore(state =>
    agentId ? state.agents[agentId] : null
  );
  const [commandBarOpen, setCommandBarOpen] = useState(false);
  const [activeDialog, setActiveDialog] = useState<'settings' | 'about' | null>(
    null
  );

  const showLeftPanel = useAppStore(state => state.layout.showLeftPanel);
  const showRightPanel = useAppStore(state => state.layout.showRightPanel);
  const showBottomPanel = useAppStore(state => state.layout.showBottomPanel);
  const toggleLeftPanel = useAppStore(state => state.toggleLeftPanel);
  const toggleRightPanel = useAppStore(state => state.toggleRightPanel);
  const toggleBottomPanel = useAppStore(state => state.toggleBottomPanel);
  const selectedNodeId = useAppStore(state => state.layout.selectedNodeId);
  const theme = useAppStore(state => state.theme.theme);
  const setTheme = useAppStore(state => state.setTheme);
  const uiTheme = useAppStore(state => state.theme.uiTheme);
  const setUiTheme = useAppStore(state => state.setUiTheme);

  const currentAgentName = agent?.name || 'Untitled Agent';

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

  const getRouteWithSelection = (baseRoute: string) => {
    if (baseRoute === '/component') {
      return agentId
        ? `/agents/${agentId}/component/actions`
        : '/agents/component/actions';
    }
    if (!agentId) return baseRoute;

    if (!selectedNodeId) return `/agents/${agentId}${baseRoute}`;

    if (baseRoute === '/builder') {
      return `/agents/${agentId}/builder/${nodeIdToBuilderPath(selectedNodeId)}`;
    }

    if (baseRoute === '/graph') {
      let topicName: string | undefined;
      if (
        selectedNodeId.startsWith('topic-') ||
        selectedNodeId.startsWith('start_agent-')
      ) {
        topicName = selectedNodeId.replace(/^(topic|start_agent)-/, '');
      } else if (selectedNodeId.includes('-action-')) {
        topicName = selectedNodeId.split('-action-')[0];
      }
      if (topicName) return `/agents/${agentId}/graph/${topicName}`;
    }

    return `/agents/${agentId}${baseRoute}`;
  };

  const themeOptions = [
    { value: 'system', label: 'System', icon: Laptop },
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
  ] as const;

  const uiThemeOptions = [
    { value: 'code', label: 'IDE' },
    { value: 'visual', label: 'Visual' },
  ] as const;

  const showNavTabs = Boolean(agentId) || isStandaloneComponent;

  return (
    <header
      className="flex h-12 w-full shrink-0 items-center gap-4 border-b px-4 rounded-b-xl"
      style={{
        background: 'var(--ide-surface-elevated)',
        borderColor: 'var(--ide-border-subtle)',
        color: 'var(--ide-text-primary)',
      }}
    >
      {/* Brand + breadcrumb */}
      <Link to="/agents" className="flex items-center gap-2 shrink-0 group">
        <img src={logo} alt="" className="h-5 w-5" />
        <span className="text-sm font-semibold tracking-tight">
          AgentScript
        </span>
      </Link>

      {agentId && (
        <div
          className="flex items-center gap-1.5 text-sm shrink-0"
          style={{ color: 'var(--ide-text-muted)' }}
        >
          <ChevronRight className="h-3.5 w-3.5 opacity-60" />
          <span
            className="truncate max-w-56"
            style={{ color: 'var(--ide-text-primary)' }}
          >
            {currentAgentName}
          </span>
        </div>
      )}

      {/* Nav tabs as segmented control */}
      {showNavTabs && (
        <nav
          className="flex items-center gap-0.5 ml-2 rounded-full border p-0.5"
          style={{
            background: 'var(--ide-surface-sunken)',
            borderColor: 'var(--ide-border-subtle)',
          }}
        >
          {navTabs.map(({ route, icon: Icon, label }) => {
            const isActive = location.pathname.includes(route);
            const disabled = !agentId && route !== '/component';
            return (
              <button
                key={route}
                disabled={disabled}
                onClick={() => {
                  void navigate(getRouteWithSelection(route));
                }}
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-all duration-150',
                  'disabled:opacity-40 disabled:pointer-events-none'
                )}
                style={{
                  color: isActive
                    ? 'var(--ide-text-primary)'
                    : 'var(--ide-text-muted)',
                  background: isActive
                    ? 'var(--ide-surface-elevated)'
                    : 'transparent',
                  boxShadow: isActive
                    ? '0 1px 2px rgba(0,0,0,0.06), 0 0 0 1px var(--ide-border-subtle)'
                    : 'none',
                }}
                title={label}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{label}</span>
              </button>
            );
          })}
        </nav>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Command pill */}
      <div className="relative w-full max-w-sm">
        <button
          onClick={() => setCommandBarOpen(true)}
          className="flex h-8 w-full items-center gap-2 rounded-full border px-3.5 text-xs transition-colors duration-150"
          style={{
            background: 'var(--ide-surface)',
            borderColor: 'var(--ide-border-subtle)',
            color: 'var(--ide-text-muted)',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = 'var(--ide-border-strong)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = 'var(--ide-border-subtle)';
          }}
        >
          <Search className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate flex-1 text-left">
            {agentId ? `Jump to…` : 'Search agents…'}
          </span>
          <kbd
            className="hidden sm:inline-flex h-4.5 items-center rounded border px-1.5 text-[10px] font-mono tabular-nums"
            style={{
              borderColor: 'var(--ide-border-subtle)',
              color: 'var(--ide-text-subtle)',
            }}
          >
            ⌘P
          </kbd>
        </button>
        <AgentCommandBar
          open={commandBarOpen}
          onOpenChange={setCommandBarOpen}
          currentAgentId={agentId}
        />
      </div>

      {/* Right cluster: panel toggles + settings */}
      <div className="flex items-center gap-0.5 shrink-0">
        {agentId && (
          <IconButton
            onClick={toggleLeftPanel}
            title={showLeftPanel ? 'Hide Explorer' : 'Show Explorer'}
            active={showLeftPanel}
          >
            <PanelLeft className="h-4 w-4" />
          </IconButton>
        )}
        {(agentId || isStandaloneComponent) && (
          <IconButton
            onClick={toggleBottomPanel}
            title={showBottomPanel ? 'Hide Panel' : 'Show Panel'}
            active={showBottomPanel}
          >
            <PanelBottom className="h-4 w-4" />
          </IconButton>
        )}
        {(isScriptView || isComponentView) && (
          <IconButton
            onClick={toggleRightPanel}
            title={showRightPanel ? 'Hide Debug Panel' : 'Show Debug Panel'}
            active={showRightPanel}
          >
            <PanelRight className="h-4 w-4" />
          </IconButton>
        )}

        <Dialog
          open={activeDialog !== null}
          onOpenChange={open => {
            if (!open) setActiveDialog(null);
          }}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-md"
                style={{ color: 'var(--ide-text-muted)' }}
                aria-label="Settings menu"
              >
                <Settings className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="bottom" align="end">
              {featureFlags.settingsDialog && (
                <>
                  <DropdownMenuItem
                    onSelect={() => setActiveDialog('settings')}
                  >
                    <Settings />
                    <span>Settings</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <Sun />
                  <span>Brightness</span>
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {themeOptions.map(option => {
                    const Icon = option.icon;
                    const isSelected = theme === option.value;
                    return (
                      <DropdownMenuItem
                        key={option.value}
                        onClick={() => setTheme(option.value)}
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
                    <Palette />
                    <span>UI Theme</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {uiThemeOptions.map(option => {
                      const isSelected = uiTheme === option.value;
                      return (
                        <DropdownMenuItem
                          key={option.value}
                          onClick={() => setUiTheme(option.value)}
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
                <Info />
                <span>About</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {activeDialog === 'settings' && <SettingsDialogContent />}
          {activeDialog === 'about' && <AboutDialogContent />}
        </Dialog>
      </div>
    </header>
  );
}

function IconButton({
  children,
  onClick,
  title,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-150"
      style={{
        color: active ? 'var(--ide-text-primary)' : 'var(--ide-text-muted)',
        background: active ? 'var(--ide-surface-hover)' : 'transparent',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.background = 'var(--ide-surface-hover)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.background = active
          ? 'var(--ide-surface-hover)'
          : 'transparent';
      }}
    >
      {children}
    </button>
  );
}
