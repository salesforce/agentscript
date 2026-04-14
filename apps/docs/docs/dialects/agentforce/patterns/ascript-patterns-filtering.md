---
sidebar_label: "Filtering"
---

# Agent Script Pattern: Enforce Business Rules with Filters

Use `available when` to control which subagents or actions are available to the LLM. If the conditions aren't met, the LLM can't access the subagent or reasoning action (also described as a [tool](../reference/ascript-ref-tools.md) in the developer guide).

## Why Use This Pattern

When your business conditions aren't met, this pattern allows you to hide the subagent or action entirely, simplifying the LLM's decision-making and enforcing business rules about feature availability. Without filtering, customers might convince the LLM to use features that aren't allowed. Or, the LLM might make reasoning errors during complex workflows and prolonged conversations, due to prompt noise and context drift. See [Required Subagent Workflow](./ascript-patterns-required-flow.md) for a related pattern.

**Pattern Examples**:

- Only enable the `create_return` action when the order is within the return window and verified—otherwise, hide it completely from the agent.
- Only enable the `escalate` subagent for verified customers during business hours.

## Filter Subagents

Control which subagents are available based on whether the user is verified.

```agentscript title="Filter Subagents by Verification Status"
start_agent agent_router:
  description: "Welcome the user and determine the appropriate subagent"

  reasoning:
    instructions: ->
      | Select the best tool to call based on conversation history and user's intent.

    actions:
      go_to_order: @utils.transition to @subagent.General_Info
          description: "Gives general information about products."
      go_to_order: @utils.transition to @subagent.Order_Management
          description: "Handles order lookup, refunds, order updates."
          available when @variables.verified == True
      go_to_escalation: @utils.transition to @subagent.Escalation
          description: "Handles escalation to a human rep."
          available when @variables.verified == True and @variables.is_business_hours == True
```

In this example:

- All users can access General Info.
- Verified users can be routed to the Order Management.
- Escalation requires verification **and** valid business hours.

## Filter Actions

Make actions available only when business rules are satisfied.

```agentscript title="Filter Actions by Eligibility"
reasoning:
  instructions: ->
    | Refer to the user by their name {!@variables.member_name}.
      Show the user their order summary: {!@variables.order_summary}.
      If the user wants to make a return, confirm their order ID and
      call {!@actions.create_return}. If returns are not eligible,
      explain why.

  actions:
    create_return: @actions.create_return
      available when @variables.order_return_eligible == True and @variables.order_id != None
```

:::note
Keep in mind that the LLM can call any **available** reasoning action, even if you don’t explicitly tell it to.
:::

## Tips

- **Keep filter logic simple**: Use clear conditions rather than complex nested logic.
- **Protect against customer manipulation**: Filter business-sensitive features. Don't only rely on prompt engineering.

## Related Topics

- Pattern: [Required Subagent Workflow](./ascript-patterns-required-flow.md)
- Reference: [Tools (Reasoning Actions)](../reference/ascript-ref-tools.md)
- Reference: [Conditional Expressions](../reference/ascript-ref-expressions.md)
- Reference: [Start Agent Block](../ascript-blocks.md#start-agent-block)
