---
sidebar_label: "Language Characteristics"
---

# Agent Script Language Characteristics

Agent Script is a language designed by Salesforce specifically to build Agentforce agents. This page covers some key characteristics of the language before digging into the specifics.

## Compiled

Agent Script is a compiled language. When you save a version of the agent, the script compiles into lower-level metadata that is used by the reasoning engine.

## Determinism Plus Reasoning

Agent Script combines deterministic logic with LLM reasoning in a single workflow. This hybrid approach gives you predictable execution where you need it, while preserving the LLM's ability to handle nuanced conversations.

- **Logic instructions** (`->`) run deterministically every time. Use them for business rules, running actions, setting variables, and conditional branching.
- **Prompt instructions** (`|`) are natural language sent to the LLM. The LLM interprets these instructions and decides how to respond to the customer.

See [Flow of Control](ascript-flow.md), [Agent Script Patterns](./patterns/ascript-patterns.md), and [Reasoning Instructions](reference/ascript-ref-instructions.md).

## Declarative With Procedural Components

Agent Script has elements of both declarative and procedural languages so that you can build an agent that is both predictable and easy to maintain.

- A declarative language is a language where you directly _declare_ what you want rather than having to worry about the exact flow step by step. This type of programming language gives you the power to define and customize your agent, but without having to worry about the detailed flow. The basic [Agent Script Blocks](ascript-blocks.md) resemble a declarative language.
- A procedural language is a language where you specify how to execute commands in a specific order. We use elements from procedural languages so that you can specify instructions in logical steps. The logic in [reasoning instructions](reference/ascript-ref-instructions.md) resemble a procedural language.

## Human-Readable

Agent Script is designed to be human-readable so that even non-developers can get a basic understanding of how the agent works.

## Property-Based

Agent Script is made up of a collection of properties. Each property is shown as `key: value`. Some properties are multiple lines and some properties contain sub-properties, but the `key` is always before the colon (:) and the `value` is always after the colon.

```agentscript title="Agent Script Property"
description: "Get account info"
```

The top-level properties are called blocks. For instance, we call this section the config block.

```agentscript title="Agent Script Block"
config:
    developer_name: "Demo_Agent_1"
    default_agent_user: "digitalagent.demo@salesforce.com"
    agent_label: "Demo Agent"
    description: "This is my demo agent"
```

## Indentation and Formatting

Agent Script is whitespace-sensitive, similar to languages like Python or YAML, meaning that indentation is used to indicate structure and relationships between properties. To indicate that a value belongs to the previous line’s property, indent with at least 2 spaces or 1 tab. However, you must choose one indentation method and use it consistently throughout the entire script. All lines at the same nesting level must use the same indentation, and mixing spaces and tabs will cause parsing errors.

```agentscript title="Indentation"
inputs:
    input_1: string
    input_2: string
```

To specify logic instructions, use the arrow symbol ( `->` ) followed by indented instructions.

```agentscript title="Logic Instructions"
instructions: ->
    if @variables.ready_to_book:
        run @actions.get_account_info
            with account_id=@variables.account_id
            set @variables.hotel_code=@outputs.hotel_code
```

To specify multiline strings in reasoning instructions, descriptions, and system messages, use the pipe symbol ( `|` ).

```agentscript title="Multiline Subagent Instructions"
instructions:|
    Welcome to our service!
    Please provide details about your request.
    I'll help you with whatever you need.
```

The pipe symbol can also be used to switch to a prompt from logic-based instructions.

```agentscript title="Prompt Escape"
    reasoning:
        instructions: ->
            | You are assessing the customer's timing for making a decision.
              Follow these rules to determine what to ask:

            if @variables.Lead_Record.S4STiming != "":
                | Existing timing data found.
                  Current Timing Value: {! @variables.Lead_Record.S4STiming }

                  Ask: "From what we have, you're looking to make a decision by {! @variables.Lead_Record.S4STiming }. Is that still correct?"

                  Wait for their response before proceeding.
```

See [Reasoning Instructions](reference/ascript-ref-instructions.md) in the Agent Script Reference.

## Accessing Resources

You can access resources, such as actions, subagents, and variables, using the `@` symbol.

- `@actions.<action_name>`: References an action.
- `@subagent.<subagent_name>`: References a subagent.
- `@variables.<variable_name>`: References a variable.
- `@outputs.<output_name>`: References an action output.

To run an action, use the `run` command. Use the `with` command to provide inputs and use the `set` command to store outputs.

```agentscript title="Access Resources"
run @actions.show_great_example
   with QuestionRecordId=@variables.my_great_question
   set @variables.my_great_answer = @outputs.AnswerDescription
```

See [Actions](reference/ascript-ref-actions.md) in the Agent Script Reference.

When referencing a variable from within prompt text in reasoning instructions, you must specify the variable within brackets: `{!@variables.<variable_name>}`. For example:

```agentscript title="Variable Reference"
| Ask the user this question: {!@variables.my_question}
```

See [Variables](reference/ascript-ref-variables.md) in the Agent Script Reference.

You can specify a subagent as a tool available to the LLM. For more information, see [Tools (Reasoning Actions)](reference/ascript-ref-tools.md).

## Using Expressions

Agent Script uses familiar flow control syntax, such as `if` and `else`. It also uses basic mathematical expressions (`+`, `-`) and comparison expressions (`==`, `!=`, `>`, `<`). You can check for empty values using `is None` and `is not None`.

```agentscript title="Expressions"
if @variables.count >= 10:
    run @actions.count_achieved_announcement
else:
    run @actions.count_missed_announcement
```

See [Conditional Expressions](reference/ascript-ref-expressions.md) and [Supported Operators](reference/ascript-ref-operators.md) in the Agent Script Reference.

## Comments to Help the Humans

You can specify comments in Agent Script with the pound (`#`) symbol followed by the comment. The script ignores any content on the line after the pound symbol. Use this mechanism to document the script within the script.

```agentscript title="Comments"
# This is an agent sample script that demonstrates deterministic behavior
```
