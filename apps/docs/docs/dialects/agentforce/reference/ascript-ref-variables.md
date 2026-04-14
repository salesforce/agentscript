---
sidebar_label: "Variables"
---

# Agent Script Reference: Variables

Variables let agents deterministically remember information across conversation turns, track progress, and maintain context throughout the session. You define all variables in the `variables` block, and all subagents in the agent can access the variables.

There are several types of variables:

- **[regular variable](#regular-variables):** You can initialize a variable with a default value, and the agent can change the variable's value.
- **[linked variable](#linked-variables):** The value of a linked variable is tied to an output such as an action's output. Linked variables can't have a default value.
- **[system variable](#system-variables):** Predefined, prepopulated system variables that you can use in your agent.

## Variable Names

Variable names must follow Salesforce developer name standards:

- Begin with a letter, not an underscore.
- Contain only alphanumeric characters and underscores.
- Can't end with underscore.
- Can't contain consecutive underscores (\_\_).
- Maximum length of 80 characters.

## Referencing Variables

To reference a variable from the script, use `@variables.<variable_name>`. To reference a variable from within reasoning instructions, use `{!@variables.<variable_name>}`.

## Regular Variables

Regular variables have these properties:

- `mutable` - Optional. Allows the agent to change the variable's value. To ensure a variable's value is never changed, define the variable without `mutable`.
- `description` - describes the variable. Optional. If you want the LLM to use reasoning to set the variable's value, include a description. See [Let the LLM set variables with user-entered information (slot filling)](../patterns/ascript-patterns-variables.md#let-the-llm-set-variables-with-user-entered-information-slot-filling).
- `label` - Optional. The variable's name as displayed in the UI. By default, the description is generated from the name. For example, if your variable's name is `my_var`, the UI displays the label `My Var`.

```agentscript title="Example: Define Regular Variables"
variables:
    isPremiumUser: mutable boolean = False
        description: "Indicates whether the user is a premium user."
        label: "Has Gold Status"

    customer_loyalty_tier: mutable string = "standard"
        description:|
            Stores the customer's membership tier level.
            Valid values: standard, premium, platinum, vip.
            This value determines available services and pricing.
```

Regular variables can have these types:

| Type          | Notes                                                                                                              | Example                                                                                       |
| :------------ | :----------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------- |
| `string`      | Any alphanumeric string without special characters.                                                                | `name: mutable string = "John Doe2"`                                                          |
| `number`      | Use for both integers and decimals. For example, 42 or 3.14. Compiles to IEEE 754 double-precision floating point. | `age: mutable number = 25`, `price: mutable number = 99.99`                                   |
| `boolean`     | Allowed values are `True` or `False`. The value is case-sensitive, so capitalize the first letter.                 | `is_active: mutable boolean = True`                                                           |
| `object`      | Value is a complex JSON object in the form `{"key": "value"}.`                                                     | `order_line: mutable object = {"SKU": "abc12344409","count": 42}`                             |
| `date`        | Any valid date format.                                                                                             | `start_date: mutable date = 2025-01-15`                                                       |
| `id`          | A Salesforce record ID.                                                                                            | `"0015000000XyZ12"`                                                                           |
| `list [type]` | A list of values of the specified type. All primitive types are supported.                                         | `flags: mutable list[boolean] = [True, False, True]`, `scores: list[number] = [95, 87.5, 92]` |

## Linked Variables

A linked variable's value is tied to a source, such as an action's output. Linked variables have these restrictions:

- can't have a default value
- can't be set by the agent
- can't be an object or a list

```agentscript title="Example: Define a Linked Variable"
variables:
    session_id: linked string
        description: "The session ID, linked to the current session"
        source: @session.sessionID
```

Linked variables can have these types:

- `string`
- `number`
- `boolean`
- `date`
- `id`

## System Variables

Agent Script provides predefined, prepopulated system variables that you can use in your agent. To access system variables, use `@system_variables.<variable_name>`. A system variable is:

- read-only, so you can't change its value
- predefined, so you don't define it in the `variables` block
- used in the same places as a regular variable or a linked variable

Currently, `@system_variables.user_input` is the only system variable.

### `@system_variables.user_input`

The `user_input` system variable contains the customer's most recent utterance (**not** the entire conversation history).

:::note
The LLM remembers the entire conversation history, so you don't typically need to use `@system_variables.user_input` unless you're passing the last thing a customer said into an action.
:::

#### Example - Analyze Customer Sentiment

In this example, we pass the last customer utterance into a sentiment analysis action. Although the agent's LLM can also analyze sentiment, we want to use a prompt template action that understands industry-specific terminology and our customer's rapidly-changing language patterns.

```agentscript title="Example: Analyze sentiment of most recent customer utterance"
reasoning:
    actions:
        AnalyzeSentiment: @actions.AnalyzeSentiment
            with utterance = @system_variables.user_input
            set @variables.customer_sentiment = @outputs.sentiment_classification
```

## Examples and Patterns

For examples and patterns using variables, see [Agent Script Pattern: Using Variables Effectively](../patterns/ascript-patterns-variables.md).

## Related Topics

- Pattern: [Using Variables Effectively](../patterns/ascript-patterns-variables.md)
- [Flow of Control](../ascript-flow.md)
- Reference: [Utils](ascript-ref-utils.md)
