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
import { Button } from '~/components/ui/button';
import logo from '~/assets/logo.png';

interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

declare const __AGENTSCRIPT_PACKAGE_VERSIONS__: Record<string, string>;

const packageVersions: Record<string, string> =
  __AGENTSCRIPT_PACKAGE_VERSIONS__;

/** Standalone About dialog (renders its own Dialog root). */
export function AboutDialog({ open, onOpenChange }: AboutDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AboutDialogContent />
    </Dialog>
  );
}

/** About dialog content — use inside an existing Dialog root. */
export function AboutDialogContent() {
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <DialogContent
      className="max-w-sm gap-0 overflow-hidden p-0"
      aria-describedby={undefined}
      onOpenAutoFocus={e => e.preventDefault()}
      onCloseAutoFocus={e => e.preventDefault()}
    >
      <DialogHeader className="sr-only">
        <DialogTitle>About AgentScript</DialogTitle>
      </DialogHeader>

      {/* Brand */}
      <div className="flex flex-col items-center gap-3 px-6 pt-8 pb-2">
        <img src={logo} alt="AgentScript" className="size-12" />
        <div className="text-center">
          <h2 className="text-lg font-semibold tracking-tight">AgentScript</h2>
          <p className="text-xs text-muted-foreground">
            Built by the AgentScript team at Salesforce
          </p>
        </div>
      </div>

      {/* Support */}
      <div className="px-6 pt-4 pb-2 text-center text-xs text-muted-foreground">
        <p>
          Questions? Open an issue on{' '}
          <span className="font-medium text-foreground">GitHub</span> or start a{' '}
          <span className="font-medium text-foreground">Discussion</span>
        </p>
      </div>

      {/* Versions */}
      <div className="px-6 pt-2 pb-4">
        <p className="mb-1.5 px-2 text-xs font-medium text-muted-foreground">
          Package Versions
        </p>
        <div className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border p-1">
          {Object.entries(packageVersions).map(([name, version]) => (
            <div
              key={name}
              className="flex items-center justify-between rounded px-2 py-1.5"
            >
              <span className="font-mono text-[11px] text-muted-foreground">
                {name}
              </span>
              <Badge variant="secondary" className="font-mono text-[10px]">
                v{version}
              </Badge>
            </div>
          ))}
        </div>
      </div>

      {/* Reset */}
      <div className="border-t px-6 py-3">
        {!confirmReset ? (
          <button
            onClick={() => setConfirmReset(true)}
            className="w-full text-center text-[11px] text-muted-foreground transition-colors hover:text-destructive"
          >
            Reset all data&hellip;
          </button>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <p className="text-[11px] text-muted-foreground">
              This will clear all agents and settings. This cannot be undone.
            </p>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setConfirmReset(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  localStorage.clear();
                  const base = import.meta.env.BASE_URL || '/';
                  window.location.href = `${base}agents`.replace('//', '/');
                }}
              >
                Reset Everything
              </Button>
            </div>
          </div>
        )}
      </div>
    </DialogContent>
  );
}
