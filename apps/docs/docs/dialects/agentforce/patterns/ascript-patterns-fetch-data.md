---
sidebar_label: "Fetch Data"
---

# Agent Script Pattern: Fetch Data Before Reasoning

Run actions to retrieve data before the LLM begins reasoning.

Place action calls at the top of your reasoning instructions to fetch data before the prompt is constructed. This ensures the LLM has access to current, accurate information when generating responses.

## Why Use This Pattern

Fetching before reasoning ensures the LLM has accurate, current data. For example, you can store the output of an action in a variable and use it to personalize instructions. Or you can create a filter based on the variable to refine the prompt that's sent to the LLM. Actions inside reasoning instructions execute **before** the prompt is sent to the LLM.

**Pattern Example**: Look up the user's current order before the conversation starts so the agent can greet them with their order status and personalized recommendations.

## Basic Pattern

```agentscript title="Fetch Order Data"
reasoning:
  instructions: ->

    # Check if data has been fetched
    if @variables.order_summary == "":

      # If not, fetch data with an action
      # (and store results in a variable)
      run @actions.lookup_current_order
        with member_email=@variables.member_email
        set @variables.order_summary=@outputs.order_summary

    # Reference the variable in the prompt
    | Refer to the user by name {!@variables.member_name}.
      Show them their current order summary: {!@variables.order_summary}.
```

The pattern:

1. Check if data has already been fetched
2. If not, run the lookup action
3. Store results in a variable
4. Reference the variable in the prompt

## Fetch and Validate

Fetch data and immediately check it to determine what options to present.

```agentscript title="Fetch and Validate Eligibility"
reasoning:
  instructions: ->
    if @variables.order_summary == "":
      run @actions.lookup_current_order
        with member_email=@variables.member_email
        set @variables.order_summary=@outputs.order_summary

    | If user wants to make a return:
    if @variables.order_summary.days_since_order <= 60:
      set @variables.return_eligibility = true
      | Offer to process return using {!@actions.create_return}.
    else:
      | Politely explain the return period has expired.
```

## Tips

- **Avoid unnecessary calls**: Always check if data exists (`if @variables.data == ""`) before making a call to fetch data to avoid running actions unnecessarily.

## Related Topics

- Reference: [Reasoning Instructions](../reference/ascript-ref-instructions.md)
- Reference: [Actions](../reference/ascript-ref-actions.md)
- Reference: [Variables](../reference/ascript-ref-variables.md)
