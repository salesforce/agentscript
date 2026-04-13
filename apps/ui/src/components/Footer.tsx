/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { Link } from 'react-router';
import logo from '~/assets/logo.png';
import { ThemeSwitch } from './ThemeSwitch';

/**
 * Rich footer for marketing pages with links and theme toggle
 */
export function Footer() {
  return (
    <footer className="border-t py-12">
      <div className="container">
        <div className="grid gap-8 md:grid-cols-4">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <img src={logo} alt="AgentScript Logo" className="h-12 w-12" />
              <span className="text-xl font-bold">AgentScript</span>
            </div>
            <p className="text-muted-foreground text-sm">
              High-level programming language for AI agents
            </p>
            <ThemeSwitch />
          </div>

          <div>
            <h3 className="mb-4 font-semibold">Product</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <a
                  href={`${import.meta.env.BASE_URL}docs/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition"
                >
                  Documentation
                </a>
              </li>
              <li>
                <Link
                  to="/agents"
                  className="text-muted-foreground hover:text-foreground transition"
                >
                  Playground
                </Link>
              </li>
              <li>
                <a
                  href="https://github.com/salesforce/agentscript"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition"
                >
                  GitHub
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="mb-4 font-semibold">Resources</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <a
                  href={`${import.meta.env.BASE_URL}docs/getting-started`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition"
                >
                  Getting Started
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="mb-4 font-semibold">Legal</h3>
            <ul className="space-y-2 text-sm">
              <li>
                <a
                  href="https://github.com/salesforce/agentscript/blob/main/LICENSE.txt"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground transition"
                >
                  Apache 2.0 License
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 border-t pt-8">
          <p className="text-muted-foreground text-center text-sm">
            © {new Date().getFullYear()} Salesforce, Inc. Licensed under Apache
            2.0.
          </p>
        </div>
      </div>
    </footer>
  );
}
