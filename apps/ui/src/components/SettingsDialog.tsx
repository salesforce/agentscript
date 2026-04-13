/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Badge } from '~/components/ui/badge';
import { cn } from '~/lib/utils';
declare const __AGENTSCRIPT_PACKAGE_VERSIONS__: Record<string, string>;
const packageVersions = __AGENTSCRIPT_PACKAGE_VERSIONS__;

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type SettingsSection = 'version' | 'general';

const sections: { id: SettingsSection; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'version', label: 'Version' },
];

/** Standalone Settings dialog (renders its own Dialog root). */
export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <SettingsDialogContent />
    </Dialog>
  );
}

/** Settings dialog content — use inside an existing Dialog root. */
export function SettingsDialogContent() {
  const [activeSection, setActiveSection] =
    useState<SettingsSection>('general');

  return (
    <DialogContent className="w-[70vw] max-w-300 sm:max-w-300 p-0 gap-0">
      <DialogHeader className="px-6 pt-6 pb-4 border-b">
        <DialogTitle>Settings</DialogTitle>
      </DialogHeader>

      <div className="flex h-125">
        {/* Left Navigation Panel */}
        <div className="w-48 border-r bg-muted/30 p-4">
          <nav className="space-y-1">
            {sections.map(section => (
              <button
                key={section.id}
                onClick={() => setActiveSection(section.id)}
                className={cn(
                  'w-full text-left px-3 py-2 text-sm rounded-md transition-colors',
                  activeSection === section.id
                    ? 'bg-background text-foreground font-medium shadow-sm'
                    : 'text-muted-foreground hover:text-foreground hover:bg-background/50'
                )}
              >
                {section.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Right Content Panel */}
        <div className="flex-1 p-6 overflow-y-auto">
          {activeSection === 'general' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-1">General Settings</h3>
                <p className="text-sm text-muted-foreground">
                  Configure general application preferences
                </p>
              </div>
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  General settings will be added here as needed.
                </p>
              </div>
            </div>
          )}

          {activeSection === 'version' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-1">
                  Version Information
                </h3>
                <p className="text-sm text-muted-foreground">
                  Current versions of core dependencies
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium">
                      AgentScript Parser
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Parser and grammar
                    </div>
                  </div>
                  <Badge variant="secondary" className="font-mono">
                    v{packageVersions['@agentscript/parser'] ?? 'unknown'}
                  </Badge>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </DialogContent>
  );
}
