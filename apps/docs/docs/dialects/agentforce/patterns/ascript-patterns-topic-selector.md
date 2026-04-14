---
sidebar_label: "Agent Router"
---

# Agent Script Pattern: Agent Router Strategies

The agent router is the `start_agent` block that serves as the entry point for your agent.

The agent router (also described as the `start_agent` subagent in Agent Script) controls your agent's entry point and routing logic. Keep it focused on essential subagents and use clear descriptions, filtering, and conditional transitions to guide users to the right place.

## Why Use This Pattern

Every user utterance begins at the `start_agent` subagent. It welcomes users, classifies intent, routes to appropriate subagents, and controls which subagents are available based on user state. A well-structured agent router ensures that your users get to the right subagent as effectively as possible.

**Pattern Example**: A customer service agent's agent router forces unverified users through identity verification, then routes verified users to Order Management, Returns, or Escalation based on their intent.

## Basic Structure

The `start_agent` subagent has the same structure as any other subagent. However, it's usually geared towards effective and efficient subagent routing.

```agentscript title="Basic Agent Router"
start_agent agent_router:
  description: "Welcome the user and determine the appropriate subagent based on user input"

  reasoning:
    instructions: ->
      | Select the best tool to call based on conversation history and user's intent.

    actions:
      go_to_orders: @utils.transition to @subagent.Order_Management
        description: "Handles order lookup, refunds, and order updates."

      go_to_faq: @utils.transition to @subagent.General_FAQ
        description: "Handles FAQ lookup and provides answers to common questions."

      go_to_escalation: @utils.transition to @subagent.Escalation
        description: "Escalate to a human representative."
```

## Selective Subagent References

Remove references to a subagent if you want the subagent to be accessible only via transitions from other subagents.

## Effective Subagent Descriptions

Good descriptions help your agent select the best subagent. Be specific about what each subagent handles.

```agentscript title="Descriptive Subagent Transitions"
actions:
  go_to_order: @utils.transition to @subagent.Order_Management
    description: "Handles order lookup, refunds, order updates, and summarizes status, order date, current location, delivery address, items, and driver name."

  go_to_returns: @utils.transition to @subagent.Returns
    description: "Processes return requests for orders within the 60-day return window."

  go_to_billing: @utils.transition to @subagent.Billing
    description: "Handles billing inquiries, payment issues, and invoice questions."
```

## Subagent Gating

You can gate and control flow using `available when` filters. See the [Filtering Pattern](./ascript-patterns-filtering.md) for examples.

## Deterministic Routing

For critical routing decisions, use conditional transitions in instructions instead of relying on the LLM to choose the right flow. See the [Required Subagent Workflow Pattern](./ascript-patterns-required-flow.md) for examples.

## Effective Transitions

For more on how to effectively transition to another subagent, see the [Transitions Pattern](./ascript-patterns-transitions.md).

## Changing the Start Subagent

By default, the agent router is defined as the starting subagent in your agent's Agent Script. In other words, this is the subagent that uses the `start_agent` prefix instead of the `subagent` prefix.

However, you can define another subagent as the starting subagent instead (in Agent Script, the new subagent becomes the `start_agent` subagent). You can choose to use the agent router to move to subagent classification later in the conversation, or you can remove the agent router from your agent altogether if you want to control subagent routing differently.

## Tips

- **Limit subagents**: Start with essential subagents and add more gradually as needed. Fewer subagents means clearer routing decisions for your agent.
- **Use the `go_to_` prefix**: Name transition actions with a `go_to_` prefix (for example, `go_to_orders`) so the agent understands they navigate to other subagents.
- **Write detailed descriptions**: Use detailed and unique descriptions so the agent knows when to choose a subagent, especially if you have similar subagents.
- **Hide subagents based on context**: Use `available when` to control subagent visibility.
- **Conditional logic**: Use conditional logic to guarantee that routing occurs before other processing.

## Related Topics

- Help Page: [Subagent Classification and Routing](https://help.salesforce.com/s/articleView?id=ai.agent_topics_routing.htm)
- Guide: [An Agentforce Guide to Context Engineering](https://help.salesforce.com/s/articleView?id=ai.agent_context_engineering.htm)
- Pattern: [Filtering with Available When](ascript-patterns-filtering.md)
- Pattern: [Required Subagent Flow](ascript-patterns-required-flow.md)
- Pattern: [Transitions](ascript-patterns-transitions.md)
- Reference: [Start Agent Block](../ascript-blocks.md#start-agent-block)
- Reference: [Flow of Control](../ascript-flow.md)
