---
sidebar_label: "Reference"
---

# Agent Script Reference

Use this reference to look up Agent Script syntax, keywords, and concepts. For common patterns and examples, see [Agent Script Patterns](../patterns/ascript-patterns.md).

:::note
Beginning in April 2026, agent **topics** are now called **subagents**. There are no changes to functionality. During this transition, you may see a mix of the new and previous terms in our documentation
:::

## Syntax

This table lists some of the key terms used in an Agent Script file.

| Symbol                                | Description                                                                                                            | More Info                                                                |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `#`                                   | Single-line comment. For example: `# This is a comment`                                                                | [Comments](../ascript-lang.md#comments-to-help-the-humans)               |
| `...`                                 | Slot-fill token that instructs the LLM to set the value. For example: `with order_id = ...`                            | [Variables](ascript-ref-variables.md), [Utils](ascript-ref-utils.md)     |
| `->`                                  | Begins logic instructions. For example: `instructions: -> if @variables.verified:`                                     | [Reasoning Instructions](ascript-ref-instructions.md)                    |
| `\|`                                  | Begins prompt instructions. For example: `\| Help the customer with their order.`                                      | [Reasoning Instructions](ascript-ref-instructions.md)                    |
| `{!expression}`                       | Resolve a variable or resource in prompt instructions. For example: `{!@variables.promotion_product}`                  | [Reasoning Instructions](ascript-ref-instructions.md)                    |
| `==`, `!=`, `<`, `>`, `is None`, etc. | Comparison operators. For example: `@variables.count > 0`                                                              | [Supported Operators](ascript-ref-operators.md)                          |
| `@actions.name`                       | Reference an action. For example: `run @actions.get_order`                                                             | [Actions](ascript-ref-actions.md)                                        |
| `@outputs.name`                       | Reference an action's output value. For example: `set @variables.status = @outputs.status`                             | [Actions](ascript-ref-actions.md)                                        |
| `@subagent.name`                      | Delegate to another subagent. For example: `consult: @subagent.specialist`                                             | [Tools](ascript-ref-tools.md#referencing-a-subagent-as-a-tool)           |
| `@utils.escalate`                     | Define a tool that escalates to a human service rep. For example: `escalate: @utils.escalate`                          | [Utils](ascript-ref-utils.md#utilsescalate)                              |
| `@utils.setVariables`                 | Define a tool that instructs the LLM to set variable values. For example: `set_name: @utils.setVariables`              | [Utils](ascript-ref-utils.md#utilssetvariables)                          |
| `@utils.transition to`                | Define a tool that transitions to a different subagent. For example: `@utils.transition to @subagent.Order_Management` | [Utils](ascript-ref-utils.md#utilstransition-to)                         |
| `@variables.name`                     | Reference a variable from logic instructions. For example: `@variables.order_id`                                       | [Variables](ascript-ref-variables.md)                                    |
| `actions`                             | Define agent actions or tools available from a subagent.                                                               | [Actions](ascript-ref-actions.md), [Tools](ascript-ref-tools.md)         |
| `after_reasoning`                     | Run logic after the reasoning loop exits.                                                                              | [After Reasoning](ascript-ref-before-after-reasoning.md)                 |
| `available when`                      | Conditionally show or hide a tool. For example: `available when @variables.verified == True`                           | [Tools](ascript-ref-tools.md)                                            |
| `config`                              | Top-level block for agent configuration.                                                                               | [Config Block](../ascript-blocks.md#config-block)                        |
| `connection`                          | Top-level block for external connections like Enhanced Chat. For example: `connection messaging:`                      | [Connection Block](../ascript-blocks.md#connection-block)                |
| `if` / `else`                         | Conditional branching. For example: `if @variables.is_member == True:`                                                 | [Conditional Expressions](ascript-ref-expressions.md)                    |
| `instructions`                        | Guidance for the LLM within system or reasoning blocks.                                                                | [Reasoning Instructions](ascript-ref-instructions.md)                    |
| `language`                            | Top-level block for supported languages.                                                                               | [Language Block](../ascript-blocks.md#language-block)                    |
| `linked`                              | Declare a variable whose value comes from an external source. For example: `session_id: linked string`                 | [Variables](ascript-ref-variables.md#linked-variables)                   |
| `messages`                            | System messages like welcome and error prompts.                                                                        | [System Block](../ascript-blocks.md#system-block)                        |
| `mutable`                             | Allow a variable's value to be changed. For example: `order_id: mutable string = ""`                                   | [Variables](ascript-ref-variables.md#regular-variables)                  |
| `reasoning`                           | Block containing instructions and tools for the LLM.                                                                   | [Reasoning Instructions](ascript-ref-instructions.md)                    |
| `reasoning.actions`                   | Tools the LLM can choose to call within a subagent.                                                                    | [Tools (Reasoning Actions)](ascript-ref-tools.md)                        |
| `reasoning.instructions`              | Prompt and logic instructions sent to the reasoning engine.                                                            | [Reasoning Instructions](ascript-ref-instructions.md)                    |
| `run`                                 | Execute an action deterministically. For example: `run @actions.get_order`                                             | [Actions](ascript-ref-actions.md#call-an-action-in-the-reasoning-logic)  |
| `set`                                 | Store a value in a variable. For example: `set @variables.status = @outputs.status`                                    | [Variables](ascript-ref-variables.md), [Actions](ascript-ref-actions.md) |
| `start_agent`                         | Entry point block for subagent classification and routing. For example: `start_agent agent_router:`                    | [Start Agent Block](../ascript-blocks.md#start-agent-block)              |
| `system`                              | Top-level block for agent instructions and messages.                                                                   | [System Block](../ascript-blocks.md#system-block)                        |
| `system.instructions`                 | Override system instructions for a specific subagent.                                                                  | [System Overrides](../patterns/ascript-patterns-system-overrides.md)     |
| `target`                              | The flow or action target for an agent action. For example: `target: "flow://Get_Order"`                               | [Actions](ascript-ref-actions.md)                                        |
| `subagent`                            | Top-level block defining a subagent's instructions and actions. For example: `subagent Order_Management:`              | [Subagent Blocks](../ascript-blocks.md#subagent-blocks)                  |
| `topic`                               | Deprecated. Use `subagent` instead.                                                                                    | [Subagent Blocks](../ascript-blocks.md#subagent-blocks)                  |
| `transition to`                       | Move to a different subagent from logic instructions. For example: `transition to @subagent.wrap_up`                   | [Utils](ascript-ref-utils.md#utilstransition-to)                         |
| `variables`                           | Top-level block for global agent variables.                                                                            | [Variables](ascript-ref-variables.md)                                    |
| `with`                                | Bind an input parameter. For example: `with order_id = @variables.order_id`                                            | [Actions](ascript-ref-actions.md)                                        |

## Concepts

These reference topics cover key concepts and terms associated with Agent Script.

- **[Actions](ascript-ref-actions.md)** - Define executable tasks that an agent can perform, such as running a flow or transitioning to a new subagent.

- **[After Reasoning](ascript-ref-before-after-reasoning.md)** - Optional block inside a subagent that runs after the reasoning loop exits.

- **[Blocks](../ascript-blocks.md)** - The structural components of an Agent Script, where each block contains a set of properties that describe data or procedures.

- **[Conditional Expressions](ascript-ref-expressions.md)** - Deterministically specify what actions to take or which prompts to include based on the current context.

- **[Reasoning Instructions](ascript-ref-instructions.md)** - Instructions that Agentforce resolves into a prompt for the LLM.

- **[Start Agent Block](../ascript-blocks.md#start-agent-block)** - A special subagent used for subagent classification, filtering, and routing.

- **[Supported Operators](ascript-ref-operators.md)** - The comparison, logical, and arithmetic operators you can use in Agent Script.

- **[Tools (Reasoning Actions)](ascript-ref-tools.md)** - Executable functions that the LLM can choose to call, based on the tool's description and current context.

- **[Subagents](../ascript-blocks.md#subagent-blocks)** - A set of instructions, actions, and reasoning that defines a job that an agent can do.

- **[Utils](ascript-ref-utils.md)** - Utility functions used as tools, such as transitioning to subagents or setting variable values.

- **[Variables](ascript-ref-variables.md)** - Let agents track information across conversation turns.
