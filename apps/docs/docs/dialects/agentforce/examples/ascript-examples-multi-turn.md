---
sidebar_label: "Multi-Topic Multi-Turn Sequencing (Hands-On)"
---

# Agent Script Example: Use a Step Variable to Enforce Subagent Workflows

To ensure that your agent follows your required subagent workflow during a multi-turn conversation, use a step variable to set the current subagent. Within a subagent, let the agent evaluate the customer's answer and set the step variable's next value accordingly.

## When to Use This Example

Use this example when your agent must:

- Ask all required questions in order, where the order can depend on previous answers.
- Evaluate whether each answer is complete and valid.
- Ask follow-up or clarifying questions when needed.
- Move to the next step only when the current step is complete.
- End early when a disqualifying answer is provided.

This pattern gives you predictable routing and subagent-level flexibility.

## How to Try This Example

1. Download the [InterviewAgent.agent](https://resources.docs.salesforce.com/rel1/doc/en-us/static/misc/InterviewAgent.agent).
2. In Agent Script, in the upper right, click the **down arrow** next to New Agent and select **New from Script**.
3. Paste the Interview Agent Script code into your new agent.
4. Click your agent to open it, then select **Preview**.
5. Enter something like `I'd like to apply for the position` and test your agent.

:::important
This agent provides an example of using step variables. It is not a production-ready agent.
:::

## How Routing Works

The `start_agent` subagent acts as a router. It checks the value of the `currentInterviewStep` variable and transitions to the corresponding subagent. For example, if the value of `currentInterviewStep` is `Permission`, this transition runs:

```agentscript title="Transition to Permission Topic"
start_agent agent_router:
    label: "Agent Router"
    description: "Welcome the user and determine the appropriate subagent based on user input"
    reasoning:
        instructions: ->
            if @variables.currentInterviewStep == "Permission":
                transition to @subagent.permission
```

This example uses these values for `currentInterviewStep`:

- `Permission`: Confirm candidate has the legal right to work in Wonderland.
- `Eligibility`: Ask if the candidate has passed their NCLEX-RN exam.
- `Availability`: Identify the candidate's earliest possible start date.
- `Competency`: Ask a question about Alice in Wonderland to ensure the candidate has read the book.
- `Salary`: Ask about expected salary and compensation preferences.
- `Human`: Candidate has passed the screen and questions are passed to a human for follow-up.
- `End`: Candidate doesn’t meet qualifications; end the interview.

In each subagent, the agent can call `@utils.setVariables` to update `currentInterviewStep` based on its evaluation of the candidate's response. For example, in the Eligibility subagent, the agent can set:

- `Availability` - if the candidate indicates they’ve passed the NCLEX-RN exam.
- `End` - if the candidate hasn’t passed the NCLEX-RN exam.

```agentscript
subagent eligibility:
    label: "Eligibility"
    description: "Ask if the candidate has passed their NCLEX-RN exam."

    reasoning:
        instructions: ->
            | Ask the candidate whether they have passed the NCLEX-RN exam.
              Request a simple yes or no response and the year passed if available.
              If they have not passed, acknowledge and explain that passing is required for the role.
              If the candidate has passed, call {!@actions.setCurrentInterviewStep} with currentInterviewStep set to "Availability".
              If the candidate is NOT eligible, call {!@actions.setCurrentInterviewStep} with currentInterviewStep set to "End".

        actions:
            setCurrentInterviewStep: @utils.setVariables
                description: "Set the CurrentInterviewStep variable"
                with currentInterviewStep = ...
```

## Workflow Diagram

This diagram shows the interview agent's workflow when selecting the subagents determined by the step variable.

![Multi Turn flow diagram](/img/agent-script/ascript-example-multiTurn.png)

## Related Topics

- Pattern: [Enforce Required Workflows Through Subagents In Multi Turn Conversations](../patterns/ascript-patterns-multi-turn.md)
- Pattern: [Subagent Transitions](../patterns/ascript-patterns-transitions.md)
