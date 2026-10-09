/* eslint-disable no-console */
/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Gateway test: state-dependent tool availability (available-when guards),
 * multi-turn conversation, conditional tool exposure.
 *
 * Validates:
 *   1. `authenticate` is called before `check_balance` (guard enforcement)
 *   2. `check_balance` is eventually called (across one or two turns)
 *   3. State `balance` is populated from tool output
 *   4. State `authenticated` is true after authentication
 *   5. No errors emitted across all turns
 *
 * The agent has two tools:
 *   - `authenticate` -- always available, sets state `authenticated = True`
 *   - `check_balance` -- only available when `authenticated == True`
 *
 * Run:
 *   pnpm exec tsx packages/runtime-vercel/examples/gateway-tests/test-state-and-guard.ts
 */

import {
  createGatewayConfig,
  createLlmDriver,
  createTestAgent,
  runTurn,
  mockTool,
  assertions,
  report,
  type RuntimeEvent,
} from './harness.js';

// ---------------------------------------------------------------------------
// Inline agent source
// ---------------------------------------------------------------------------

const AGENT_SOURCE = `
system:
    instructions: "You are a banking assistant. Users must authenticate before checking their balance. If the user asks for their balance and is not authenticated, call authenticate first, then check_balance."

config:
    agent_name: "BankGuardTest"
    default_agent_user: "test@example.com"

language:
    default_locale: "en_US"

variables:
    authenticated: mutable boolean = False
        description: "Whether the user has been authenticated"
    balance: mutable string = ""
        description: "Account balance returned by the check_balance tool"

start_agent bank_bot:
    description: "Handles authentication and balance inquiries"

    actions:
        Authenticate:
            description: "Authenticate the current user"
            inputs:
                reason: string
                    description: "Why authentication is needed"
                    is_required: False
            outputs:
                success: boolean
                    description: "Whether authentication succeeded"
                user: string
                    description: "Authenticated username"
            target: "fn://authenticate"

        Check_Balance:
            description: "Check the account balance for the authenticated user"
            inputs:
                account_type: string
                    description: "Type of account to check"
                    is_required: False
            outputs:
                balance: string
                    description: "Current account balance"
                currency_code: string
                    description: "Currency code"
            target: "fn://check_balance"

    reasoning:
        instructions: ->
            |   Help the user with banking inquiries.
                If the user wants to check their balance and is not yet
                authenticated (authenticated={! @variables.authenticated }),
                call {!@actions.auth} first. Once authenticated, call
                {!@actions.get_balance} to retrieve the balance.
                Always authenticate before checking balance.
        actions:
            auth: @actions.Authenticate
                with reason=...
                set @variables.authenticated = True

            get_balance: @actions.Check_Balance
                available when @variables.authenticated == True
                with account_type=...
                set @variables.balance = @outputs.balance
`;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('=== test-state-and-guard ===\n');

  const cfg = createGatewayConfig();
  const llmDriver = createLlmDriver(cfg);

  console.log(`Gateway: ${cfg.baseURL}`);
  console.log(`Model:   ${cfg.model}\n`);

  // Mock tools with delays
  const { tools, callLog } = mockTool({
    authenticate: {
      delayMs: 100,
      result: { success: true, user: 'john' },
    },
    check_balance: {
      delayMs: 50,
      result: { balance: '$1,234.56', currency: 'USD' },
    },
  });

  const runtime = createTestAgent({
    source: AGENT_SOURCE,
    tools,
    maxStepsPerTurn: 10,
    llmDriver,
  });

  // Accumulate events across all turns for cross-turn assertions
  const allEvents: RuntimeEvent[] = [];

  // -------------------------------------------------------------------------
  // Turn 1: ask for balance -- model should authenticate first (guard
  // prevents check_balance until authenticated == True)
  // -------------------------------------------------------------------------
  console.log('--- Turn 1: "Check my account balance please" ---\n');

  const turn1 = await runTurn(runtime, 'Check my account balance please');
  allEvents.push(...turn1.events);

  console.log(`  Duration: ${turn1.durationMs}ms`);
  for (const e of turn1.events) {
    if (e.kind === 'tool-call') {
      console.log(`  [tool-call]  ${e.name}(${JSON.stringify(e.args)})`);
    } else if (e.kind === 'tool-result') {
      console.log(`  [tool-res]   ${e.name} -> ${JSON.stringify(e.result)}`);
    } else if (
      e.kind === 'state-change' &&
      !e.name.startsWith('AgentScriptInternal_')
    ) {
      console.log(
        `  [state]      ${e.name}: ${JSON.stringify(e.before)} -> ${JSON.stringify(e.after)}`
      );
    }
  }
  console.log(
    `  State: authenticated=${runtime.state.get('authenticated')}, balance=${JSON.stringify(runtime.state.get('balance'))}`
  );
  console.log('');

  // -------------------------------------------------------------------------
  // Turn 2 (if needed): if check_balance was not called in turn 1, the model
  // may have only authenticated and responded. Send a follow-up.
  // -------------------------------------------------------------------------
  const balanceCalledInTurn1 = turn1.events.some(
    e => e.kind === 'tool-call' && e.name === 'fn://check_balance'
  );

  if (!balanceCalledInTurn1) {
    console.log('--- Turn 2: "Now check my balance" ---\n');

    const turn2 = await runTurn(runtime, 'Now check my balance');
    allEvents.push(...turn2.events);

    console.log(`  Duration: ${turn2.durationMs}ms`);
    for (const e of turn2.events) {
      if (e.kind === 'tool-call') {
        console.log(`  [tool-call]  ${e.name}(${JSON.stringify(e.args)})`);
      } else if (e.kind === 'tool-result') {
        console.log(`  [tool-res]   ${e.name} -> ${JSON.stringify(e.result)}`);
      } else if (
        e.kind === 'state-change' &&
        !e.name.startsWith('AgentScriptInternal_')
      ) {
        console.log(
          `  [state]      ${e.name}: ${JSON.stringify(e.before)} -> ${JSON.stringify(e.after)}`
        );
      }
    }
    console.log(
      `  State: authenticated=${runtime.state.get('authenticated')}, balance=${JSON.stringify(runtime.state.get('balance'))}`
    );
    console.log('');
  }

  // -------------------------------------------------------------------------
  // Assertions
  // -------------------------------------------------------------------------

  // 1. authenticate was called
  const authCalled = allEvents.some(
    e => e.kind === 'tool-call' && e.name === 'fn://authenticate'
  );
  assertions.ok(authCalled, 'authenticate was called');

  // 2. check_balance was called
  const balanceCalled = allEvents.some(
    e => e.kind === 'tool-call' && e.name === 'fn://check_balance'
  );
  assertions.ok(balanceCalled, 'check_balance was called');

  // 3. authenticate was called before check_balance (ordering via callLog timestamps)
  const authEntry = callLog.find(c => c.name === 'authenticate');
  const balanceEntry = callLog.find(c => c.name === 'check_balance');
  if (authEntry && balanceEntry) {
    assertions.ok(
      authEntry.timestamp <= balanceEntry.timestamp,
      'authenticate called before check_balance',
      `auth at ${authEntry.timestamp}, balance at ${balanceEntry.timestamp}`
    );
  } else {
    assertions.ok(
      false,
      'authenticate called before check_balance',
      `auth invoked: ${!!authEntry}, balance invoked: ${!!balanceEntry}`
    );
  }

  // 4. State balance contains expected value
  const balanceState = runtime.state.get('balance');
  const balanceStr =
    typeof balanceState === 'string'
      ? balanceState
      : String(balanceState ?? '');
  const balanceValid =
    balanceStr.includes('1,234') || balanceStr.includes('1234');
  assertions.ok(
    balanceValid,
    'state balance contains "$1,234" or "1234"',
    `actual: ${JSON.stringify(balanceState)}`
  );

  // 5. State authenticated is true
  assertions.eq(
    runtime.state.get('authenticated'),
    true,
    'state authenticated is true'
  );

  // 6. No error events across all turns
  const errorEvents = allEvents.filter(
    e => e.kind === 'tool-error' || e.kind === 'abort'
  );
  assertions.eq(errorEvents.length, 0, 'no error events across all turns');

  // -------------------------------------------------------------------------
  // Report
  // -------------------------------------------------------------------------
  report('test-state-and-guard');
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
