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

interface DiagnosticBadgeProps {
  diagnostics: Diagnostic[];
  className?: string;
}

export function DiagnosticBadge({
  diagnostics,
  className,
}: DiagnosticBadgeProps) {
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
    <div className={cn('flex items-center gap-1.5 text-xs', className)}>
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
  );
}

/** Inline list of diagnostic messages below a field. */
export function DiagnosticMessages({
  diagnostics,
}: {
  diagnostics: Diagnostic[];
}) {
  if (diagnostics.length === 0) return null;

  return (
    <div className="space-y-0.5">
      {diagnostics.map((d, i) => (
        <p
          key={i}
          className={cn(
            'flex items-center gap-1 text-xs',
            d.severity === DiagnosticSeverity.Error &&
              'text-red-600 dark:text-red-400',
            d.severity === DiagnosticSeverity.Warning &&
              'text-amber-600 dark:text-amber-400',
            (d.severity === DiagnosticSeverity.Information ||
              d.severity === DiagnosticSeverity.Hint) &&
              'text-blue-600 dark:text-blue-400'
          )}
        >
          {d.severity === DiagnosticSeverity.Error && (
            <CircleAlert className="h-3 w-3 shrink-0" />
          )}
          {d.severity === DiagnosticSeverity.Warning && (
            <TriangleAlert className="h-3 w-3 shrink-0" />
          )}
          {(d.severity === DiagnosticSeverity.Information ||
            d.severity === DiagnosticSeverity.Hint) && (
            <Info className="h-3 w-3 shrink-0" />
          )}
          {d.message}
        </p>
      ))}
    </div>
  );
}
