---
sidebar_label: "Action Chaining"
---

# Agent Script Pattern: Action Chaining and Sequencing

Run multiple actions in a guaranteed sequence.

Action chaining can be implemented in multiple ways depending on when and how you need actions to execute. You can run actions sequentially in instructions, [chain reasoning actions](../reference/ascript-ref-tools.md), or combine actions with transitions and conditionals.

## Why Use This Pattern

Action sequencing ensures that one action can trigger another, creating reliable multi-step workflows without relying on the LLM to remember multiple steps.

**Pattern Example**: Get the user's order with one action, then immediately check return eligibility for that order in another action.

## Sequential Actions in Instructions

Call actions one after another in reasoning instructions. Both run deterministically before the prompt is sent to the LLM.

:::note
When you run an action in instructions, you must manually set variables for the inputs and outputs because the action is run before any reasoning takes place. See [Actions Reference](../reference/ascript-ref-actions.md).
:::

```agentscript title="Sequential Actions"
reasoning:
  instructions: ->
    # First action
    run @actions.lookup_current_order
      with member_email=@variables.member_email
      set @variables.order_summary=@outputs.order_summary

    # Next action
    run @actions.lookup_current_user
      with member_email=@variables.member_email
      set @variables.user_profile=@outputs.profile

    | Show the user their order summary and welcome them by name.
```

You can also store the output of one action in a variable, then use it as the input to another action, or as part of a subsequent prompt.

## Chained Actions in Reasoning Actions

Define a follow-up action that automatically runs when the LLM calls an action.

```agentscript title="Chained Actions"
reasoning:
  instructions: ->
    | If the user wants information, use {!@actions.my_action}.

  actions:
    my_action: @actions.my_action
      with foo=@variables.Foo
      set @variables.status = @outputs.status
      run @actions.other_action
        set @variables.some_other_result=@outputs.data
```

Whenever the LLM calls `my_action`, the agent automatically runs `other_action` afterwards.

## Run Action Then Transition

Run an action and then automatically transition to another subagent.

```agentscript title="Action Then Transition"
reasoning:
  instructions: ->
    | Call {!@actions.validate_user_ready} to check if the user is ready.

  actions:
    validate_user_ready: @actions.validate_user_ready
      with user_id=@variables.user_id
      set @variables.is_ready=@outputs.ready
      transition to @subagent.analyze_issue
```

## Conditional Chain

Chain actions conditionally based on the results of previous actions.

```agentscript title="Conditional Action Chain"
reasoning:
  instructions: ->
    # First action
    run @actions.check_eligibility
      with user_id=@variables.user_id
      set @variables.is_eligible=@outputs.eligible

    # Condition
    if @variables.is_eligible == True:

      # Conditional action
      run @actions.fetch_offer_details
        with user_id=@variables.user_id
        set @variables.offer=@outputs.offer

      | Present the offer: {!@variables.offer}
    else:
      | Explain that the user is not eligible for this offer.
```

## Tips

- **Use sequential instructions for deterministic flows**: When you always want actions to run in a specific order.
- **Use variables for action outputs**: If your second action needs an output from the first action, store the first action's outputs in a variable and assign it as an input to the second action.

## Related Topics

- Reference: [Actions](../reference/ascript-ref-actions.md)
- Reference: [Reasoning Instructions](../reference/ascript-ref-instructions.md)
- Reference: [Tools (Reasoning Actions)](../reference/ascript-ref-tools.md)
