/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { DiagnosticSeverity } from '@agentscript/types';
import type { Diagnostic } from '@agentscript/types';
import { cn } from '~/lib/utils';
import { CircleAlert, TriangleAlert, Info } from 'lucide-react';

interface DiagnosticHoverCardProps {
  diagnostics: Diagnostic[];
}

/**
 * Badge + hover tooltip for graph nodes.
 *
 * Shows error/warning/info counts as a compact badge.
 * On hover, displays a floating card listing each diagnostic message.
 * Uses CSS group-hover so it works inside React Flow's transformed canvas
 * (no portals or fixed positioning needed).
 */
export function DiagnosticHoverCard({ diagnostics }: DiagnosticHoverCardProps) {
  if (diagnostics.length === 0) return null;

  const errors = diagnostics.filter(
    d => d.severity === DiagnosticSeverity.Error
  );
  const warnings = diagnostics.filter(
    d => d.severity === DiagnosticSeverity.Warning
  );
  const infos = diagnostics.filter(
    d =>
      d.severity === DiagnosticSeverity.Information ||
      d.severity === DiagnosticSeverity.Hint
  );

  return (
    <div className="group/diag relative flex items-center">
      {/* Badge (always visible) */}
      <div className="flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-1.5 py-0.5 text-xs shadow-sm dark:border-[#404040] dark:bg-[#2d2d2d]">
        {errors.length > 0 && (
          <span className="flex items-center gap-0.5 text-red-500">
            <CircleAlert className="h-3.5 w-3.5" />
            {errors.length}
          </span>
        )}
        {warnings.length > 0 && (
          <span className="flex items-center gap-0.5 text-amber-500">
            <TriangleAlert className="h-3.5 w-3.5" />
            {warnings.length}
          </span>
        )}
        {infos.length > 0 && (
          <span className="flex items-center gap-0.5 text-blue-500">
            <Info className="h-3.5 w-3.5" />
            {infos.length}
          </span>
        )}
      </div>

      {/* Hover tooltip */}
      <div className="nopan nowheel pointer-events-none absolute top-full left-1/2 z-50 mt-1.5 hidden w-max max-w-[320px] -translate-x-1/2 group-hover/diag:pointer-events-auto group-hover/diag:block">
        <div className="rounded-lg border border-gray-200 bg-white p-2.5 shadow-lg dark:border-[#404040] dark:bg-[#2d2d2d]">
          <ul className="space-y-1">
            {diagnostics.map((d, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="mt-0.5 shrink-0">
                  {d.severity === DiagnosticSeverity.Error && (
                    <CircleAlert className="h-3 w-3 text-red-500" />
                  )}
                  {d.severity === DiagnosticSeverity.Warning && (
                    <TriangleAlert className="h-3 w-3 text-amber-500" />
                  )}
                  {(d.severity === DiagnosticSeverity.Information ||
                    d.severity === DiagnosticSeverity.Hint) && (
                    <Info className="h-3 w-3 text-blue-500" />
                  )}
                </span>
                <span
                  className={cn(
                    'text-xs leading-snug',
                    d.severity === DiagnosticSeverity.Error &&
                      'text-red-600 dark:text-red-400',
                    d.severity === DiagnosticSeverity.Warning &&
                      'text-amber-600 dark:text-amber-400',
                    (d.severity === DiagnosticSeverity.Information ||
                      d.severity === DiagnosticSeverity.Hint) &&
                      'text-blue-600 dark:text-blue-400'
                  )}
                >
                  {d.message}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
