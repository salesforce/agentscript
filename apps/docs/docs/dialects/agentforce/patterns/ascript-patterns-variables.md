---
sidebar_label: "Variables"
---

# Agent Script Pattern: Using Variables Effectively

Variables store information about the agent's current state across subagents and turns.

## Why Use This Pattern

Variables help you track state that affects agent behavior, pass data among subagents, use data in conditionals, and show specific information to users. Use them strategically to track important information, but avoid over-constraining your agent by storing every piece of data.

Use variables for:

- **Storing values for reuse**: Data for conditionals, inputs to actions in other subagents, or to show to users.
- **Storing action outputs**: Results from actions that you need in conditional or other deterministic workflows.
- **`available when` clauses**: Conditions to determine which actions, subagents, and prompts are available.

```agentscript title="Example Uses of Variables"
variables:
  member_name: mutable string
    description: "The name of the member for personalized greetings"
  verified: mutable boolean = False
    description: "Whether the user's identity has been verified"
  order_summary: mutable string = ""
    description: "Summary of the user's current order"
```

**Pattern Example**: Store the user's verification status in a variable so all subagents can check whether the user is verified before showing sensitive information.

## Initialize Variables

Initialize variables with sensible defaults so conditional checks work correctly.

```agentscript title="Initialize Variables"
variables:
  # Use empty string for text that is fetched later
  order_summary: mutable string = ""

  # Use False for flags that start negative
  verified: mutable boolean = False

  # Leave uninitialized for values that must be provided
  member_email: mutable string
```

## Good Variable Descriptions

Clear descriptions help the agent use variables correctly.

```agentscript title="Descriptive Variables"
variables:
  is_business_hours: mutable boolean = False
    description: "Whether it is business hours. Used to determine if the agent can escalate to a live representative."

  loyalty_tier: mutable string
    description: "The customer's loyalty tier (Standard, Gold, or Platinum VIP). Used for personalized greetings and feature access."
```

## Store Action Outputs

Store action outputs in variables if you need to use them in conditional expressions, as required inputs to another action, or for other deterministic workflows.

```agentscript title="Store Action Outputs"
reasoning:
  instructions: ->
    run @actions.lookup_current_order
      with member_email=@variables.member_email
      set @variables.order_summary=@outputs.order_summary
      set @variables.order_id=@outputs.order_id

    | Show the user their order: {!@variables.order_summary}
```

## Share Information Between Subagents

You can use variables to share information, or state, between subagents. For example, to share the current temperature between all subagents in an agent, run the `Get_Current_Weather_Data` action and store the value of the temperature output in the global temperature variable.

```agentscript title="Example: Share Information Between Subagents"
reasoning:
    instructions: ->
        # always get the current weather data
        run @actions.Get_Current_Weather_Data
            with city=@variables.user_city
            # set the variable "temperature" with the
            # current temperature so that other subagent has that info
            set @variables.temperature = @outputs.temperature_celsius
```

## Let the LLM Set Variables with User-Entered Information (Slot Filling)

Use `...` to indicate that the LLM should use reasoning to set a variable's value. For example, the LLM can ask the user for their first and last name, then use the `capture_user_info` tool to set those values in the variables `first_name` and `last_name`. Using reasoning to set a variable's value is called slot filling.

For simple workflows, the LLM can figure out which actions to call based on the action's description and name. In this example, we explicitly reference `{!@capture_user_info}` in the instructions to be sure the LLM stores the user information.

```agentscript title="Example: Let the LLM Set Variable Values"
reasoning:
    instructions: -> Ask the user for their full name. Then, use {!@actions.capture_user_info} to set the value of the user's first and last name.
    actions:
        capture_user_info: @utils.setVariables
            with first_name = ...
            with last_name = ...
            description: "Set the user's name as variables"
```

:::note
You can use slot-filling for top-level action inputs (which are called by the LLM), but not for chained action inputs (because they’re run deterministically).
:::

## Tips

- **Name variables clearly**. Use descriptive names like `order_return_eligible` not `flag1`.
- **In reasoning instructions, assign variables to action inputs and outputs**. When you run an action in reasoning instructions, you must manually set variables for the inputs and outputs because the action is run before any reasoning takes place.
- **In reasoning actions, use variables as action inputs sparingly**. Actions are made available to the agent when the agent has all the relevant action inputs, so specifying variables for too many inputs can cause the agent to select actions inconsistently. When you don't specify a variable as input, the agent can usually decide the best input. Specify variables as inputs only when necessary, based on testing.
- **Store action outputs in variables when applicable**. If you need to use them in conditional expressions, as required inputs to another action, or for other deterministic workflows.

## Related Topics

- Reference: [Variables](../reference/ascript-ref-variables.md)
- Reference: [Conditional Expressions](../reference/ascript-ref-expressions.md)
- Reference: [Actions](../reference/ascript-ref-actions.md)
