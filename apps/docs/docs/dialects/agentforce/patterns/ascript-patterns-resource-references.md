---
sidebar_label: "Resource References"
---

# Agent Script Pattern: Reference Resources Directly in Reasoning Instructions

Reference subagents, actions, and variables directly in the prompt text of your reasoning instructions. Use @ mentions and the `{curly brace}` syntax to reference variables and reasoning actions directly.

## Why Use This Pattern

Reference subagents, actions, and variables directly in your reasoning instructions using special syntax. Use @ mentions and the curly brace syntax to reference variables and actions directly in your prompt text.

**Pattern Example**: Display a personalized order summary by referencing variables like order name, date, and status, and guide the user to the `lookup_order` action or `Returns` subagent when they need more help.

## Reference Syntax

- **Subagents**: `{!@subagents.<subagent_name>}`
- **Actions**: `{!@actions.<action_name>}`
- **Variables**: `{!@variables.<variable_name>}`

## Reference Variables in Output

Reference variables directly to include specific data in the response.

```agentscript title="Variable References in Output"
reasoning:
  instructions: ->
    | Refer to the user by preferred name {!@variables.preferred_name}.
      Output a summary to the user in the following format:
      Order Name: {!@variables.order_name}
      Order Date: {!@variables.order_date}
      Order Status: {!@variables.order_status}
```

## Reference Actions in Instructions

Reference actions directly to tell the LLM which reasoning action to use.

```agentscript title="Action References in Instructions"
reasoning:
  instructions: ->
    | If the user wants information about a past order, ask for the Order ID
      or Restaurant Name and use {!@actions.lookup_order}.
      If the user asks for a service agent or seems upset,
      go to {!@actions.go_to_escalation}.
      If the user wants to make a return, confirm their order ID and
      call {!@actions.create_return}.
```

## Combine Variable and Action References

Use both types of references together for complete, specific instructions.

```agentscript title="Combined References"
reasoning:
  instructions: ->
    | Refer to the user by their name {!@variables.member_name}.
      Show the user their current order summary: {!@variables.order_summary}
      at the start of the conversation or if they specifically request it again.
      If the user wants to make a return, confirm their order ID and
      call {!@actions.create_return}. If returns are not eligible
      ({!@variables.order_return_eligible} is False), explain that
      the order is not eligible for return.
```

## Conditional Output with References

Use references inside conditional prompts as well.

```agentscript title="Conditional Variable References"
reasoning:
  instructions: ->
    if @variables.loyalty_tier == "Gold":
      | Thank the customer for being a Gold member.
        Their current points balance is {!@variables.points_balance}.

    if @variables.loyalty_tier == "Platinum VIP":
      | Welcome back, valued Platinum VIP member {!@variables.member_name}!
        You have {!@variables.points_balance} points available.
```

## Tips

- **Reference resources when clarity is required**: In general, the agent can figure out which resource to use. In cases where you have many actions, for example, add a reference to help the agent pick the right one. Direct references are a stronger signal to the LLM, so it's more likely to select the right variable, action, or subagent.

## Related Topics

- Reference: [Tools (Reasoning Actions)](../reference/ascript-ref-tools.md)
- Reference: [Reasoning Instructions](../reference/ascript-ref-instructions.md)
- Reference: [Variables](../reference/ascript-ref-variables.md)
- Reference: [Actions](../reference/ascript-ref-actions.md)
