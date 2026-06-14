---
sidebar_label: "Introduction"
---

# Get Started with Agent Script for Agentforce

Agent Script is a language for building predictable, context-aware agent workflows. It combines the flexibility of natural language instructions with the reliability of programmatic expressions, allowing you to create agents that balance LLM reasoning with deterministic logic.

:::note
We brought over this Salesforce documentation from the [Agentforce Developer Guide](https://developer.salesforce.com/docs/ai/agentforce/guide/get-started.html). This section contains documentation that is specific to Agentforce use cases and may contain references to Agentforce Builder.
:::

![Agent Script UI](/img/agent-script/agent-script-view2.png)

## What's Agent Script?

Agent Script is a domain-specific language designed for authoring conversational AI agents. It combines the flexibility of natural language instructions for handling conversational tasks with the reliability of programmatic expressions for handling business rules.

In Agent Script, you use expressions to:
- Define if/else conditions, transitions, and other control flow logic
- Set, modify, and compare variables to maintain state
- Select subagents and actions based on conditions
- Build predictable, context-aware workflows that don't rely solely on LLM interpretation

For example, you can use script to control when your agent transitions from one subagent to another or when actions run in a particular sequence (action chaining).

## Authoring Agent Script

There are multiple ways to author Agent Script:

- **Visual Tools**: Use [Agentforce Builder](/agentforce-builder/overview) for a visual authoring experience with Canvas and Script views
- **Code Editor**: Use the [Agentforce DX VS Code Extension](https://developer.salesforce.com/docs/ai/agentforce/guide/agent-dx.html) for local development with full language support
- **Text Editor**: Edit `.agent` files directly with any text editor - they're plain text files using YAML-like syntax


## What Can You Do with Agent Script?

Agent Script preserves the conversational skills and complex reasoning ability derived from natural language prompts, and it adds the determinism of programmatic instructions. For example, in Agent Script, you can define:

- Specific areas where an LLM is free to make reasoning decisions. See [Reasoning Instructions](reference/ascript-ref-instructions.md).
- Specific areas where the agent must execute deterministically. See [Reasoning Instructions](reference/ascript-ref-instructions.md).
- Variables to reliably store information about the agent's current state, rather than relying on LLM context memory. See [Variables](reference/ascript-ref-variables.md).
- Conditional expressions to determine the agent's execution path or LLM's utterances. For example, you can instruct the agent to speak differently to the customer based on the value of the `is_member` variable. Or you can deterministically specify which action to run based on the value of the `appointment_type` variable. See [Conditional Expressions](reference/ascript-ref-expressions.md).
- Conditions under which the agent transitions to a new subagent. You can deterministically transition to a new subagent. Or you can expose a subagent transition to the LLM as a tool, allowing the LLM to decide when and whether to switch subagents. See [Tools](reference/ascript-ref-tools.md) and [Utils](reference/ascript-ref-utils.md).

## Example Agent Script

Here’s a simple example of what Agent Script looks like.

```agentscript title="Agent Script Example"
system:
    instructions: "You are a friendly and empathetic agent that helps customers with their questions."
    messages:
        error: "Sorry, something went wrong."
        welcome: "Hello! How are you feeling today?"

config:
    agent_name: "HelloWorldBot"
    default_agent_user: "hello@world.com"

language:
    default_locale: "en_US"
    additional_locales: ""

variables:
    isPremiumUser: mutable boolean = False
        description: "Indicates whether the user is a premium user."

start_agent hello_world:
    description: "Respond to the user."
    reasoning:
        instructions: ->
            if @variables.isPremiumUser:
                | ask the user if they want to redeem their Premium points
            else:
                | ask the user if they want to upgrade to Premium service
```

Among other compelling features, you can see in the above reasoning instructions that you can specify conditional logic (after the `->`) alongside LLM prompts (after the `|`). This combination gives you the advantages of predictable, deterministic logic, alongside the power of LLM reasoning.

## Next Steps

To learn how to build agents in Canvas view or by chatting with Agentforce, see [Build Enterprise-Ready Agents with the New Agentforce Builder](https://help.salesforce.com/s/articleView?id=ai.agent_builder_intro.htm) in Salesforce Help.

To learn more about Agent Script, review these topics.

- [Language Characteristics](./ascript-lang.md)
- [Agent Script Blocks](./ascript-blocks.md)
- [Flow of Control](./ascript-flow.md)
- [Agent Script Patterns](./patterns/ascript-patterns.md)
- [Agent Script Examples](./examples/ascript-examples.md)
- [Manage Agent Script Agents](./ascript-manage.md)
- [Agent Script Reference](reference/ascript-reference.md)
