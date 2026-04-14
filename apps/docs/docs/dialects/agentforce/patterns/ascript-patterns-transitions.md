---
sidebar_label: "Transitions"
---

# Agent Script Pattern: Subagent Transitions

Move execution from one subagent to another using the `@utils.transition to` command.

Transitions move execution from one subagent to another. You can expose them as reasoning actions (sometimes described as [tools](../reference/ascript-ref-tools.md) in the developer guide) for the LLM to select, execute them deterministically with conditionals, or chain them after actions complete.

## Why Use This Pattern

Transitions route users to specialized subagents based on their needs. They're one way—when a transition occurs, Agentforce discards any prompt from the current subagent and processes the new subagent instead.

**Pattern Examples**: When a user asks about a refund, transition them from the General FAQ subagent to the specialized Returns subagent. Or, after validating a user's identity, automatically transition to the Order Management subagent to continue the conversation.

## Reasoning Transitions

The following transitions can occur based on the LLM's reasoning. Deterministic transitions are described in the next section.

### Transitions in Reasoning Actions

Expose transitions as reasoning actions (tools) that the LLM can choose to use.

```agentscript title="Transitions as LLM Reasoning Action"
start_agent agent_router:
  description: "Welcome the user and determine the appropriate subagent"

  reasoning:
    instructions: ->
      | Welcome the user and analyze their input to determine
        the most appropriate subagent to handle their request.

    actions:
      go_to_order: @utils.transition to @subagent.Order_Management
        description: "Handles order lookup, refunds, order updates."

      go_to_faq: @utils.transition to @subagent.General_FAQ
        description: "Handles FAQ lookup and common questions."

      go_to_escalation: @utils.transition to @subagent.Escalation
        description: "Escalate to a human representative."
```

### Filtered Transitions

Combine transitions with `available when` to control which subagents are accessible.

```agentscript title="Filtered Transitions"
reasoning:
  actions:
    go_to_identity: @utils.transition to @subagent.Identity
      description: "Verifies user identity"
      available when @variables.verified == False

    go_to_order: @utils.transition to @subagent.Order_Management
      description: "Handles order management"
      available when @variables.verified == True
```

See the [Filtering Pattern](./ascript-patterns-filtering.md).

### Transitions in Instructions

When exposing transitions as reasoning actions (tools), reference them in your prompt so the LLM knows when to use them.

```agentscript title="Reference Transitions"
reasoning:
  instructions: ->
    | If the user asks for a service agent or seems upset,
      go to {!@actions.go_to_escalation}.

  actions:
    go_to_escalation: @utils.transition to @subagent.Escalation
      description: "Escalate if requested or needed."
```

## Deterministic Transitions

The following transitions occur deterministically based on your instructions. Reasoning transitions are described in the previous section.

:::note
Transitions in reasoning instructions don’t use the `@utils.` prefix.
:::

### Conditional Transitions in Reasoning Instructions

Deterministically route users based on state or business rules.

```agentscript title="Conditional Transition"
reasoning:
  instructions: ->
    if @variables.loyalty_tier == "Platinum VIP":
      transition to @subagent.vip_support
```

The transition happens before the LLM processes any other instructions.

### Transition After Action

Chain a transition after an action completes.

```agentscript title="Transition After Action"
reasoning:
  instructions: ->
    | Call {!@actions.validate_user_ready} to check if the user is ready.

  actions:
    validate_user_ready: @actions.validate_user_ready
      with user_id=@variables.user_id
      transition to @subagent.analyze_issue
```

## Tips

### Reasoning Transition Tips

- **Use descriptive subagent names**: Names should clearly indicate the subagent's purpose.
- **Provide clear descriptions**: Help the LLM understand when to use each transition.
- **Use the `go_to_` prefix**: Name transition actions with a `go_to_` prefix (for example, `go_to_orders`) so the agent understands they navigate to other subagents.
- **Reference transitions in prompt**: When exposing transitions as reasoning actions, you can reference them in your prompt (for example, `{!@actions.go_to_escalation}`) so the LLM knows when to use them.

### Deterministic Transition Tips

- **Use deterministic transitions sparingly**: Only when you need guaranteed routing; otherwise let the LLM choose.
- **Place transitions first**: When using conditional transitions, put them at the top of instructions so they execute before any other instructions. If the agent transitions to another subagent before reasoning, no prompt is sent to the LLM. Prior instructions aren't used or preserved, so executing them just increases latency and (in the case of running an action) can incur costs.
- **Avoid transition loops**: Ensure your subagent flow doesn't create infinite loops. For example, you don't want to introduce some logic that causes a transition from subagent A to subagent B but also causes a transition from subagent B back to A, and then repeat.

## Related Topics

- Pattern: [Agent Router](ascript-patterns-topic-selector.md)
- Pattern: [Required Subagent Flow](ascript-patterns-required-flow.md)
- Reference: [Utils](../reference/ascript-ref-utils.md)
- Reference: [Tools (Reasoning Actions)](../reference/ascript-ref-tools.md)
- Reference: [Flow of Control](../ascript-flow.md)
