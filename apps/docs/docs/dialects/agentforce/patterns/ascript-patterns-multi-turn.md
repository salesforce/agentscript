---
sidebar_label: "Multi-Topic Multi-Turn Workflows"
---

# Agent Script Pattern: Enforce Required Workflows Through Subagents In Multi Turn Conversations

Ensure your agent adheres to your subagent sequencing rules through multi-turn conversations, even when your sequencing rules are complex. Use a step variable to control which subagent the agent router selects. Within a subagent, allow the agent to evaluate the customer's answer and set the step variable for the next step.

## Why Use This Pattern

Use this pattern when:

- The agent must ask a long sequence of required questions and validate each answer before moving to the next question
- The next question asked depends on the previous question's answer
- The agent may spend many turns in a single subagent, for example clarifying a specific salary requirement or explaining certification equivalency.

### When Not to Use This Pattern

Use the simpler pattern in [Enforce Required Workflows for a Subagent](ascript-patterns-required-flow.md) when you only need a single prerequisite gate, such as verification before routing, or a one-subagent prerequisite like collecting `order_id` before order help.
**Pattern Examples**:

- Screening or intake flows where each question gates the next one.
- Compliance-driven interviews where required questions must be asked in order.
- Qualification flows where invalid or incomplete answers require follow-up before progression.

## Example: Step-Driven Interview Questions

In this pattern, `start_agent` uses the `currentInterviewStep` variable to select the current subagent. In each subagent, the agent asks the customer a specific set of questions. Based on the customer's response, the agent sets the value of the `currentInterviewStep` variable, controlling what the next subagent in the sequence will be.

For example, in the `permission` subagent, the agent asks the customer whether they have legal permission to work in the region.

- If the customer **does** have permission, the agent sets `currentInterviewStep` to `Eligibility`, ensuring the agent router routes to the `eligibility` subagent.
- If the customer **doesn't** have permission, the agent sets `currentInterviewStep` to `End`, ensuring the agent router routes to the `end_interview` subagent.

```agentscript title="Step-Based Agent Router"
start_agent agent_router:
    label: "Agent Router"

    description: "Welcome the user and determine the appropriate subagent based on user input"

    reasoning:
        instructions: ->
            if @variables.currentInterviewStep == "Permission":
                transition to @subagent.permission
            if @variables.currentInterviewStep == "Eligibility":
                transition to @subagent.eligibility
            if @variables.currentInterviewStep == "Availability":
                transition to @subagent.availability
            if @variables.currentInterviewStep == "End":
                transition to @subagent.end_interview


subagent permission:
    label: "Permission"

    description: "Confirm the candidate has the legal right to work in Wonderland."

    reasoning:
        instructions: ->
            | Confirm whether the candidate has the legal right to work in Wonderland.
              Ask a clear yes or no question and allow the candidate to provide context if needed.
              If the candidate confirms eligibility, acknowledge and advise the next step.
              If the candidate is not eligible or refuses to answer, advise that the role requires work authorization.
              If the candidate is eligible, call {!@actions.setCurrentInterviewStep} with currentInterviewStep set to "Eligibility".
              If the candidate is NOT eligible, call {!@actions.setCurrentInterviewStep} with currentInterviewStep set to "End".

        actions:
            setCurrentInterviewStep: @utils.setVariables
                description: "Set the CurrentInterviewStep variable"
                with currentInterviewStep = ...
```

## Tips

- **Keep one responsibility per subagent**: Design each subagent to validate one required answer, then move to the next step.
- **Use explicit step names**: Use clear values like `permission`, `eligibility`, and `availability` so routing remains easy to read and maintain.
- **Let subagents own completion logic**: The subagent should decide when an answer is satisfactory and continue asking follow-ups until it is.

## Related Topics

- Pattern: [Transitions](ascript-patterns-transitions.md)
- Pattern: [Conditionals](ascript-patterns-conditionals.md)
- Pattern: [Enforce Required Workflows for a Subagent](ascript-patterns-required-flow.md)
