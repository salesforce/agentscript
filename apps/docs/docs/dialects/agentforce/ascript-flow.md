---
sidebar_label: "Flow of Control"
---

# Agent Script Flow of Control

Understanding the order of execution and flow of control helps you to design better agents. Agentforce has these main execution paths:

1. First request to an agent
2. Processing a subagent
3. Transitioning between subagents

## First Request to an Agent

All requests, including the first request, begin at the agent router, the `start_agent` block. You typically use the `start_agent` subagent to set the initial value of variables, and to perform subagent classification. Subagent classification tells the LLM which subagent to choose based on the current context.

See [Start Agent Block](ascript-blocks.md#start-agent-block).

## Processing a Subagent

Agentforce uses a subagent's text instructions, variables, `if`/`else` conditions, and other programmatic instructions to create an LLM prompt. The reasoning instructions are processed sequentially, in top-to-bottom order. While the reasoning instructions can contain programmatic logic and text instructions, the LLM only starts reasoning after it has received the resolved prompt, not while Agentforce is still parsing.

If reasoning instructions contain a transition command, Agentforce immediately transitions to the specified subagent, discarding any existing resolved prompt. The final prompt only contains instructions that were resolved from the second subagent.

See [Reasoning Instructions](reference/ascript-ref-instructions.md).

### Example: How Agentforce Creates a Prompt from a Subagent

Agentforce processes a subagent to create a prompt, which it then sends to the LLM. Consider this subagent.

```agentscript title="Order Management Subagent"

subagent Order_Management:
    description: "Handles order inquiries."
    reasoning:
        instructions:->
            set @variables.num_turns = @variables.num_turns + 1
            run @actions.get_delivery_date
                with order_ID=@variables.order_ID
                set @variables.updated_delivery_date=@outputs.delivery_date

            | Tell the user that the expected delivery date for order number {!@variables.order_ID} is {!@variables.updated_delivery_date}

            run @actions.check_if_late
                with order_ID=@variables.order_ID
                with delivery_date=@variables.updated_delivery_date
                set @variables.is_late = @outputs.is_late

            if @variables.is_late == True:
                | Apologize to the customer for the delay in receiving their order.
    after_reasoning:
       if @variables.num_turns > 5:
           transition to @subagent.escalate_order

```

Suppose that:

- the order ID is `1234`
- the current delivery date is `February 10, 2026`
- the package is late
- the agent has entered this subagent twice in the current session, so `num_turns` is 2

Here's the prompt that Agentforce creates after processing the reasoning instructions:

```agentscript title="Agentforce Prompt After Processing"
Tell the user that the expected delivery date for order number 1234 is February 10, 2026.
Apologize to the customer for the delay in receiving their order.
```

#### How Agentforce Constructs the Prompt

To construct the prompt, Agentforce parses the reasoning instructions line by line, following these steps:

1. Initialize the prompt to empty.
2. Increments the global variable `num_turns` from 2 to 3.
3. Run the action `get_delivery_date`.
4. Set the variable `updated_delivery_date` to the value of `outputs.delivery_date`, which was returned by the action.
5. Concatenate this string to the prompt: `Tell the user that the expected delivery date for order number 1234 is February 10, 2026.`
6. Run action `check_if_late`.
7. Set the variable `is_late` to the value of `outputs.is_late`, which was returned by the action.
8. Check whether the value of `@variables.is_late` == `True`.
9. Concatenate this string to the prompt: `Apologize to the customer for the delay in receiving their order.`
10. Process the `after_reasoning` instructions, which don't transition because `num_turns` is 3.
11. Send the prompt to the LLM and return the LLM's response to the customer.

## Transitioning Between Subagents

You can transition between subagents from a reasoning action, reasoning instructions, or before and after reasoning blocks. A transition (using [@utils.transition to](reference/ascript-ref-utils.md#utilstransition-to)) is one-way and control doesn't return to the previous subagent. Agentforce discards any prompt instructions from the previous subagent. Then, Agentforce reads the second subagent from top to bottom. The final prompt contains only instructions from the second subagent.

After the second subagent completes, Agentforce waits for the next customer utterance, at which point it returns to the `start_agent` subagent.

In this example, we've defined a reasoning action called `go_to_account_help` that transitions to the subagent `account_help`.

```agentscript title="Transition Reasoning Action"
reasoning:
    actions:
        go_to_account_help: @utils.transition to @subagent.account_help
            description: "When a user needs help with account access"
```

For more about transitions and subagents, see [Referencing a Subagent as a Tool](reference/ascript-ref-tools.md#referencing-a-subagent-as-a-tool) and the reference documentation for [@utils.transition to](reference/ascript-ref-utils.md#utilstransition-to).

## Related Topics

- [Agent Script Patterns](./patterns/ascript-patterns.md)
- [Agent Script Reference](reference/ascript-reference.md)
