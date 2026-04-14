---
sidebar_label: "Reasoning Instructions"
---

# Agent Script Reference: Reasoning Instructions

A subagent's reasoning block contains instructions that Agentforce resolves into a prompt for the LLM. The resolved prompt instructs the LLM to perform the subagent's purpose. See [Processing a Subagent](../ascript-flow.md#processing-a-subagent).

:::note
In general, shorter reasoning instructions result in more accurate and reliable results.
:::

In the example, the logic deterministically sends a verification code when an email address is present and saves returned values in variables. The prompt guides the user to provide and validate the code, with instructions to confirm the email and resend if needed.

```agentscript title="Reasoning Instructions: Appointment Options Prompt"
  reasoning:
    instructions: ->
      if @variables.member_email != "":
        run @actions.send_verification_code
          with email=@variables.member_email
          with member_number = @variables.member_number
          set @variables.verification_code=@outputs.verification_code
          set @variables.member_name=@outputs.member_name

      | Greet the user and inform them that to help them get started you've sent them a verification code via email.
        Ask the user for the verification code they received and verify it using {!@actions.validate_verification_code}.
        If the user says they did not receive the code, ask them to confirm their email and resend the verification code using {!@actions.send_verification_code}
```

To use variables in reasoning instructions, use `{!@variables.<variable_name>}`. The prompt is resolved with the variable's value.

There are two different parts of reasoning instructions: logic instructions and prompt instructions. Logic instructions are deterministic or [conditional expressions](ascript-ref-expressions.md) that determine certain requirements, run actions, and set variables. Prompt instructions are passed as natural language to the LLM if the conditions are met. The prompt instructions can still reference literal values through `@variables`, `@utils`, and `@actions`.

The `|` (pipe) command for multiline strings can also be used for indented multiline prompt instructions before or after the deterministic logic instructions are followed.

```agentscript title="Logic and Prompt Instructions"
reasoning:
    instructions: ->
        # LOGIC INSTRUCTIONS
        if @variables.ready_to_book:
            run @actions.get_account_info
                with account_id=@variables.account_id
                set @variables.hotel_code=@outputs.hotel_code
        run @actions.get_hotel_info
            with hotel_code=@variables.hotel_code
            set @variables.hotel_info = @outputs.hotel_info

        # PROMPT INSTRUCTIONS
        | You are a helpful assistant that can answer questions about a hotel.
          Here's the latest hotel information {!@variables.hotel_info}. If the user
          asks about availability, please use the action: {!@actions.get_availability} action
          that they give you the date range they are traveling on.
          If they indicate they wish to book, please transition over
          to a booking agent by calling the action {!@actions.transition_to_booking} action.
          If they indicate that they wish to ask about another hotel, use the {!@actions.lookup_hotel}
          action and tell them they'll be able to ask about that hotel.
```

**Related Topics**

- [Flow of Control](../ascript-flow.md)
- [Tools (Reasoning Actions)](ascript-ref-tools.md)
- [Variables](ascript-ref-variables.md)
- [Conditional Expressions](ascript-ref-expressions.md)
