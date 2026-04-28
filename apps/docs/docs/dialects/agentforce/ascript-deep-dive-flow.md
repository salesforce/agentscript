---
sidebar_label: "Deep Dive: Flow Control"
---

# AgentScript & Flow Control - A Deep Dive into Reasoning Block Behavior

AgentScript provides powerful control mechanisms that distinguish between **LLM-powered reasoning** and **deterministic execution**. This hybrid approach allows developers to precisely control when agents use AI reasoning versus following predefined logic paths.

---

## Definition & Execution Ground Rules

- **Parse** = one full pass over the subagent's reasoning instructions, where Agentforce evaluates and runs all the deterministic logic before sending anything to LLM
  - System walks the instructions top to bottom
  - Executes deterministic steps such as:
    - `set @variables.counterVerify = @variables.counterVerify + 1`
    - `run @actions.nkg`
    - `if / else` branches
  - **Important Note**: Pipe `|` has a special significance; anything that comes after it, however critical (`ALWAYS`, `MUST`, `CRITICAL`, etc) it may sound to mortal human is left at the mercy of the Language Model to approve or reject for execution.
    - The Language Model's reasoning planner acts as a gatekeeper, evaluating each instruction based on its own interpretation of context and relevance, regardless of the urgency conveyed by the human-defined keywords.
    - **For instance**, even if an instruction states `"ALWAYS run the counterIncr action to update the subCounter"`, the LLM may choose to skip this action if it determines other priorities take precedence or if the action doesn't align with its current reasoning path.
- Each time the subagent's reasoning instructions are processed counts as **one parse.**
  - When the subagent is first entered
    - eg: via a transition
  - Each time a new reasoning loop iteration starts for that subagent
    - eg: after a tool call or the next use message within the same subagent (multi-turn)

---

## AgentScript Primitives Quick Reference

| Primitive | What it is | Deterministic? | Example |
|---|---|---|---|
| `instructions: ->` | Arrow syntax enabling inline expressions, conditionals, and `run` directives | The block itself is resolved deterministically; lines prefixed with `\|` become LLM prompt text. | `instructions: ->` |
| `\| (pipe prefix)` | Marks a line as LLM-facing text; the reasoning planner decides whether/how to act on it | No. LLM Discretion | `\| Check if the customer provided...` |
| `set @variables.X = ...` | Assigns a value to a mutable variable during the deterministic resolution pass | Yes | `set @variables.counterVerify = @...` |
| `run @actions.X` | Executes a subagent-level action (one with a `target:`) immediately during resolution, before the LLM sees anything | Yes | `run @actions.get_churn_score` |
| `transition to @subagent.X` | Unconditional deterministic subagent switch (exits the current subagent immediately). Transitions are **one-way**. There's no return of control to the calling subagent. `transition to` executes immediately when encountered. The execution of the current directive block is halted, and control is passed to the new subagent. | Yes | `transition to @subagent.agent_router` |
| `@utils.transition to @subagent.X` | A utility action that performs a deterministic subagent change. When placed in `reasoning.actions:`, the LLM *chooses* to invoke it; when placed in a `transition to` directive, it fires unconditionally. | Depends on placement | `go_to_verify: @utils.transition to @subagent.ServiceCustomerVerification` |
| `available when` | A guard clause evaluated deterministically; if the condition is `false`, the action is hidden from the LLM entirely | Yes (gate is deterministic) | `available when @variables.isVerified==True` |
| `{!@variables.X}` | Template injection; inserts the current variable value into LLM-facing text | Yes (resolved before LLM) | `\| Score: {!@variables.churn_score}` |
| `if / else` | Conditional branching resolved during the deterministic pass; the LLM never sees the branching logic, only the winning path's output | Yes | `if @variables.isVerified:` |
| `with param = ...` | Passes an input to an action; `...` (ellipsis) means "let the LLM extract this from conversation" | Binding is deterministic; `...` is LLM resolved | `with customerToVerify = ...` |

---

## Flow of Control

> **Diagram: Two-Phase Flow of Control**

![Two-Phase Flow of Control](/img/agent-script/deep-dive/diagram_two_phase_flow.png)

The flow:

1. User Message arrives at START_AGENT (Agent Router)
2. Subagent Classification based on context; LLM selects transition tool (e.g., `go_to_ServiceCustomerVerification`)
3. `@utils.transitions to @subagent.ServiceCustomerVerification`
4. Inside the subagent, two phases run:
   - **PHASE 1: PARSE / PROCESS (deterministic)**
     - Agentforce parses instructions line-by-line, top to bottom
     - Executes: `set`, `run`, `if/else`
     - Builds prompt from `|` instructions
     - If transition encountered: STOP, go to new_subagent
   - **PHASE 2: LLM REASONING**
     - Prompt sent to LLM
     - LLM may call tools (actions, `@utils`)
     - Tool results feedback into context
     - More tool calls needed? **Yes**: Next Iteration (Re-parse from top, Back to PHASE 1)
     - More tool calls needed? **No**: LLM Responds to User
5. Transition (from action block or reasoning instructions) to New Subagent (or Agent Router)

---

## Deterministic vs. LLM Reasoning in AgentScript

> **Diagram: Sequence Diagram**

![Sequence Diagram](/img/agent-script/deep-dive/diagram_sequence.png)

Sequence summary:

1. User sends message to START_AGENT
2. Subagent Classification based on context
3. LLM Selects transition tool (`go_to_ServiceCustomerVerification`)
4. `@utils.transitions to @subagent.ServiceCustomerVerification` [loop: Next Iteration]
5. **PHASE 1: PARSE / PROCESS (Deterministic)**
   - Parses instructions line-by-line, top to bottom
   - Executes: `set`, `run`, `if/else`
   - Builds prompt from `|` instructions
   - [Transition encountered]: STOP, go to new_topic
6. [Proceed to Reasoning]
7. **PHASE 2: LLM REASONING (Non-Deterministic)**
   - Prompt sent to LLM
   - opt [Tool calling]: LLM may call tools (actions, `@utils`); Tool results feedback into context
   - alt [More tool calls needed? (Yes)]: Back to PHASE 1 (Re-parse from top)
   - [Done (No)]: LLM Responds to User
   - opt [Transition Triggered]: Transition to New Subagent (or Agent Router)

---

## Here is an example conversation of User & Agent

To maintain conciseness, the subagent selector and a single subagent are included for demonstration purposes.

### Utterances

| Turn# | Assistant | User |
|---|---|---|
| 1 | Hi, I'm an AI service assistant. How can I help you? | provide the tracking status of my last order |
| 2 | To provide the tracking status of your last order, I need to verify your identity. Please provide your username or email address associated with your account. | nikhilgupta@salesforce.com.devpro |
| 3 | To provide the tracking status of your last order, I need to verify your identity. Please provide your username or email address associated with your account. | `<<generated verification code>>` |

---

### subagent Selector

```
start_agent agent_router:
    label: "Agent Router"

    description: "Welcome the user and determine the appropriate subagent based on user input"

    reasoning:
        instructions: ->
            | Select the best tool to call based on conversation history and user's intent.

    actions:
        go_to_ServiceCustomerVerification: @utils.transition to @subagent.ServiceCustomerVerification
            available when @variables.isVerified==False

        go_to_CaseManagement: @utils.transition to @subagent.CaseManagement
            available when @variables.isVerified==True

        go_to_OrderInquiries: @utils.transition to @subagent.OrderInquiries
            available when @variables.isVerified==True

        go_to_GeneralFAQ: @utils.transition to @subagent.GeneralFAQ

        go_to_escalation: @utils.transition to @subagent.escalation

        go_to_off_topic: @utils.transition to @subagent.off_topic

        go_to_ambiguous_question: @utils.transition to @subagent.ambiguous_question

        go_to_Product_Info_and_Features: @utils.transition to @subagent.Product_Info_and_Features
```

> **How `@utils.transition` works here:**
>
> Each `go_to_*` action is a routing offered to the LLM. The LLM reads the pipe prefixed instruction ("Select the best tool to call based on conversation history and user's intent") and evaluates which `goto` action best matches.
>
> The `available when` guards are evaluated deterministically before the LLM sees the action list; so `go_to_CaseManagement` is invisible when `isVerified==False`.
>
> Once the LLM picks an action (e.g., `go_to_ServiceCustomerVerification`), `@utils.transition` fires and the agent deterministically enters the `ServiceCustomerVerification` subagent.
>
> **The LLM chose which transition, but the transition itself is a code, not a suggestion.**

---

### Subagent: ServiceCustomerVerification

```
subagent ServiceCustomerVerification:
    label: "Service Customer Verification"

    description: "Verifies the customer's identity before granting access to sensitive data.
    Verification is required for inquiries related to orders and order status, deliveries,
    reservations, password resets, account management (e.g. contact information updates),
    or cases. Sensitive data includes confidential, private, or security-protected
    information, such as business-critical data or personally identifiable information (PII)."

    reasoning:
        instructions: ->
            set @variables.counterVerify = @variables.counterVerify + 1.   # <-- DETERMINISTIC: runs every parse
            | Check if the customer has provided their username or email address. If not
              please request the customer to provide and pass the value to the
              "customerToVerify".                                            # <-- LLM Facing: planner decides
            | When the user provides their username or email address, Run the action
              {!@actions.SendEmailVerificationCode} to send the verification code to their
              provided email address and then show the message "If you have provided a valid
              email or username, you should receive a verification code to verify your
              identity. Please enter the code."                             # <-- LLM Facing: planner decides
            | If the customer enters the verification code, run the
              {!@actions.VerifyCustomer}.                                   # <-- LLM Facing: planner decides
            | If verification is successful, proceed with the requested action and complete
              the task the user intends to perform.                         # <-- LLM Facing: planner decides
            | Never reveal the verification code, email address, or username to the customer
              during the authentication process. Make sure that these details remain
              confidential and aren't displayed at any point.               # <-- LLM Facing: planner decides
            | Always Run the action {!@actions.counterIncr} to update update subCounter.
                                                                            # <-- LLM Facing: NOT Enforced
```

#### Action Available For Reasoning

```
    actions:
        SendEmailVerificationCode: @actions.SendEmailVerificationCode
            with customerToVerify = ...
            set @variables.authenticationKey = @outputs.authenticationKey
            set @variables.customerId = @outputs.customerId
            set @variables.customerType = @outputs.customerType

        counterIncr: @utils.setVariables
            with counterVerify = @variables.counterVerify + 1
            with subCounter=@variables.subCounter+1

        VerifyCustomer: @actions.VerifyCustomer
            with authenticationKey = @variables.authenticationKey
            with customerCode = ...
            with customerId = @variables.customerId
            with customerType = @variables.customerType
            set @variables.isVerified = @outputs.isVerified
            set @variables.VerifiedCustomerId = @outputs.customerId
            if @variables.isVerified:   # <-- Post action deterministic check fires
                transition to @subagent.agent_router
```

#### Action Available to Subagent

```
actions:
    SendEmailVerificationCode:
        description: "Sends a generated verification code to the user's email address."
        inputs:
            customerToVerify: string
                description: "Stores the email address or username provided by the customer.
                              This input initiates the verification process."
                label: "Customer To Verify"
                is_required: True
                is_user_input: True
        outputs:
            verificationMessage: string
                description: "Stores a generic message that will be displayed to the user."
                label: "Verification Message"
                filter_from_agent: False
                is_displayable: True
            verificationCode: string
                description: "Stores the generated verification code."
                label: "Verification Code"
                filter_from_agent: True
                is_displayable: False
            authenticationKey: string
                description: "Stores the authentication key that's used to generate the
                              verification code."
                label: "Authentication Key"
                filter_from_agent: True
                is_displayable: False
            customerId: string
                description: "Stores the Salesforce user ID or contact ID."
                label: "Customer ID"
                filter_from_agent: True
                is_displayable: False
            customerType: string
                description: "Stores the customer ID type, whether it's a Salesforce user
                              or a contact."
                label: "Customer Type"
                filter_from_agent: True
                is_displayable: False
        target: "flow://SvcCopilotTmpl__SendVerificationCode"
        label: "Send Email with Verification Code"
        require_user_confirmation: False
        include_in_progress_indicator: True
        source: "SvcCopilotTmpl__SendEmailVerificationCode"

    VerifyCustomer:
        description: "Verifies whether the verification code entered by the user matches the code sent to the user's email address."
        inputs:
            authenticationKey: string
                description: "Stores the authentication key that's used to generate the verification code."
                label: "Authentication Key"
                is_required: True
                is_user_input: False
            customerCode: string
                description: "Stores the verification code entered by the user in the conversation, which they received by email."
                label: "Customer Code"
                is_required: True
                is_user_input: True
            customerId: string
                description: "Stores the Salesforce user ID or contact ID."
                label: "Customer ID"
                is_required: True
                is_user_input: False
            customerType: string
                description: "Stores the customer ID type, whether it's a Salesforce user or a contact."
                label: "Customer Type"
                is_required: True
                is_user_input: False
        outputs:
            isVerified: boolean
                description: "Stores a boolean value that indicates whether the customer code is verified."
                label: "Verified"
                filter_from_agent: True
                is_displayable: False
            customerId: string
                description: "Stores the Salesforce user ID or contact ID."
                label: "Customer Id"
                filter_from_agent: True
                is_displayable: False
            customerType: string
                description: "Stores Type of ID"
                label: "Customer Type"
                filter_from_agent: True
                is_displayable: False
            messageAfterVerification: string
                description: "Stores a generic message to be displayed after successful verification."
                label: "Message After Verification"
                filter_from_agent: True
                is_displayable: True
        target: "flow://SvcCopilotTmpl__VerifyCode"
        label: "Verify Customer"
        require_user_confirmation: False
        include_in_progress_indicator: True
        source: "SvcCopilotTmpl__VerifyCustomer"
```

---

## Step-By-Step Turn Walkthrough for the Example Conversation \{Read this side by side with [code](/img/agent-script/deep-dive/agentscript.agent)\}

### Turn#1: User Says "provide the tracking status of my last order"

1. Parse starts in `agent_router` (this is `start_agent`)
2. Deterministic resolution: No `set` or `run` lines - so nothing to execute deterministically.
3. LLM sees: "Select the best tool to call based on conversation history and user's intent." plus the list of available `go_to_*` actions.
4. Guard Evaluation: `@variables.isVerified` is `False`, so `go_to_CaseManagement` and `go_to_OrderInquiries` are hidden. `go_to_ServiceCustomerVerification` is visible.
5. LLM decides: The user want order tracking, which requires verification. LLM invokes `go_to_ServiceCustomerVerification`
6. `@utils.transition` fires: Agent enters `ServiceCustomerVerification`
7. New parse in `ServiceCustomerVerification`
   - a. `set @variables.counterVerify = @variables.counterVerify + 1` executes deterministically (counterVerify goes from 0 to 1)
   - b. LLM sees the pipe-prefixed instructions: "Check if the customer has provided their username...", "when the user provides their username, Run `SendEmailVerificationCode`...", etc.
   - c. LLM determines the user hasn't provided a username yet, therefore responds asking for it.

### Turn#2: User provide "nikhilgupta@salesforce.com.devpro"

1. Same subagent, new reasoning loop; `set @variables.counterVerify = @variables.counterVerify + 1` runs again.
2. LLM sees the pipe instructions again, now with the user's email in the conversation context.
3. LLM invokes `SendEmailVerificationCode` with `customerToVerify = "nikhilgupta@salesforce.com.devpro"`.
4. Outputs are captured: `authenticationKey`, `customerId`, `customerType` stored via `set` directives.
5. Post-action loop: subagent re-resolves. `counterVerify` increments again. LLM now sees that verification code was sent, asks user to provide it.

### Turn#3: User enters the verification code

1. New parse `counterVerify` increments
2. LLM invokes VerifyCustomer with the stored `authenticationKey`, `customerId`, `customerType`, and the user-provided code (`customerCode = ...`)
3. Output: `isVerified = True`, `VerifiedCustomerId` stored
4. Post action deterministic check fires:

```
if @variables.isVerified:
    transition to @subagent.agent_router
```

> **This is deterministic**; the LLM doesn't decide this. The agent transitions back to `agent_router`

5. Back in `agent_router`, `isVerified` is now `True`, so `go_to_OrderInquiries` is visible. LLM routes to order tracking

---

## What the LLM Actually Sees

### Turn#1 - 2 Parses, 2 subagents

#### Parse#1 agent_router (entry point)

Compiled prompt reaching the LLM (Turn1, agent_router):

```
Select the best tool to call based on conversation history and user's intent

# Tools visible to LLM

- go_to_ServiceCustomerVerification (available since isVerified == False)
- go_to_GeneralFAQ (no guard; always visible)
- go_to_escalation (no guard; always visible)
- go_to_off_topic (no guard; always visible)
- got_to_ambiguous_question (no guard; always visible)
- go_to_Product_Info_and_Features (no guard; always visible)

# Tools hidden from LLM

- go_to_CaseManagement (guard: isVerified == True; currently False)
- go_to_OrderInquiries (guard: isVerified == True; currently False)
```

**User Utterance in context:** "provide the tracking status of my last order"

**LLM Decision**

> Order tracking requires verification. The only verification-related tool visible is `go_to_ServiceCustomerVerification`.
> LLM invokes it. `@utils.transition` fires; agent deterministically enters `ServiceCustomerVerification`.

---

#### Parse#2 ServiceCustomerVerification (after transition)

**Deterministic resolution (before LLM)**

- `set @variables.counterVerify = 0 + 1`   counterVerify = 1
- No `if` conditions to evaluate, no `run` directives.
- `{!@actions.SendEmailVerificationCode}` and `{!@actions.VerifyCustomer}` and `{!@actions.counterIncr}` - template references resolves to their action names

**Compiled prompt reaching the LLM**

```
Check if the customer has provided their username or email address.
If not please request the customer to provide and pass the value to the [action]...

When the user provides their username or email address,
Run the action SendEmailVerificationCode to send the verification code...

If the customer enters the verification code, run the VerifyCustomer.

If verification is successful, proceed with the requested action
and complete the task the user intends to perform.

Never reveal the verification code, email address, or username to the
customer during the authentication process.

Always Run the action counterIncr to update update subCounter
```

**Tools visible to LLM**

| Tool | Input Binding | Visibility? |
|---|---|---|
| SendEmailVerificationCode | `customerToVerify = ...` (LLM extracts from conversation) | no guard; always visible |
| VerifyCustomer | `authenticationKey = @variables.authenticationKey` (empty), `customerCode = ...` (LLM extracts), `customerId` (empty), `customerType` (empty) | no guard; always visible |
| counterIncr | `@utils.setVariables` with `counterVerify` and `subCounter` | no guard; always visible |

**LLM Decision**

> User hasn't provided a username or email yet. LLM does *not* invoke `SendEmailVerificationCode` or `VerifyCustomer`.
> LLM *does* invoke `counterIncr` (responding to the "Always Run" instruction). LLM responds asking the user for their username or email.
>
> State after this parse: `counterVerify = 2`, `subCounter = 1`

---

### Turn#2 - 2 Parses, Same subagent

**User Message:** `"nikhilgupta@salesforce.com.devpro"`

**Parse 1: `ServiceCustomerVerification`** (new user message triggers re-resolves)

**Deterministic resolution (before LLM)**

- `set @variables.counterVerify = 2 + 1`; counterVerify = 3

**Compiled prompt reaching the LLM**

Same resolved instruction text as Turn 1 Parse 2 (the pipe-prefixed lines don't change between turns; they're static text)

**Conversation History now includes:**

```
Assistant: "please provide your username or email address..."
User: "nikhilgupta@saelsforce.com.devpro"
```

**Tools visible to LLM**

Same three: `SendEmailVerificationCode`, `VerifyCustomer`, `counterIncr`.

**LLM Decision**

> User has now provided an email address. LLM invokes `SendEmailVerificationCode` with `customerToVerify =`
> `"nikhilgupta@salesforce.com.devpro"` (extracted from conversation via `...` ellipsis binding). LLM does *not* invoke
> `counterIncr` this time; despite "Always Run", the planner prioritizes the verification flow.

**Action outputs captured (deterministic `set` directives)**

- `@variables.authenticationKey = @outputs.authenticationKey`   populated
- `@variables.customerId = @outputs.customerId`   populated
- `@variables.customerType = @outputs.customerType`   populated

---

**Parse 2: ServiceCustomerVerification (post-action loop)**

**Deterministic Resolution (before LLM)**

- `set @variables.counterVerify = 3 + 1`; counterVerify = 4

**Compiled prompt reaching the LLM**

- same instruction text

**Key differences in the Context**

The action `SendEmailVerificationCode` just completed. Its output `verificationMessage` (with `is_displayable: True`) is in the conversation. The LLM knows a code was sent. (ReAct loop persist state)

**Tools visible to LLM**

| Tool | Input Binding | Visibility? |
|---|---|---|
| SendEmailVerificationCode | `customerToVerify = ...` | Still visible; could resend; but won't. Recall state persistence in ReAct loop. |
| VerifyCustomer | `authenticationKey = now populated with value`; `customerCode = ...`; `customerId = now populated`; `customerType = now populated` | Input are pre-filled from prior action outputs; only `customerCode` awaits LLM extraction. |
| counterIncr | same as before: `@utils.setVariables` with `counterVerify` and `subCounter` | Still visible |

**LLM Decision**

> Code was just sent. User hasn't provided the verification code yet. LLM responds telling the user to check their email,
> and enter the code. Does not invoke any action.
>
> State after Turn 2:
> `counterVerify = 4`, `subCounter = 1` (counterIncr was never called in Turn 2)

---

### Turn#3 - 3 Parses (2 explicit + 1 implicit), subagent Transition at the End.

**User Message:** `"<<generated verification code>>"`

**Parse 1: ServiceCustomerVerification (new user message triggers re-resolve)**

**Deterministic resolution (before LLM)**

- `set @variables.counterVerify = 4 + 1`; counterVerify = 5

**Compiled prompt reaching the LLM**

Same instruction text.

**Conversation history now includes:**

```
Assistant: "Please enter the verification code sent to your email..."
User: "<<generated verification code>>"
```

**Tools visible to LLM**

| Tool | Input Binding | Visibility? |
|---|---|---|
| SendEmailVerificationCode | `customerToVerify = ...` | Visible but not relevant |
| VerifyCustomer | `authenticationKey = now populated with value`; `customerCode = ...` (LLM will extract the code from the user message); `customerId = now populated`; `customerType = now populated` | All inputs are ready :) |
| counterIncr | same as before: `@utils.setVariables` with `counterVerify` and `subCounter` | Visible |

**LLM Decision**

> User provided the verification code. LLM invokes `VerifyCustomer` with `customerCode` extracted from the user's message. The 3 bounded input parameters (`authenticationKey`, `customerId`, `customerType`) pass through automatically via `with param = @variables.X`

**Action outputs captured (deterministic `set` directives)**

- `@avriables.isVerified = @outputs.isVerified`; now True
- `@variables.VerifiedCustomerId = @outputs.customerId`; now populated

---

**Parse 2: ServiceCustomerVerification (post-action loop)**

**Deterministic resolution (before LLM)**

- `set @variables.counterVerify = 5 + 1`; counterVerify = 6
- Post action conditional evaluates:

```
if @variables.isVerified:    # <-- True
    transition to @subagent.agent_router    # <-- FIRES IMMEDIATELY
```

- `transition to` is deterministic; it short-circuits the entire parse. The LLM never sees any instructions. No reasoning happens.
  - no credits consumed for this parse

---

**Parse 3 (Implicit): Back to home in agent_router**

**Deterministic resolution (before LLM)**

- `available when` guard re-evaluate with updated state:
  - `@variables.isVerified == False`   now False
  - `@variables.isVerified == True`   now True

**Compiled prompt reaching the LLM**

```
Select the best tool to call based on conversation history and user's intent.
```

**Tools visible to LLM**

| Tool | Visibility? why visible |
|---|---|
| `go_to_CaseManagement` | Guard `isVerified==True` now True |
| `go_to_OrderInquiries` | Guard `isVerified==True` now True |
| `go_to_GeneralFAQ` | No guard |
| `go_to_escalation` | No guard |
| `go_to_off_topic` | No guard |
| `go_to_ambiguous_question` | No guard |
| `go_to_Product_Info_and_Features` | No guard |

**Tools hidden from LLM**

| Tool | Visibility? why hidden |
|---|---|
| `go_to_ServiceCustomerVerification` | Guard `isVerified==False` now False |

**LLM decision**

> The original user intent was "provide the tracking status of my last order." Now that verification is complete and `go_to_OrderInquiries` is visible, the LLM invokes it. `@utils.transition` fires, routing to `OrderInquiries`.

---

## Observability And Tracing

> **Screenshot: Agentforce Debug Panel**

![Trace](/img/agent-script/deep-dive/reasoning_span_trace.png)

![React Span Json](/img/agent-script/deep-dive/react_span.png)

**Agentforce adds this System Message**

5. When multiple subagent-specific tools might apply, **use the most specific and relevant one first**
6. **After tool usage, evaluate if additional tools are needed** before responding
   - If more tools are needed, clearly explain what's still missing and which type of tool(s) you'll use next.
   - If information is sufficient, provide a complete response based on the collected tool results.
   - If a tool fails, retry 1-2 times; if still failing, explain the issue, suggest alternatives, and advise when to retry

---

## Run Summary

Here are the States with positional alignment of **InstructionX** [ `| Always Run the action {!@actions.counterIncr} to update update subCounter` ]

### InstructionX at top

| Turn | User Message | Parse(s) | counterIncr calls | counterVerify | subCounter |
|---|---|---|---|---|---|
| 1 | provide the tracking status of my last order | 1 | 1 | 2 | 1 |
| 2 | user provides user name: nikhilgupta@salesforce.com.devpro | 2 | 0 | 4 | 1 |
| 3 | user enters `<<generated verification code>>` | 2 | 0 | 6 | 1 |
| **Total / Final State** | | **5** | **1** | **6** | **1** |

### InstructionX at Bottom

| Turn | User Message | Parse(s) | counterIncr calls | counterVerify | subCounter |
|---|---|---|---|---|---|
| 1 | provide the tracking status of my last order | 1 | 1 | 2 | 1 |
| 2 | user provides user name: nikhilgupta@salesforce.com.devpro | 1 | 1 | 4 | 2 |
| 3 | user enters `<<generated verification code>>` | 2 | 0 | 6 | 2 |
| **Total / Final State** | | **4** | **2** | **6** | **2** |

### Explanation for Parse Runs variability

The number of times the AgentScript parser processes the instructions can vary between different execution runs, which directly impacts the frequency with which deterministic actions are executed. This variability in parsing behavior creates inconsistent execution patterns, where the same deterministic instruction may run a different number of times depending on how the parser interprets and processes the script during that particular run.

> For example, if the parser processes a subagent's reasoning instructions 3 times in one run versus 5 times in another run, a deterministic action like `counterIncr` (which increments `@variables.counterVerify` and `@variables.subCounter`) will execute 3 times in the first scenario but 5 times in the second, resulting in different final counter values despite identical user interactions and script logic.

---

## Observations and Takeaways

As shown in Turn 2's walkthrough, the LLM has two parses but chose not to call `counterIncr` in either; despite the instruction saying `Always run`. This is because the pipe `|` prefix **makes it a suggestion, not a command**

1. `counterIncr` is not called every turn in either setup. It depend on placement and when LLM decides to use it.
2. Bottom placement led to more compliance
3. Parse count can differ between runs, which changes how often the deterministic line runs
4. "Always run" is not enforced; planner model can skip when it prioritizes verification steps.
5. While the action is wrapped in reasoning step prefixed by pipe, `|`, Language Model (used by reasoning planner) will decide, if it wants to execute that action or NOT (ergo, Non-Determinism)
---

See [Full Agentscript](/img/agent-script/deep-dive/agentscript.agent)
