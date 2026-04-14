---
sidebar_label: "After Reasoning"
---

# Agent Script Reference: After Reasoning

Agentforce runs a subagent's `after_reasoning` block after the reasoning loop exits, on every request. The `after_reasoning` block can contain logic, actions, transitions, or other directives, but can't contain the `|` (pipe) command. Typical use cases are to set customer-entered information into a variable, transition to a different subagent, or run an action.

For example, this `after_reasoning` block sets the appointment duration based on the urgency level.

```agentscript title="After Reasoning Instructions"
after_reasoning:->
    if @variables.urgency_level == "urgent":
        set @variables.estimated_duration = 15
    if @variables.urgency_level == "routine":
        set @variables.estimated_duration = 30
```

To see how Agentforce creates an LLM prompt from a subagent that contains an `after_reasoning` block, see [Example: How Agentforce Creates a Prompt from a Subagent](../ascript-flow.md#example-how-agentforce-creates-a-prompt-from-a-subagent).

:::note
Agentscript also supports a `before_reasoning` block with the same capability and syntax as the `after_reasoning` block. The `before_reasoning` block is functionally equivalent to adding logic to the beginning of a subagent's instructions.
:::

## Transitions in after_reasoning

If a subagent [transitions](ascript-ref-utils.md#utilstransition-to) to a new subagent partway through execution, the original subagent's `after_reasoning` block isn't run. When calling [transitions](../ascript-flow.md#transitioning-between-subagents) in after reasoning, use `transition to` rather than `@utils.transition to`. For example:

```agentscript title="Transitions in After Reasoning"
after_reasoning:
    if @variables.case_type != "":
        transition to @subagent.case_creation
```

## Related Topics

- [Reasoning Instructions](ascript-ref-instructions.md)
