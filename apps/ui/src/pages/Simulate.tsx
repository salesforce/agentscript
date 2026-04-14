/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { Play } from 'lucide-react';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '~/components/ui/empty';

export function Simulate() {
  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Play />
          </EmptyMedia>
          <EmptyTitle>Simulator</EmptyTitle>
          <EmptyDescription>
            Test and debug your agent in a safe environment. Run simulations to
            see how your agent responds to different scenarios.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <p className="text-muted-foreground text-sm">
            This feature is currently under development.
          </p>
        </EmptyContent>
      </Empty>
    </div>
  );
}
