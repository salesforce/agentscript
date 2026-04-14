---
sidebar_label: "Agent Script Blocks"
---

# Agent Script Blocks

A script consists of blocks where each block contains a set of properties. These properties can describe data or procedures. Agent Script contains several different block types.

<img src="/img/agent-script/agent-script-blocks2.svg" alt="Agent Script Blocks" width="300" />

This section gives you a high-level understanding of each block type.

## System Block

The system block contains general instructions for the agent. This information includes a list of message prompts that the agent uses during specific scenarios. `welcome` and `error` are required messages:

- For multiline messages, use the pipe symbol ("|")
- To personalize messages or include other context information, use [linked variables](reference/ascript-ref-variables.md#linked-variables).

For example, to dynamically inject the user's preferred name into the welcome message, use `{!@variables.userPreferredName}`.

In this example, if the `userPreferredName` is `Sam`, customers see the welcome message "Hi Sam! I'm your personal shopping assistant".

```agentscript title="System Block"
system:
    instructions:|
        You are an AI agent. Have a friendly conversation with the user.

    messages:
        welcome:|
            Welcome  {!@variables.userPreferredName}! I'm your personal shopping assistant.

            I can help you:
            - Find products and check availability
            - Track your orders
            - Process returns and refunds
            - Answer questions about our policies

            How can I assist you today?
        error: "Whoops!"
```

## Config Block

The config block contains configuration parameters that define the agent.

| Parameter                    | Description                                                                                                                                                                                                                                                                     |
| :--------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `developer_name`             | The Salesforce API name of the agent (max 80 chars). Must start with a letter, contain only alphanumeric and underscores, and can't end with underscore or have consecutive underscores. Must be unique in your org - you can't have two agents with the same `developer_name`. |
| `default_agent_user`         | API name or ID of the default Salesforce user that is used to run this agent. Required for AgentforceServiceAgent, ignored for AgentforceEmployeeAgent.                                                                                                                         |
| `agent_label`                | Optional. The agent's label, displayed in the UI. Auto-generated from `developer_name` if not provided.                                                                                                                                                                         |
| `description`                | Description of the agent's goals and purpose.                                                                                                                                                                                                                                   |
| `company`                    | Optional. Information about your company.                                                                                                                                                                                                                                       |
| `role`                       | Optional. The agent's role. For example, "Help the customer select the perfect gift."                                                                                                                                                                                           |
| `agent_version`              | The agent's version. Set automatically when you create a new version of your agent.                                                                                                                                                                                             |
| `agent_type`                 | Optional. The type of agent. Currently, allowed values are `AgentforceServiceAgent` (default) or `AgentforceEmployeeAgent`. Set automatically when you create an agent from a template.                                                                                         |
| `enable_enhanced_event_logs` | Optional. Indicates whether to enable conversation logging for debugging and monitoring. Allowed values are `True` or `False`. Default: `False`.                                                                                                                                |
| `user_locale`                | Optional. User locale setting.                                                                                                                                                                                                                                                  |

### Example Config Block

```agentscript title="Config Block"
config:
    developer_name: "Demo_Agent_1"
    default_agent_user: "digitalagent.demo@salesforce.com"
    agent_label: "Demo Agent"
    description: "This is my demo agent"
```

## Variables Block

The variables block contains the list of global variables that the agent and script can use. See [Variables](reference/ascript-ref-variables.md).

```agentscript title="Variables Block"
variables:
    string_var: mutable string = "hello world"
    hotel_info: mutable string = "Dreamforce Hotel"
```

You reference variables throughout the script by using the syntax `@variables.<variable_name>`.

## Language Block

The language block defines which languages the agent supports.

```agentscript title="Language Block"
language:
    default_locale: "en_US"
    additional_locales: ""
    all_additional_locales: False
```

## Connection Block

You can use the connection block to describe how this agent interacts with outside connections. For instance, this code snippet shows how the agent interacts with [Enhanced Chat](https://help.salesforce.com/s/articleView?id=service.miaw_intro_landing.htm).

```agentscript title="Connection Block"
connection messaging:
    escalation_message: "One moment while I connect you to the next available service representative."
    outbound_route_type: "OmniChannelFlow"
    outbound_route_name: "agent_support_flow"
    adaptive_response_allowed: True
```

You can use the connection block alongside the [@utils.escalate](reference/ascript-ref-utils.md#utilsescalate) command.

## Subagent Blocks

Use the subagent block to specify the instructions, logic, and actions for a subagent. A subagent block contains a description, a list of actions, and the reasoning instructions.

```agentscript title="Subagent Block"
subagent Order_Management:
    description: "Handles order lookup, order updates, and summaries including status, date, location, items, and driver."

    reasoning:
        instructions: ->
            if @variables.order_summary == "":
                run @actions.lookup_current_order
                with member_email=@variables.member_email
                set @variables.order_summary=@outputs.order_summary

            | Refer to the user by name {!@variables.member_name}.
              Show their current order summary: {!@variables.order_summary} when conversation starts or if requested.
              If they want past order info, ask for Order ID and use {!@actions.lookup_order}.

        actions:
            lookup_order: @actions.lookup_order
                with query = ...
                set @variables.order_summary=@outputs.order_summary
                set @variables.order_id=@outputs.order_id

            lookup_current_order: @actions.lookup_current_order
                with member_email=@variables.member_email
                set @variables.order_summary=@outputs.order_summary
                set @variables.order_id=@outputs.order_id

    actions:
        lookup_order:
            description: "Retrieve order details."
            inputs:
                query: string
            outputs:
                order_summary: string
                order_id: string
            target: "flow://SvcCopilotTmpl__GetOrdersByContact"


        lookup_current_order:
            description: "Retrieve current order details."
            inputs:
                member_email: string
            outputs:
                order_summary: string
                order_id: string
            target: "flow://SvcCopilotTmpl__GetOrderByOrderNumber"
```

These properties make up a subagent block:

- **subagent name**: This value is the name of the subagent that should accurately describe the scope and purpose of this subagent in a few words. Because this value can’t have spaces, use `snake_case` to name the subagent.
- **description**: This property contains the description for this subagent. This value should help the agent determine when to use this subagent based on the user’s intent.
- **system.instructions** (optional): Override system-level system instructions for this subagent only. By overriding system-level instructions, you can avoid giving conflicting intructions to the LLM, which can cause unexpected agent behavior. You can also change the agent's voice & tone for a specific subagent. See [Avoid Conflicting Instructions with Instruction Overrides](./patterns/ascript-patterns-system-overrides.md).
- **reasoning**: This section contains information sent to the reasoning engine. Its primary properties are instructions and actions.
  - **reasoning.instructions**: This property contains guidance for the reasoning engine after it has decided that this subagent is relevant to the user's request. The reasoning instructions can be a combination of logic instructions and prompt-based instructions. See [Reasoning Instructions](reference/ascript-ref-instructions.md).
  - **reasoning.actions**: The list of tools that are applicable for the reasoning engine to use. This list can point to agent actions listed in the higher-level actions section, as well as other functionality available to the reasoning engine (such as transitioning to another subagent, or setting a variable's value). See [Tools (Reasoning Actions)](reference/ascript-ref-tools.md).
- **actions**: This section defines the agent actions available from this subagent. It contains a description of the action, the list of inputs and outputs, and the target location where this action resides. If you want to allow the reasoning engine to use one of these agent actions, you must also point to this action from the `reasoning.actions` section. See [Actions](reference/ascript-ref-actions.md).

## Start Agent Block

The start agent block (called the "Agent Router" in Canvas view) is a subagent that uses the `start_agent` prefix instead of the `subagent` prefix. With every customer utterance, the agent begins execution at this block. The `start_agent` subagent is used to initiate the conversation, and typically determines when to switch to the agent's other subagents. This block handles subagent classification, filtering, and routing.

```agentscript title="Start Agent Block"
start_agent agent_router:
    description: "Welcome the user and determine the appropriate subagent based on user input"
    reasoning:
        instructions: |
            You are an agent router for this assistant. Welcome the guest
            and analyze their input to determine the most appropriate subagent
            to handle their request.
        actions:
            go_to_identity: @utils.transition to @subagent.Identity_Verification
                description: "Verifies user identity"
                available when @variables.verified == False
            go_to_order: @utils.transition to @subagent.Order_Management
                description: "Handles order lookup, refunds, and order updates."
                available when @variables.verified == True
            go_to_faq: @utils.transition to @subagent.General_FAQ
                description: "Handles various frequently asked questions."
                available when @variables.verified == True
            go_to_escalation: @utils.transition to @subagent.Escalation
                description: "Handles escalation to a human rep."
                available when @variables.verified == True and @variables.is_business_hours == True
```

For more guidance on how to use the start agent block for subagent routing and filtering, see [Subagent Classification and Routing](https://help.salesforce.com/s/articleView?id=ai.agent_topics_routing.htm) in Salesforce Help.

## Model Config Block (Optional)

Use `model_config` to customize the model that the subagent uses.

:::note
If you don't specify a model, the subagent uses the default model selected in Setup.
:::

```agentscript title="model_config"
   model_config:
      model: "model://sfdc_ai__DefaultEinsteinHyperClassifier"

```

### EinsteinHyperClassifier model

The EinsteinHyperClassifier model, developed by Salesforce, is often used for subagent classification in the `agent_router` subagent. The advantages of using EinsteinHyperClassifier for subagent classification are:

- Significantly faster subagent classification compared to other LLMs.
- Increased classification accuracy, particularly for specialized classification constraints and negative instructions.

Limitations of using the EinsteinHyperClassifier model:

- **Can't** support images in subagent classification. If your agent router needs to select the appropriate subagent based on a provided image, use a model other than EinsteinHyperClassifier.
- **Can't** use `before_reasoning` or `after_reasoning`.
- **Can only** use `@utils.transition` utils. **Can't** use `@utils.setVariables` or other [utils](reference/ascript-ref-utils.md).

### `model_config` Example

In this example, the agent router uses the EinsteinHyperClassifier model.

```agentscript title="Agent Router Subagent With EinsteinHyperClassifier Model "
start_agent agent_router:
    description: "Welcome the user and determine the appropriate subagent based on user input"
    # override the default model
    model_config:
       "model://sfdc_ai__DefaultEinsteinHyperClassifier"

    reasoning:
        instructions: ->
            | You are a subagent selector for a Customer Service Bot assistant.
               Welcome the guest and analyze their input to determine the most
               appropriate subagent to handle their request.

               NEVER escalate to a human unless explicitly requested.
               A bad experience shouldn't automatically escalate.
        actions:
            go_to_identity: @utils.transition to @subagent.Identity
                description: "verifies user identity"
                available when @variables.verified == False
            go_to_order: @utils.transition to @subagent.Order_Management
                description: "Handles order lookup, refunds, order updates, and summarizes status, order date, current location, delivery address, items, and driver name."
                available when @variables.verified == True

```

## Related Topics

- [Agent Script Patterns](./patterns/ascript-patterns.md)
- [Agent Script Reference](reference/ascript-reference.md)
