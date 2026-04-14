---
sidebar_label: "Conditional Expressions"
---

# Agent Script Reference: Conditional Expressions

`if` and `else` conditions deterministically specify what actions to take or which prompts to include. For example, you can check a variable's value and then run an action based on the result:

```agentscript title="Example: Conditionally Run an Action"
if @variables.tracking_number != "":
    run @actions.Get_Tracking_Updates
else:
    run @actions.Ask_Tracking_Number
```

You can also check a variable in order to set other variables.

```agentscript title="Example: Conditionally Set a Variable"
if @variables.order_number == "" and @variables.customer_email == "":
    set @variables.order_found = False
    set @variables.customer_verified = False
```

You can use a conditional expression to determine which natural-language prompt to include.

```agentscript title="Example: Conditionally Add a Prompt"
if @variables.is_late == True:
    | Apologize to the customer for the delay in receiving their order.
else:
    | Tell the customer their order is arriving as scheduled.
```

:::note
Currently, Agent Script supports `if` and `else` logic, but it doesn't support `else if` logic after an `if` statement.
:::

**Related Topics**

- [Reasoning Instructions](ascript-ref-instructions.md)
- [Supported Operators](ascript-ref-operators.md)
