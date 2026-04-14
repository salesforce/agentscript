---
sidebar_label: "Conditionals"
---

# Agent Script Pattern: Using Conditionals

Use conditionals to deterministically control agent behavior based on variable values. Conditionals evaluate before the prompt reaches the LLM.

## Why Use This Pattern

Conditionals let you make deterministic decisions about which instructions are included in the prompt, which actions run, or which subagents to transition to. Conditionals don't rely on LLM interpretation.

**Pattern Example**: Show Gold members a thank-you message and their points balance, while Platinum VIP members see an exclusive welcome with additional perks.

## Conditional Instructions

Customize the prompt based on variable values.

```agentscript title="Conditional Instructions"
reasoning:
  instructions: ->
    | Refer to the user by name {!@variables.member_name}.

    if @variables.loyalty_tier == "Gold":
      | Thank the customer for being a Gold member.

    if @variables.loyalty_tier == "Platinum VIP":
      | Thank the customer for being a Platinum VIP member.
```

Only the relevant instruction is included in the prompt sent to the LLM.

- Prompt sent to LLM if the customer’s name is Jo Richards and they're a VIP member: `Refer to the user by Jo Richards. Thank the customer for being a Platinum VIP member.`
- Prompt sent to the LLM if the customer’s name is Jane Smith and they're a Gold member: `Refer to the user by Jane Smith. Thank the customer for being a Gold member.`

## Conditional Actions

Run actions only when specific conditions are met. In this example, the agent only looks up the current order if we don't have an order summary, improving response time and reducing system usage.

```agentscript title="Conditional Action"
reasoning:
  instructions: ->
    if @variables.order_summary == "":
      run @actions.lookup_current_order
        with member_email=@variables.member_email
        set @variables.order_summary = @outputs.order_summary

    | Show the user their order summary: {!@variables.order_summary}.
```

## Conditional Transitions

Route users to different subagents based on conditions.

```agentscript title="Conditional Transition"
reasoning:
  instructions: ->
    if @variables.loyalty_tier == "Platinum VIP":
      transition to @subagent.vip_support
```

The transition happens immediately, before the LLM processes any other instructions. See [Required Subagent Flow](./ascript-patterns-required-flow.md) for related patterns.

## If/Else Logic

Handle mutually exclusive conditions with `if` and `else` logic.

```agentscript title="If-Else Logic"
reasoning:
  instructions: ->
    if @variables.order_summary.days_since_order <= 60:
      set @variables.return_eligibility = True
      | Offer to process return using {!@actions.create_return}.
    else:
      | Politely explain the return period has expired.
```

## Multiple Conditions

Keep in mind that you can combine conditions using `and` or `or`.

```agentscript title="Multiple Conditions"
reasoning:
  instructions: ->
    if @variables.verified == True and @variables.is_business_hours == True:
      | You can escalate to a live representative if needed.
```

## Tips

- **Initialize variables for reliable checks**: It's typically a good practice to give variables default values (for example, `= ""` or `= False`) so conditional checks work correctly.
- **Use `is None` for null checks**: Use `@variables.value is None` to check whether a variable has no value assigned. This check is different from checking for an empty string (`@variables.value == ""`), for example. The `== ""` expression checks for an empty string (which is a valid assignment), whereas `is None` checks for an unassigned value.
- **Keep conditions simple**: Complex nested conditions are hard to debug; consider breaking them into separate variables or subagents.

## Related Topics

- Pattern: [Required Subagent Flow](./ascript-patterns-required-flow.md)
- Reference: [Conditional Expressions](../reference/ascript-ref-expressions.md)
- Reference: [Supported Operators](../reference/ascript-ref-operators.md)
- Reference: [Reasoning Instructions](../reference/ascript-ref-instructions.md)
