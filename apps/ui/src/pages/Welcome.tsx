/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { Link } from 'react-router';
import { Button } from '~/components/ui/button';
import { Footer } from '~/components/Footer';
import { MarketingHeader } from '~/components/MarketingHeader';
import logo from '~/assets/logo.png';

export function Welcome() {
  return (
    <div className="flex min-h-screen flex-col">
      <MarketingHeader />

      <main className="flex flex-1 flex-col">
        {/* Hero Section */}
        <section className="container flex flex-col items-center justify-center px-4 py-20 text-center md:py-32">
          <div className="mx-auto max-w-4xl space-y-8">
            {/* Logo */}
            <div className="animate-slide-top fill-mode-[backwards] flex justify-center [animation-delay:0.1s]">
              <div className="relative h-32 w-32 md:h-40 md:w-40">
                <img
                  src={logo}
                  alt="AgentScript Logo"
                  className="h-full w-full object-contain"
                />
              </div>
            </div>

            {/* Headline */}
            <h1 className="animate-slide-top fill-mode-[backwards] text-foreground text-4xl font-bold [animation-delay:0.2s] md:text-6xl lg:text-7xl">
              Build Powerful AI Agents
              <br />
              <span className="bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-600 bg-clip-text text-transparent">
                with AgentScript
              </span>
            </h1>

            {/* Subheadline */}
            <p className="animate-slide-top fill-mode-[backwards] text-muted-foreground mx-auto max-w-2xl text-lg [animation-delay:0.3s] md:text-xl">
              A high-level programming language designed for representing AI
              constructs. Intuitive syntax meets powerful capabilities for
              building next-generation conversational agents.
            </p>

            {/* CTA Buttons */}
            <div className="animate-slide-top fill-mode-[backwards] flex flex-col gap-4 [animation-delay:0.4s] sm:flex-row sm:justify-center">
              <Button asChild size="lg" className="text-lg">
                <Link to="/agents">Get Started</Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="text-lg">
                <a
                  href={`${import.meta.env.BASE_URL}docs/`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View Documentation
                </a>
              </Button>
            </div>
          </div>
        </section>

        {/* Code Example Section */}
        <section className="bg-muted/30 container px-4 py-16 md:py-24">
          <div className="mx-auto max-w-5xl">
            <h2 className="mb-8 text-center text-3xl font-bold md:text-4xl">
              Simple, Intuitive Syntax
            </h2>
            <div className="bg-background overflow-hidden rounded-lg border shadow-lg">
              <div className="border-b bg-gradient-to-r from-cyan-500/10 via-blue-500/10 to-purple-600/10 px-4 py-2">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-red-500" />
                  <div className="h-3 w-3 rounded-full bg-yellow-500" />
                  <div className="h-3 w-3 rounded-full bg-green-500" />
                  <span className="text-muted-foreground ml-2 text-sm">
                    concierge_agent.agent
                  </span>
                </div>
              </div>
              <pre className="overflow-x-auto p-6">
                <code className="text-sm md:text-base">
                  <span className="text-purple-500">topic</span>{' '}
                  <span className="text-cyan-500">concierge_agent</span>
                  <span className="text-muted-foreground">:</span>
                  {'\n'}
                  {'\n'}
                  {'  '}
                  <span className="text-blue-500">description</span>
                  <span className="text-muted-foreground">: </span>
                  <span className="text-green-500">
                    "Concierge agent before interview"
                  </span>
                  {'\n'}
                  {'\n'}
                  {'  '}
                  <span className="text-purple-500">reasoning</span>
                  <span className="text-muted-foreground">:</span>
                  {'\n'}
                  {'    '}
                  <span className="text-blue-500">instructions</span>
                  <span className="text-muted-foreground">:|</span>
                  {'\n'}
                  {'      '}
                  <span className="text-muted-foreground">
                    Greet the user, ask if they are ready to start
                  </span>
                  {'\n'}
                  {'      '}
                  <span className="text-muted-foreground">
                    their interview, and when they are transition
                  </span>
                  {'\n'}
                  {'      '}
                  <span className="text-muted-foreground">
                    to the interviewing agent.
                  </span>
                  {'\n'}
                  {'\n'}
                  {'    '}
                  <span className="text-blue-500">actions</span>
                  <span className="text-muted-foreground">:</span>
                  {'\n'}
                  {'      '}
                  <span className="text-cyan-500">@actions.lookup_job</span>
                  {'\n'}
                  {'        '}
                  <span className="text-blue-500">with</span>{' '}
                  <span className="text-muted-foreground">
                    job_id=@variables.job_id
                  </span>
                  {'\n'}
                  {'      '}
                  <span className="text-cyan-500">@actions.user_is_ready</span>
                  {'\n'}
                  {'        '}
                  <span className="text-purple-500">transition to</span>{' '}
                  <span className="text-cyan-500">@topic.interview_agent</span>
                </code>
              </pre>
            </div>
          </div>
        </section>

        {/* Features Section */}
        <section className="container px-4 py-16 md:py-24">
          <h2 className="mb-12 text-center text-3xl font-bold md:text-4xl">
            Why AgentScript?
          </h2>
          <div className="mx-auto grid max-w-5xl gap-8 md:grid-cols-3">
            <div className="space-y-4 rounded-lg border p-6 shadow-sm transition hover:shadow-md">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-500 to-blue-500">
                <svg
                  className="h-6 w-6 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
              </div>
              <h3 className="text-xl font-semibold">
                High-Level & Declarative
              </h3>
              <p className="text-muted-foreground">
                Express complex AI behaviors with clear, readable syntax. Focus
                on what your agent should do, not how to implement it.
              </p>
            </div>

            <div className="space-y-4 rounded-lg border p-6 shadow-sm transition hover:shadow-md">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-purple-600">
                <svg
                  className="h-6 w-6 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                  />
                </svg>
              </div>
              <h3 className="text-xl font-semibold">Multi-Agent Workflows</h3>
              <p className="text-muted-foreground">
                Seamlessly coordinate between multiple agents with built-in
                handoff capabilities and state management.
              </p>
            </div>

            <div className="space-y-4 rounded-lg border p-6 shadow-sm transition hover:shadow-md">
              <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-to-br from-purple-600 to-purple-500">
                <svg
                  className="h-6 w-6 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
                  />
                </svg>
              </div>
              <h3 className="text-xl font-semibold">Production-Ready</h3>
              <p className="text-muted-foreground">
                Compiles to optimized runtime specifications. Built for
                enterprise-scale AI applications at Salesforce.
              </p>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="container bg-gradient-to-r from-cyan-500/10 via-blue-500/10 to-purple-600/10 px-4 py-16 md:py-24">
          <div className="mx-auto max-w-3xl text-center">
            <h2 className="mb-6 text-3xl font-bold md:text-4xl">
              Ready to Build Your First Agent?
            </h2>
            <p className="text-muted-foreground mb-8 text-lg">
              Start creating powerful AI agents with AgentScript today.
            </p>
            <Button asChild size="lg" className="text-lg">
              <Link to="/agents">Get Started</Link>
            </Button>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
