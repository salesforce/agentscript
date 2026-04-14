---
sidebar_label: "Customer Support"
---

# Customer Support Example

This agent helps customers get information about their order. It contains three subagents:

- The `agent_router` subagent, which provides general instructions to the LLM and exposes two tools that the LLM can choose to call. The two tools are utilities that transition to the required subagents, based on user input.
- The `Identity` subagent, which verifies the user's identity. This subagent allows the LLM to request the user's email (if it doesn't exist), then sends a verification code to the provided email. Then, the LLM can validate the verification code that the customer provides. This subagent contains deterministic tools and actions, while allowing the LLM freedom to use natural language to interact with the user.
- The `order_management` subagent, which allows the user to look up order details.

:::tip

- Each agent needs a unique `developer_name`. If you make multiple agents from one example script, change the developer name each time.
- If you encounter an unexpected error in Agentforce Builder with the last line of your script, add a blank line or a comment to the end.

:::

```agentscript title="Example - Customer Support Agent"
system:
    instructions: "You are a helpful, professional assistant that provides customers with information about their orders."
    messages:
        welcome: "Hi there, I'm your Pronto Customer Support Assistant."
        error: "Sorry, something went wrong on my end. Could you say that again in a different way?"

config:
    developer_name: "pronto_customer_support_assistant"
    default_agent_user: "agentforce@salesforce.com"
    description: "Assists customers with their orders while following defined support policies."

variables:
    # Identity
    member_name: mutable string
        description: "This is the name of the member."
    member_email: mutable string = ""
        description: "This is the email address of the member."
    member_number: mutable string
        description: "This is the member number for identification."
    verification_code: mutable string
        description: "This is the verification code to validate against the user's."
    user_verification_code: mutable string
        description: "This is the verification code entered by the user."
    verified: mutable boolean = False
        description: "Shows whether or not the user's identity has been verified."
    first_name: mutable string
        description: "this is the first name"
    days_since_order: mutable number
        description: "this is the days since the order was placed"

    # Orders
    order_id: mutable string
        description: "This is the Order ID of the order they placed."
    order_summary: mutable string = ""
        description: "This is the summary of the order."
    order_canceled: mutable boolean
        description: "This indicates if the order has been canceled."


language:
    default_locale: "en_US"
    additional_locales: ""
    all_additional_locales: False

# The entry point for the agent, on every customer utterance.
start_agent agent_router:
    description: "Welcome the user and determine the appropriate subagent based on user input"
    reasoning:
        instructions: ->
            | You are an agent router for a Customer Service Bot assistant.
              Welcome the guest and analyze their input to determine the most appropriate subagent to handle their request.
              NEVER escalate to a human unless explicitly requested. A bad experience shouldn't automatically escalate.
        # This section lists the tools that the LLM
        # can choose to use. In this example, the LLM has two tools:
        # transitioning to the Identity subagent or transitioning to the
        # Order_Management subagent
        actions:
            # Transitions deterministically route execution to the specified subagent.
            # Once the LLM chooses to use this tool, the execution is guaranteed
            # to transition.
            go_to_identity: @utils.transition to @subagent.Identity
                description: "verifies user identity"
                available when @variables.verified == False
            go_to_order: @utils.transition to @subagent.Order_Management
                description: "Handles order lookup, refunds, order updates, and summarizes status, order date, current location, delivery address, items, and driver name."
                available when @variables.verified == True

subagent Identity:
    description: "Handles verification of the user's identity before providing access to all other subagents."
    reasoning:
        instructions: ->
            if @variables.member_email != "":
                run @actions.send_verification_code
                    with email=@variables.member_email
                    with member_number = @variables.member_number
                    set @variables.verification_code=@outputs.verification_code
                    set @variables.member_name=@outputs.member_name

            | Greet the user and inform them that to help them get started you've sent them a verification code via email.
              # This prompt contains two actions that the LLM can choose to run -
              # a tool to send the verification code, and a tool to validate the
              # verification code. Once the LLM chooses to run these actions,
              # the actions are run deterministically
              Ask the user for the verification code they received and verify it using {!@actions.validate_verification_code}.
              If the user says they did not receive the code, ask them to confirm their email and resend the verification code using {!@actions.send_verification_code}

        # The reasoning.actions section declares the tools that the LLM can choose
        # to run. This section has three tools - two actions and
        # one transition.
        actions:
            send_verification_code: @actions.send_verification_code
                with email=@variables.member_email
                with member_number=@variables.member_number
                set @variables.verification_code=@outputs.verification_code

            validate_verification_code: @actions.validate_verification_code
                available when @variables.verification_code != None
                with user_verification_code=@variables.user_verification_code
                set @variables.verified=@outputs.verification

            go_to_order_management: @utils.transition to @subagent.Order_Management
                available when @variables.verified == True


    # This section defines the actions available to this subagent. Actions are
    # only valid within the subagent in which they are defined.
    actions:
        send_verification_code:
            description: "Send a verification code to the member and verify confirmation."
            inputs:
                email: string
                member_number: string
            outputs:
                verification_code: string
                member_name: string
            target: "flow://Get_Verification_Code"


        validate_verification_code:
            description: "validate the verification code"
            inputs:
                verification_code: string
            outputs:
                verification: boolean
                    description: "always validate and return True"
            target: "flow://validate_Verification_Code"


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
            # The ... indicates that the LLM can use reasoning to select the
            # information from the customer's conversation, then input
            # the information into the correct input variables
            lookup_order: @actions.lookup_order
                with query = ...
                # Store the action's output into variables
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
# End of customer support script
```

## Agent Script Recipes

For more Agent Script examples, see [Agent Script Recipes](https://developer.salesforce.com/sample-apps/agent-script-recipes).

[![Agent Script Recipes](/img/agent-script/agent-script-recipes.png)](https://developer.salesforce.com/sample-apps/agent-script-recipes)
