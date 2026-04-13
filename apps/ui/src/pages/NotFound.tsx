/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useLocation, Link, useParams } from 'react-router';

export function NotFound() {
  const location = useLocation();
  const { agentId } = useParams();

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-muted-foreground">
      <span className="text-5xl font-bold text-foreground/20">404</span>
      <p className="text-sm">
        The page{' '}
        <code className="rounded bg-muted px-1.5 py-0.5">
          {location.pathname}
        </code>{' '}
        was not found.
      </p>
      {agentId && (
        <Link
          to={`/agents/${agentId}/script`}
          className="text-sm text-blue-500 hover:underline"
        >
          Go to Script editor
        </Link>
      )}
    </div>
  );
}
