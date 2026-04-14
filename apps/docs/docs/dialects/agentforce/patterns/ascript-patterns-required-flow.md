---
sidebar_label: "Required Topic Workflow"
---

# Agent Script Pattern: Enforce Required Workflows for a Subagent

Use conditional transitions to guarantee users pass through required steps before accessing other features.

Use conditional transitions at the top of your instructions to force users through required steps. Unlike filtering with `available when`, these transitions execute immediately and guarantee the routing behavior.

## Why Use This Pattern

- Use [filtering](./ascript-patterns-filtering.md) (`available when`) when you want to remove options.
- Use the required flow pattern (also described as a "conditional transition") when users must complete a step before anything else occurs.

- Use [Enforce Required Workflows Through Subagents In Multi Turn Conversations](./ascript-patterns-multi-turn.md) to enforce step-by-step sequencing across conversation turns. This pattern ensures a required workflow through subagents, where the next subagent depends on a customer's response to a previous subagent.

| Approach                                                                                                     | When to Use                                                                                                   |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `available when`                                                                                             | Control which reasoning actions are available; LLM chooses among them                                         |
| Conditional transition                                                                                       | Require users to complete a step; no LLM choice                                                               |
| [Enforce Required Workflows Through Subagents In Multi Turn Conversations](./ascript-patterns-multi-turn.md) | Enforce step-by-step sequencing through subagents while handling multiple conversation turns in each subagent |

For critical flows like identity verification, a conditional transition in instructions is more reliable than `available when` filtering alone. While filtering restricts options, it doesn’t enforce workflows. For example, instead of prompting the user to verify their identity, the agent can exclusively choose options that don’t require user verification. A conditional transition guarantees the workflow before any reasoning takes place.

**Pattern Examples**:

- Force unverified users through identity verification before they can access order management, returns, or any other sensitive subagents.
- Ensure order return subagents ask the correct next question based on previous answers, and that all required questions are asked.

## Required Flow for All Subagents

To require a subagent flow before a user can move to any other subagents, in the agent router, place a conditional transition at the top of your instructions. If the condition is met, the transition happens immediately before any other processing.

```agentscript title="Required Verification Flow"
start_agent agent_router:
  description: "Welcome the user and route to the appropriate subagent"

  reasoning:
    instructions: ->
      # Check for condition
      if @variables.verified == False:

        # Required transition to a subagent
        transition to @subagent.Identity

      # Subsequent processing that only occurs
      # if condition ISN'T met…
      | Select the best tool to call based on conversation history and user's intent.

    actions:
      go_to_orders: @utils.transition to @subagent.Order_Management
        description: "Handles order lookup, refunds, and order updates."

      go_to_faq: @utils.transition to @subagent.General_FAQ
        description: "Handles FAQ lookup and common questions."

      go_to_escalation: @utils.transition to @subagent.Escalation
        description: "Escalate to a human representative."
```

Unverified users are immediately routed to the Identity subagent. No subagent classification takes place and no prompt is sent to the LLM. After the user completes verification with the Identity subagent, the process starts over. Because the Verified variable is now set to True, the conditional is satisfied. The agent can proceed through the remaining instructions and the other subagents in the agent router are available to the user.

## Required Flow for a Single Subagent

This pattern works in any subagent, not just the agent router. Use it when an individual subagent requires a prerequisite.

```agentscript title="Required Flow in a Subagent"
subagent Order_Management:
  description: "Handle order inquiries and updates"

  reasoning:
    instructions: ->
      # Check for condition
      if @variables.order_id is None:

        # Required transition to a subagent
        transition to @subagent.Order_Lookup

      # Subsequent processing that only occurs
      # if condition ISN'T met…
      | Help the user with their order {!@variables.order_id}.
```

## Use Step Variables to Select a Subagent

This pattern works in any subagent, particularly in the agent router. Use it to enforce a complex subagent workflow throughout multi-turn conversations.

See [Agent Script Example: Use Step Variables to Enforce Subagent Workflows](../examples/ascript-examples-multi-turn.md).

## Tips

- **Use the `go_to_` prefix**: Name transition actions with a `go_to_` prefix (for example, `go_to_orders`, `go_to_faq`) so the LLM understands they navigate to other subagents.
- **Place required flows first**: Put conditional transitions at the top of instructions so they execute before any other instructions. If the agent transitions to another subagent before reasoning, no prompt is sent to the LLM. Prior instructions aren't used or preserved, so executing them just increases latency and (in the case of running an action) can incur costs.
- **Use descriptive names**: Avoid generic names like `tool1` or `action2`; use names that describe the destination or purpose.

## Related Topics

- Pattern: [Conditionals](ascript-patterns-conditionals.md)
- Pattern: [Transitions](ascript-patterns-transitions.md)
- Pattern: [Filtering with Available When](ascript-patterns-filtering.md)
