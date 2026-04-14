---
sidebar_label: "Actions"
---

# Agent Script Reference: Actions

An action defines a task that a subagent can perform, such as calling a Flow, a prompt template, or an Apex class. You can store the action's output in a variable, make the output available to the reasoning engine, and choose whether the LLM can display the output to customers.

A subagent can have many actions. You can import an action from a library or define it directly in the subagent. Subagents don't share actions - each action is unique to a subagent. If you import an action to a subagent, the subagent gets its own copy of the imported action.

You define a subagent's actions in the `actions` block.

#### Deterministically Call an Action

You can call the action explicitly from the logic section of a subagent's `reasoning` block. In this case, the action is run every time the subagent is run, as the agent parses the subagent.

You can also call the action from the subagent's `after_reasoning` block. In this case, the action is run after the subagent exits, every time the subagent is run.

#### Allow the LLM to Subjectively Use an Action

You can _also_ expose the defined action to the LLM in the subagent's `reasoning.actions` block, which is where [tools](ascript-ref-tools.md) are specified. In this case, Agentforce passes the tool with your specified inputs to the LLM after parsing the entire subagent. The LLM can subjectively choose to run the tool based on the current context. _If_ the tool is run, it's run when the LLM receives the resolved prompt, not when the agent parses the subagent.

To provide more explicit instructions to the LLM, you can optionally reference the tool from the prompt. In this example, we explicitly reference the `send_verification_code_tool` tool:

```agentscript title="Providing Additional Instructions to the LLM (optional)"
            | Ask the user for the verification code they received and
              verify it using {!@actions.send_verification_code_tool}.
```

#### Chain an Action

When you expose a defined action to the LLM in the reasoning actions block, you can specify another action to run immediately afterwards. In this example, the `ScheduleOrder` action is run immediately after the `GetOrderByNumber` action.

```agentscript title="Action Chaining"

   reasoning:
      instructions: ->
         | You are a helpful agent.

      actions:
            # get the order's details
            GetOrderByOrderNumber: @actions.GetOrderByOrderNumber
                with contactRecord = ...
                with orderNumber = ...
                set @variables.orderDetails = @outputs.orderDetails

                # automatically run the ScheduleOrder action after you get the order's details
                run @actions.ScheduleOrder
                    with orderDetails = @variables.orderDetails
                    set @variables.DeliveryDate = @outputs.deliveryDate

```

## Example - Defining and Using Actions and Tools

In this example, we define a single action, `send_verification_code_action`. We explicitly call the action from the logic section of the reasoning instructions. We also expose the action as a tool to the LLM (`send_verification_code_tool`), so that the LLM can choose to call the action if the customer didn't get the verification code the first time.

```agentscript title="Actions and Tools"
subagent my_topic:

    # Agentforce actions go in the subagent actions block
    actions:
        send_verification_code_action:
            description: "Send a verification code to the member and verify confirmation."
            inputs:
                email: string
                member_number: string
            outputs:
                verification_code: string
                member_name: string
            target: "flow://Get_Verification_Code"

    reasoning:

        # LLM tools (aka reasoning actions) go in the reasoning actions block
        # which can include pointers to Agentforce actions. These tools are sent to the LLM to be used
        # at the LLM's discretion.
        actions:
            send_verification_code_tool: @actions.send_verification_code_action
                with email=@variables.member_email
                with member_number=@variables.member_number
                set @variables.verification_code=@outputs.verification_code

        instructions: ->
            # We explicitly call a subagent action from
            # the logic section of the reasoning instructions
            # In this case, the customer is sent a verification code
            # each time the subagent is run, as the agent is parsing the subagent.
            if @variables.member_email != "":
                run @actions.send_verification_code_action
                    with email=@variables.member_email
                    with member_number = @variables.member_number
                    set @variables.verification_code=@outputs.verification_code
                    set @variables.member_name=@outputs.member_name

            # In this case, we call our tool (a reasoning action) from
            # the prompt section of the reasoning instructions.
            # Calling the tool from the prompt isn't required, because
            # the LLM can usually figure out which tool to use.
            | Ask the user for the verification code they received and
              verify it using {!@actions.send_verification_code_tool}.

```

So you can call actions (specified in subagent.actions) deterministically, and you can expose actions as tools (specified in subagent.reasoning.actions) that the LLM can choose to use based on the current context.

:::note
In the Actions and Tools example, the action is defined as `send_verification_code_action` and exposed as a tool called `send_verification_code_tool`. If you create actions in the UI and expose them as tools, the action and the tool have the same name.
:::

See [Using Actions](#using-actions), [Tools (Reasoning Actions)](ascript-ref-tools.md), and [Reasoning Instructions](ascript-ref-instructions.md).

## Action Properties

An action definition contains these properties.

| Property                      | Description                                                                                                                                                                                             |
| :---------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [action name](#action-name)   | Required string. The action's name.                                                                                                                                                                     |
| description                   | Optional string. Description of the action's behavior and purpose. Use `\|` for multiline descriptions. The LLM uses this description to help it decide when to call the action.                        |
| [inputs](#inputs)             | Optional object. Defines the action's input parameters, if any.                                                                                                                                         |
| include_in_progress_indicator | Optional boolean (`True`/`False`). Indicates whether the agent shows progress indicator when running the action.                                                                                        |
| [target](#target)             | Required string. Reference to an executable (apex, flow, or prompt).                                                                                                                                    |
| label                         | Optional string. The action's name to display to the customer. Auto-generated if not specified. By default, Agentforce creates the label from the action's name, where `my_action` becomes "My Action". |
| [outputs](#outputs)           | Optional object. Defines the action's output parameters, if any.                                                                                                                                        |
| require_user_confirmation     | Optional boolean. Indicates whether the customer must confirm before the agent runs the action.                                                                                                         |

### action name

The action's identifier, which you use to run the action. Action names must follow Salesforce developer name standards:

- Begin with a letter, not an underscore.
- Contain only alphanumeric characters and underscores.
- Can't end with underscore.
- Can't contain consecutive underscores (\_\_).
- Maximum length of 80 characters.
- `snake_case` is recommended.

### inputs

Defines the action's input parameters, their [type](#parameter-types), and whether the input is required. For example:

```agentscript title="Action Inputs"
inputs:
    email: string
        label: "Email Address"
        description: "Customer's email address"
        is_required: True
```

#### Parameter Types

You can use these types for input and output parameters:

- `string` - text values
- `number` - numeric values (floating point)
- `integer` - integer values
- `long` - long integer values
- `boolean` - True/False values
- `object` - complex objects
- `date` - date values (YYYY-MM-DD)
- `datetime` - dateTime values
- `time` - time values
- `currency` - currency values
- `id` - Salesforce ID values
- list[`<type>`] - a list of values of the same type. You can use any supported type in this list. For example, `list[string]` or `list[number]`.

### target

A reference to an executable. Use the format `{TARGET_TYPE}://{DEVELOPER_NAME}`. An action can have these targets:

- `apex` (Apex)
- `flow` (Flow)
- `prompt` (Prompt Template)

For example:

```agentscript title="Flow Target"
flow://AssignSalesRep
```

```agentscript title="Prompt Target"
prompt://check_bookings
```

### outputs

Defines the action's output parameters and the parameters' properties. By default, the agent remembers the action's output information for the entire session. The agent can make choices based on the information, and use the information to answer customer questions. For example, if a `get_product_care` action returns information about how to maintain a product, the agent remembers that information for the entire session, and can use the information to answer questions.

Output parameters can be of [these types](#parameter-types).

:::important
To hide output information from the agent, set the output parameter's `filter_from_agent` property to `True`.
:::

Supported properties for output parameters are:

| Property                 | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| :----------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description`            | Optional. String. Description of the output parameter. By default, Agentforce generates this property from the parameter name. For example, the parameter `error_code` becomes `Error Code`.                                                                                                                                                                                                                                                                                                                                           |
| `developer_name`         | Required. String. Value that can override the parameter's developer name.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `label`                  | Optional. String. Human-readable label for the output parameter's value. By default, Agentforce autogenerates the label from the output parameter's name. For example, `error_code` becomes `Error Code`.                                                                                                                                                                                                                                                                                                                              |
| `complex_data_type_name` | Required if the parameter is a complex data type. String. Indicates the type returned by the target. For example, suppose that an action has a flow target and an output parameter called `customer_info`. If the flow returns information of type `lightning__recordInfoType`, the action's `customer_info` parameter must have the type `object` and the property `complex_data_type_name: lightning__recordInfoType`. **Note:** These complex types can also be [custom Lightning types](https://developer.salesforce.com/docs/ai/agentforce/guide/lightning-types.html). |
| `filter_from_agent`      | Optional. Boolean. If `True`, the output is excluded from the agent's context. If `False`, the output is included in the agent's context. Default value is `False`.                                                                                                                                                                                                                                                                                                                                                                    |

For example:

```agentscript title="Action Outputs"
outputs:
    customer_found: boolean
        label: "Customer Found"
        filter_from_agent: True
```

## Using Actions

Once you've defined an action in the subagent's `reasoning.actions` block, you can call the action in a subagent's reasoning logic, or expose it as a tool to the LLM.

### Call an Action in the Reasoning Logic

To ensure that an action runs every time a subagent runs, use `run @actions.<action_name>` in the subagent's `reasoning` block. In this example, an action checks business hours. The action doesn't require input, and we store the action's output in variables. These variables can be accessed by other subagents, or by this subagent next time it runs.

```agentscript title="Run Actions in Logic Instruction"
reasoning:
    instructions: ->
        run @actions.check_business_hours
           set @variables.is_business_hours=@outputs.is_business_hours
           set @variables.next_open_time=@outputs.next_open_time
```

### Expose the Action as a Tool for the LLM

You can expose an action as a tool in the reasoning actions block, enabling the LLM to choose whether to run the tool. When you expose the tool to the LLM, you can choose whether to explicitly reference the tool from any prompts you specify in the reasoning block. See [Tools (Reasoning Actions)](ascript-ref-tools.md).

```agentscript title="Specify Tools in Reasoning Actions"
reasoning:
    actions:
        load_order_details: @actions.Get_Order_Details
            with order_number=@variables.order_number
            with customer_id=@variables.customer_id
```

Typically, an LLM recognizes when to use a tool. However, you can also use `{!@actions.<action_name>}` in the prompt to provide more context.

```agentscript title="Reference Actions in Prompt Instruction"
reasoning:
    instructions: ->
        | If not within business hours, create a support case by using {!@actions.create_case}.
           Share the Case Number and when to expect follow-up ({!@variables.next_open_time}).
```

## Related Topics

- [Flow of Control](../ascript-flow.md)
- [Reasoning Instructions](ascript-ref-instructions.md)
- [Tools (Reasoning Actions)](ascript-ref-tools.md)
