---
sidebar_label: "Tools (Reasoning Actions)"
---

# Agent Script Reference: Tools (Reasoning Actions)

Tools are executable functions that the LLM can choose to call, based on the tool's description and the current context. You define tools in the subagent's `reasoning.actions` block. Tools can be [actions](ascript-ref-actions.md) or other [utilities](ascript-ref-utils.md).

Tools must wrap an action or a `@utils` function. Use `with` to bind parameters and `set` to assign output values to variables. You can use the `available when` parameter to deterministically specify when the tool is available.

:::tip
**Tools vs. Actions**. Agent Script has two `actions` blocks:

- **Subagent actions** (`subagent.actions`) — Available to you from logic-based reasoning instructions
- **Reasoning actions** (`subagent.reasoning.actions`) — Available to the LLM to call as needed, and can be referenced in your prompt-based instructions

Since reasoning actions can reference subagents and utilities in addition to regular subagent actions, we sometimes call them "tools" to reflect their broader uses. In Canvas view, this distinction is handled automatically, but it's important to understand when writing Agent Script directly.
:::

### How the LLM Decides Which Tool to Call

The LLM looks at the names and descriptions of all the tools when deciding whether to call a tool. Tools should have meaningful names and descriptions. To provide more context, you can explicitly reference a tool in the reasoning instructions.

For example, these reasoning instructions don't provide additional context about which tool to call.

```agentscript title="Example: No Specific Reasoning Instructions"
reasoning:
    instructions: ->
        | Use the action that best matches the user's message and the conversation context.
    actions:
        # This tool calls the Get_Customer_Info action
        lookup_customer: @actions.Get_Customer_Info
            with email=@variables.customer_email
            set @variables.customer_desc = @outputs.customer_description

        # This tool writes the customer-provided information
        # into the specified variables. The LLM can choose when to use it.
        capture_order_info: @utils.setVariables
            description: "Capture order search information from customer"
            with order_number=@variables.order_number
            with customer_email=@variables.customer_email
            available when @variables.customer_verified == True

        # This tool transitions to a subagent that
        # displays detailed information about the order
        show_order_details: @utils.transition to @subagent.order_details
            description: "Show detailed order information"
```

These reasoning instructions provide more details about when to use the `capture_order_info` tool.

```agentscript title="Example: Additional Context For Using the capture_order_info Tool "
reasoning:
    instructions: ->
        | If the customer is verified and provides their order number
           or email, use {!@actions.capture_order_info} to store the information.

           Otherwise, use the action that best matches the user's message and the conversation context.

    actions:
        # This tool calls the Get_Customer_Info action
        lookup_customer: @actions.Get_Customer_Info
            with email=@variables.customer_email
            set @variables.customer_desc = @outputs.customer_description

        # This tool writes the customer-provided information
        # into the specified variables. The LLM can choose when to use it.
        capture_order_info: @utils.setVariables
            description: "Capture order search information from customer"
            with order_number=@variables.order_number
            with customer_email=@variables.customer_email
            available when @variables.customer_verified == True

        # This tool transitions to a subagent that
        # displays detailed information about the order
        show_order_details: @utils.transition to @subagent.order_details
            description: "Show detailed order information"
```

### Defining When a Tool Is Available

Use `available when` to define the conditions that must exist for the LLM to use the tool.

```agentscript title="Example: Available When"
reasoning:
    actions:
        cancel_booking: @actions.cancel_booking
            with booking_id=@variables.current_booking_id
            available when @variables.booking_status == "active"

        admin_override: @actions.admin_override
            available when @variables.user_role == "admin"

        go_to_identity: @utils.transition to @subagent.Identity
             description: "verifies user identity"
             available when @variables.verified == False
```

## Referencing a Subagent as a Tool

In reasoning actions, you can reference a subagent directly with `@subagent.<topic_name>` or through a declarative transition ([`@utils.transition to`](ascript-ref-utils.md#utilstransition-to)). Use a direct `@subagent.<topic_name>` reference to delegate to a subagent, similar to an action or tool call. After the referenced subagent is run, the flow returns to the original subagent. This behavior is different from a declarative transition (`@utils.transition to`) in that transitions are one way, whereas a direct subagent reference returns to the original caller. If a referenced subagent includes a declarative transition, the flow follows that path until it ends, and then returns to the original subagent.

In this code sample, you can see both methods of calling another subagent.

```agentscript title="Example: Using Subagents as Tools"
reasoning:
    actions:

        # Transitions to the other subagent and does not return
        show_order_details: @utils.transition to @subagent.order_details
            description: "Show detailed order information"

        # Runs the other subagent as a tool, synthesizes the result, then can run more tools
        consult_specialist: @subagent.specialist_topic
            description: "Consult specialist for complex questions"
            available when @variables.needs_expert_help == True
```

## Related Topics

- [Flow of Control](../ascript-flow.md)
- [Actions](ascript-ref-actions.md)
- [Utils](ascript-ref-utils.md)
- [Variables](ascript-ref-variables.md)
