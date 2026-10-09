/* eslint-disable no-console */
/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 *
 * Demo: e-commerce checkout — model-swap structural equivalence
 *
 * What it shows:
 *   A 3-topic checkout flow (browse -> cart -> checkout) driven across
 *   four user turns with five tools. Runs against the model named in
 *   $LLM_GATEWAY_MODEL and prints a *structural summary* (tool order,
 *   final cart total, handoff trail, total tool calls) that's directly
 *   comparable across runs.
 *
 *   To compare two models: re-run with a different LLM_GATEWAY_MODEL
 *   and diff the printed summaries. Not run inline because the harness
 *   has a single set of credentials per .env.
 *
 * Wow moment:
 *   Final structural summary table — same DSL, same prompts, deterministic
 *   tool surface; the LLM is the only variable.
 *
 * Run:
 *   pnpm exec tsx --env-file=.env \
 *     packages/runtime-vercel/examples/gateway-tests/demo-model-swap.ts
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

const AGENT_SOURCE = `
system:
    instructions: "You are a friendly e-commerce checkout assistant. You walk users through browse -> cart -> checkout. Use tools — don't hallucinate prices or order numbers. Always read the cart total from the AddToCart output. If the user mentions a coupon while you're in the cart topic, apply it BEFORE transitioning to checkout."

config:
    agent_name: "CheckoutBot"
    default_agent_user: "shop@example.com"

language:
    default_locale: "en_US"

variables:
    last_query: mutable string = ""
        description: "Last product search query"
    cart_total: mutable number = 0
        description: "Running cart total in USD"
    coupon_code: mutable string = ""
        description: "Applied coupon code"
    discount_amount: mutable number = 0
        description: "Discount applied"
    order_number: mutable string = ""
        description: "Generated order number"

start_agent browse:
    description: "Help user find a product"

    actions:
        Search_Products:
            description: "Search the catalog by free-text query"
            inputs:
                query: string
                    description: "Search terms"
                    is_required: True
            outputs:
                top_sku: string
                    description: "Top SKU"
                price: number
                    description: "Price in USD"
                name: string
                    description: "Product name"
            target: "fn://SearchProducts"

    reasoning:
        instructions: ->
            |   Use {!@actions.search} to find what the user wants. Then
            |   transition to cart with {!@actions.go_cart}.
        actions:
            search: @actions.Search_Products
                with query=...
                set @variables.last_query = "captured"

            go_cart: @utils.transition to @topic.cart
                description: "Move to cart"

topic cart:
    description: "Add items and apply coupons"

    actions:
        Add_To_Cart:
            description: "Add a SKU to the cart"
            inputs:
                sku: string
                    description: "SKU"
                    is_required: True
                quantity: number
                    description: "Quantity"
                    is_required: True
            outputs:
                cart_total: number
                    description: "New cart total"
            target: "fn://AddToCart"

        Apply_Coupon:
            description: "Apply a coupon code to the cart"
            inputs:
                code: string
                    description: "Coupon code"
                    is_required: True
            outputs:
                discount: number
                    description: "Discount applied"
                new_total: number
                    description: "Cart total after discount"
            target: "fn://ApplyCoupon"

    reasoning:
        instructions: ->
            |   Add what the user asked for using {!@actions.add}, then
            |   if they mentioned a coupon, call {!@actions.coupon}.
            |   Then transition to checkout with {!@actions.go_checkout}.
        actions:
            add: @actions.Add_To_Cart
                with sku=...
                with quantity=...
                set @variables.cart_total = @outputs.cart_total

            coupon: @actions.Apply_Coupon
                with code=...
                set @variables.cart_total = @outputs.new_total
                set @variables.discount_amount = @outputs.discount

            go_checkout: @utils.transition to @topic.checkout
                description: "Move to checkout"

topic checkout:
    description: "Place the order and email a receipt"

    actions:
        Checkout:
            description: "Place the order"
            inputs:
                cart_total: number
                    description: "Final cart total"
                    is_required: True
            outputs:
                order_number: string
                    description: "Generated order number"
            target: "fn://Checkout"

        Email_Receipt:
            description: "Email the receipt to the user"
            inputs:
                order_number: string
                    description: "Order number"
                    is_required: True
            outputs:
                sent: boolean
                    description: "Whether the email was sent"
            target: "fn://EmailReceipt"

    reasoning:
        instructions: ->
            |   Place the order via {!@actions.place} using the cart total.
            |   Then email the receipt with {!@actions.email}.
        actions:
            place: @actions.Checkout
                with cart_total=@variables.cart_total
                set @variables.order_number = @outputs.order_number

            email: @actions.Email_Receipt
                with order_number=@variables.order_number
`;

async function main(): Promise<void> {
  console.log('=== demo-model-swap ===\n');

  const cfg = createGatewayConfig();
  const llmDriver = createLlmDriver(cfg);
  console.log(`Gateway: ${cfg.baseURL}`);
  console.log(`Model:   ${cfg.model}\n`);

  const { tools } = mockTool({
    SearchProducts: {
      delayMs: 30,
      result: {
        top_sku: 'SKU-COFFEE-001',
        price: 24.99,
        name: 'Single-origin coffee, 12oz',
      },
    },
    AddToCart: { delayMs: 20, result: { cart_total: 49.98 } },
    ApplyCoupon: {
      delayMs: 20,
      result: { discount: 5.0, new_total: 44.98 },
    },
    Checkout: {
      delayMs: 30,
      result: { order_number: 'ORD-2026-7720' },
    },
    EmailReceipt: { delayMs: 20, result: { sent: true } },
  });

  const runtime = createTestAgent({
    source: AGENT_SOURCE,
    tools,
    maxStepsPerTurn: 6,
    llmDriver,
  });

  const events: RuntimeEvent[] = [];
  const turns = [
    'Hi! I want some coffee, ideally a single-origin.',
    'Add 2 bags of the first one to my cart and apply coupon code SAVE5 in the same step.',
    'Looking good — anything else worth knowing about my cart total?',
    'Looks great. Place the order and email me the receipt.',
  ];

  let totalReasoningIters = 0;
  for (let i = 0; i < turns.length; i++) {
    const u = turns[i];
    console.log(`--- Turn ${i + 1}: ${u} ---`);
    const cap = await runTurn(runtime, u);
    events.push(...cap.events);

    // count reasoning iterations as the number of llm-text events plus
    // tool-call batches in this turn (best-effort proxy)
    const iters = cap.events.filter(
      e => e.kind === 'llm-text' || e.kind === 'phase-start'
    ).length;
    totalReasoningIters += iters;

    for (const e of cap.events) {
      if (e.kind === 'tool-call') {
        console.log(`  [tool-call]  ${e.name}`);
      } else if (e.kind === 'node-enter') {
        console.log(`  [node-enter] ${e.node}`);
      }
    }
    console.log('');
  }

  // ---------------------------------------------------------------------
  // Structural summary (the wow moment)
  // ---------------------------------------------------------------------
  const toolOrder = events
    .filter(e => e.kind === 'tool-call')
    .map(e => (e as { name: string }).name.replace(/^fn:\/\//, ''));

  const handoffs = events
    .filter(e => e.kind === 'node-enter')
    .map(e => (e as { node: string }).node);

  const cartTotal = runtime.state.get('cart_total');
  const orderNumber = runtime.state.get('order_number');
  const discount = runtime.state.get('discount_amount');

  console.log('+----------------------------------------------------+');
  console.log(`| Structural summary  (model: ${cfg.model})`);
  console.log('+----------------------------------------------------+');
  console.log(`  Tool order      : ${toolOrder.join(' -> ')}`);
  console.log(`  Total tool calls: ${toolOrder.length}`);
  console.log(`  Handoff trail   : ${handoffs.join(' -> ')}`);
  console.log(`  Final cart_total: $${cartTotal}`);
  console.log(`  Discount applied: $${discount}`);
  console.log(`  Order number    : ${orderNumber}`);
  console.log(
    `  Avg iters/turn  : ${(totalReasoningIters / turns.length).toFixed(1)}`
  );
  console.log('+----------------------------------------------------+');
  console.log('');

  // ---------------------------------------------------------------------
  // Assertions
  // ---------------------------------------------------------------------
  const expected = [
    'SearchProducts',
    'AddToCart',
    'ApplyCoupon',
    'Checkout',
    'EmailReceipt',
  ];
  for (const t of expected) {
    assertions.ok(
      toolOrder.includes(t),
      `${t} fired at least once`,
      `tool order: ${toolOrder.join(', ')}`
    );
  }

  assertions.ok(
    typeof orderNumber === 'string' && (orderNumber as string).length > 0,
    'order_number populated in state',
    `order_number=${orderNumber}`
  );

  // Reasoning iters: we run 4 turns; loose ceiling 4 LLM-text events per turn.
  const llmTextEvents = events.filter(e => e.kind === 'llm-text').length;
  assertions.lt(
    llmTextEvents / turns.length,
    4,
    `< 4 llm-text events per turn (avg ${(llmTextEvents / turns.length).toFixed(
      1
    )})`
  );

  const errs = events.filter(
    e => e.kind === 'tool-error' || e.kind === 'abort'
  );
  assertions.eq(errs.length, 0, 'no error events');

  // Hint to the SE
  console.log(
    'Tip: re-run with a different LLM_GATEWAY_MODEL value and diff the summary block.'
  );

  report('demo-model-swap');
}

main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
