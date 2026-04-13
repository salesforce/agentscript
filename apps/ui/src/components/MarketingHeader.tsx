/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { Link } from 'react-router';
import { Button } from './ui/button';
import logo from '~/assets/logo.png';

export function MarketingHeader() {
  return (
    <header className="container py-6">
      <nav className="flex flex-wrap items-center justify-between gap-4 sm:flex-nowrap md:gap-8">
        <Logo />
        <div className="flex items-center gap-4">
          <Button asChild variant="default" size="lg">
            <Link to="/agents">Get Started</Link>
          </Button>
        </div>
      </nav>
    </header>
  );
}

function Logo() {
  return (
    <Link to="/" className="group flex items-center gap-2">
      <img src={logo} alt="AgentScript Logo" className="h-8 w-8" />
      <span className="text-xl font-bold transition group-hover:translate-x-1">
        AgentScript
      </span>
    </Link>
  );
}
