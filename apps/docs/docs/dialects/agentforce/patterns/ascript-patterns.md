---
sidebar_label: "Patterns"
---

# Agent Script Common Patterns

This section provides common patterns for building agents with Agent Script. Each pattern focuses on a specific technique you can use to make your agents more reliable and effective.

## Available Patterns

| Pattern                                                                                              | Description                                                            |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| [Action Chaining & Sequencing](ascript-patterns-action-chaining.md)                                  | Run multiple actions in a guaranteed sequence                          |
| [Agent Router](ascript-patterns-topic-selector.md)                                                   | Set up effective subagent routing in the start_agent block             |
| [Conditionals](ascript-patterns-conditionals.md)                                                     | Use if/else logic to control instructions, actions, and transitions    |
| [Context Engineering](https://help.salesforce.com/s/articleView?id=ai.agent_context_engineering.htm) | Apply context engineering strategies with your Agentforce agents       |
| [Fetch Data](ascript-patterns-fetch-data.md)                                                         | Run actions to retrieve data before the LLM begins reasoning           |
| [Filtering with Available When](ascript-patterns-filtering.md)                                       | Control when subagents and actions are visible to the reasoning engine |
| [Required Subagent Workflow](ascript-patterns-required-flow.md)                                      | Guarantee users pass through required steps before proceeding          |
| [Resource References](ascript-patterns-resource-references.md)                                       | Reference variables and actions directly in reasoning instructions     |
| [System Overrides](ascript-patterns-system-overrides.md)                                             | Override global system instructions to change behavior per subagent    |
| [Transitions](ascript-patterns-transitions.md)                                                       | Move execution between subagents with `@utils.transition to`           |
| [Variables](ascript-patterns-variables.md)                                                           | Store and use state effectively across subagents                       |

## General Guidance

When building agents with Agent Script, keep these principles in mind:

- **Start with simple reasoning instructions.** Start with the fewest instructions necessary for an agent to perform as expected. Add instructions as needed as you preview user conversations for different use cases, and then test for regressions between each change.
- **Use good names and descriptions.** Clear names for subagents, actions, and variables help your agent make better decisions.
  - Good names and descriptions are specific, distinct, and clearly related to the agent's task.
  - Review names and descriptions for other subagents, actions, and variables in your agent to ensure that the names and descriptions are distinct and don't overlap.
  - Use plain language that end users are likely to use and understand, not technical terms. This makes it easier for the agent to match a user's question or request to a relevant subagent, action, or variable.
  - Use language consistently throughout. When language is ambiguous, an agent can apply instructions inconsistently or incorrectly. For example, instead of naming an action “Get Client Info” and naming another action "Verify Customer," use the term “customer” in both.
- **Add determinism strategically**. Balance natural language instruction with deterministic logic expressions to get the most out of your agent's capabilities. Add logic for business workflows to increase predictable behavior.
- **Reference resources directly in reasoning instructions**. "@ mention" references to subagents, actions, and variables to give the LLM explicit guidance. References to resources increase the likelihood that your agent will use the resource as intended.

## Resources

- [An Agentforce Guide to Context Engineering](https://help.salesforce.com/s/articleView?id=ai.agent_context_engineering.htm)
- [Agent Script Examples](../examples/ascript-examples.md)
- [Agent Script Reference](../reference/ascript-reference.md)
