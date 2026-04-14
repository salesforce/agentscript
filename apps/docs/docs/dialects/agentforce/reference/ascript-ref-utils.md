---
sidebar_label: "Utils"
---

# Agent Script Reference: Utils

Utils are utility functions that can be used as tools, for example transition to subagents, run actions, or instruct the LLM to set variable values based on a customer's utterance.

## utils.transition to

Tells the agent to move to a different subagent. For examples and patterns, see the [Transitions Pattern](../patterns/ascript-patterns-transitions.md).

Transitions are one way. There's no return of control to the calling subagent. `transition to` executes immediately when encountered. The execution of the current directive block is halted, and control is passed to the new subagent.

You can signal a hand off immediately after an action completes by including transition logic in the `actions:` block. However, this may not occur until all actions are run.

```agentscript title="Utils.Transition to: Subagent Routing"
# during reasoning

reasoning:
    actions:
        go_to_identity: @utils.transition to @subagent.Identity
            description: "verifies user identity"
            available when @variables.verified == False
        go_to_order: @utils.transition to @subagent.Order_Management
            description: "Handles order lookup, refunds, order updates, and summarizes status, order date, current location, delivery address, items, and driver name."
            available when @variables.verified == True
        go_to_faq: @utils.transition to @subagent.General_FAQ
            description: "Handles FAQ lookup and provides answers to common questions."
            available when @variables.verified == True
```

This code sample provides multiple transitions for order management, user verification, and answering common questions. Because these particular transitions are specified from within the reasoning actions, they can be executed by the reasoning engine when applicable. See [Tools (Reasoning Actions)](ascript-ref-tools.md).

You can also transition to a subagent from your reasoning instructions using `transition to`. This sample transitions based on a variable state.

```agentscript title="Utils.Transition to: Conditional Approval Workflow"
if @variables.approval_required:
    transition to @subagent.approval_workflow
```

When the specified subagent has completed, the flow of control doesn't return to the original subagent, so you must explicitly create a transition back to the original subagent if that's what you want. When transitioning back to a subagent, the flow starts at the beginning of the subagent, not where it last left off.

```agentscript title="Utils.Transition to: Flow of Control"
# in topic A, specify that the flow of control jumps to topic_b

search_another: @utils.transition to @subagent.topic_b
    description: "Search for another order"

# in topic B, specify that the flow of control goes (back) to topic_a

back_to_order: @utils.transition to @subagent.topic_a
    description: "Return to order details"
```

See [Referencing a Subagent as a Tool](ascript-ref-tools.md#referencing-a-subagent-as-a-tool).

## utils.setVariables

Tells the agent to define a variable based on the natural language description. The `…` token instructs the LLM to set the value of the variable.

The `description` instructs the LLM on how to set the value of the variable.

```agentscript title="Utils.setVariables: Get First Name"
reasoning:
    actions:
        set_first_name_variable: @utils.setVariables
            with first_name = ...
            description: "Get the user's first name"
```

## utils.escalate

Tells the agent to escalate to a human service rep. To use `utils.escalate`, you need an active Omni-Channel connection. This must be defined in a `connection messaging` block with `outbound_route_type` and `outbound_route_name` values. See [Agent Script Connection Block](../ascript-blocks.md#connection-block) and [Transfer Conversations from an Agent with an Omni-Channel Flow](https://help.salesforce.com/s/articleView?id=ai.service_agent_escalation.htm). The escalate utility function can be used instead of an escalation subagent.

```agentscript title="Utils.escalate: Escalate to Human Rep"
subagent my_topic_name:
    reasoning:
        instructions:
            | call the action {!@actions.escalate_to_human} if the user wants to speak with a human rep
        actions:
            escalate_to_human: @utils.escalate
                description: "Call this when you need to escalate to a human rep"
                available when @variables.in_business_hours
```

:::note
`escalate` is a reserved keyword and can't be used for subagent or action names.
:::

## Related Topics

- [Flow of Control](../ascript-flow.md)
- Pattern: [Transitions](../patterns/ascript-patterns-transitions.md)
- Reference: [Tools (Reasoning Actions)](ascript-ref-tools.md)
- Reference: [Variables](ascript-ref-variables.md)
