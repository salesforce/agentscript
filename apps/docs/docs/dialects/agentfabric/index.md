# Agent Script for MuleSoft Agent Fabric (Beta)

In [MuleSoft Agent Fabric](https://docs.mulesoft.com/general/learning-map-agent-fabric), an agent network coordinates groups of agents, brokers, LLMs, and MCP servers and acts as a central hub for defining, validating, and executing agentic processes across your enterprise. After you configure the registry and other elements of your agent network project, you build the rest of the workflow using Agent Script, which enables you to build predictable, context-aware agent workflows that don't rely solely on interpretation by an LLM. Using Agent Script, you create broker and node definitions and configurations that enable multi-agent orchestration in your project.

:::note
The Agent Fabric dialect is currently in beta — documentation and implementation are subject to change.
:::

After you configure the registry and other elements of your agent network project, you build the rest of the workflow using Agent Script. Agent Script enables you to build predictable, context-aware agent workflows that don't rely solely on interpretation by an LLM. 

## Agent Script Structure

The following explains settings and configurations specific to MuleSoft agent network projects. To learn more about Agent Script, see the [Agent Script documentation](https://developer.salesforce.com/docs/ai/agentforce/guide/agent-script.html).

### Dialect Referencing and Versioning

AgentScript files contain a header specifying the dialect and a version binding. SEMVER Major and minor are used for fixing to a specific dialect version.

The dialect header specifies that the script is strictly bound to a specific version or later of the AGENTFABRIC dialect. Deploying an agent to a runtime that doesn't support this version results in an error.

* Using major.minor (for example, `AGENTFABRIC=1.1`) binds to version 1.1 or later  
* Using major only (for example, `AGENTFABRIC=1`) references the latest version within that major version

**Example**

```agentscript
# @dialect: AGENTFABRIC=1.0-BETA
```

### System Section

This section defines the `instructions` attribute, which acts as a default system prompt that will be used whenever an agentic node doesn't define a `system.instructions` of its own.

**Example**

```agentscript
system:
  instructions: "You are the onboarding agent"
```

The system section has these parameters.

| Parameter | Description | Type | Required |
| :---- | :---- | :---- | :---- |
| `instructions` | Default system prompt used when an agentic node doesn't define its own `system.instructions`. | String | Yes |

### Agent Config Section 

The config section is the standard Agent Script config section, with the addition of the optional `default_llm` field. This section defines metadata and default settings for the agent.

**Example**

```agentscript
config:
  agent_name: "employee-onboarding"
  label: "Employee Onboarding Agent"
  description: "An Agent that performs employee onboarding"
```

The config section has these parameters.

| Parameter | Description | Type | Required |
| :---- | :---- | :---- | :---- |
| `agent_name` | The name identifier for the agent. | string | \- |
| `label` | A human-readable display name for the agent. | string | \- |
| `description` | A description of what the agent does. | string | \- |
| `default_llm` | Specifies a default LLM to be used on all agentic nodes that don't specify otherwise. | @llm reference See [LLM](#llm-section) | No |

### LLM Section {#llm-section}

The `llm` element is where you define the LLMs to use for reasoning and generation. Each `target` must use the `llm://` URI scheme so the runtime binds to the correct governed connection.

**Example**

```agentscript
llm:
  open-api-llm:
    target: "llm://open_ai_connection"
    kind: "OpenAI"
    model: "gpt5-mini"
    reasoning_effort: "LOW"
  gemini-llm:
    target: "llm://gemini_connection"
    kind: "Gemini"
    model: "gemini-3-flash-preview"
    thinking_level: "HIGH"
    top_p: 0.3
```

#### LLM Configuration: OpenAI

The OpenAI configuration has these properties.

| Parameter | Description | Type | Required |
| :---- | :---- | :---- | :---- |
| `target` | Governed LLM connection as a URI; must use the `llm://` scheme | URI (`llm://…`) | Yes |
| `kind` | Discriminator for the LLM provider; selects which provider-specific attributes apply | String, `OpenAI` | Yes |
| `model` | The name of the model to use | String | Yes |
| `reasoning_effort` | Constrains effort on reasoning for reasoning models. gpt-5.1 defaults to NONE, previous ones default to MEDIUM | enum\['NONE', 'MINIMAL', 'LOW', 'MEDIUM', 'HIGH'\] | No |
| `temperature` | Controls randomness in the output | number | No |
| `top_p` | Nucleus sampling parameter | number | No |
| `top_logprobs` | Number of most likely tokens to return at each position | integer | No |
| `max_output_tokens` | Maximum number of tokens to generate | integer | No |

**Example**

```agentscript
llm:
  open-api-llm:
    target: "llm://open_ai_connection"
    kind: "OpenAI"
    model: "gpt5-mini"
    reasoning_effort: "LOW"
```

#### LLM Configuration: Gemini

The Gemini configuration has these properties.

| Parameter | Description | Type | Required |
| :---- | :---- | :---- | :---- |
| `target` | Governed LLM connection as a URI; must use the `llm://` scheme | URI (`llm://…`) | Yes |
| `kind` | Discriminator for the LLM provider; selects which provider-specific attributes apply | String, `Gemini` | Yes |
| `model` | The name of the model to use | String | Yes |
| `thinking_level` | The level of thoughts tokens that the model should generate | Enum\['LOW', 'HIGH'\] | No |
| `thinking_budget` | Indicates the thinking budget in tokens. 0 is DISABLED. \-1 is AUTOMATIC. The default values and allowed ranges are model dependent | Number | No |
| `temperature` | Controls the degree of randomness in token selection. Lower temperatures are good for prompts that require a less open-ended or creative response, while higher temperatures can lead to more diverse or creative results | Number | No |
| `top_p` | Tokens are selected from the most to least probable until the sum of their probabilities equals this value. Use a lower value for less random responses and a higher value for more random responses | Number | No |
| `response_logprobs` | Whether to return the log probabilities of the tokens that were chosen by the model at each step | Boolean | No |
| `max_output_tokens` | Maximum number of tokens that can be generated in the response | Integer | No |

**Example**

```agentscript
llm:
  gemini-llm:
    target: "llm://gemini_connection"
    kind: "Gemini"
    model: "gemini-3-flash-preview"
    thinking_level: "HIGH"
    top_p: 0.3
```

### Action Definitions

You define A2A and MCP actions in Agent Script under the top-level `actions` block. Each action `target` uses a URI whose scheme is the underlying protocol (for example `a2a://` or `mcp://`), so the runtime can route the connection correctly.

#### A2A Actions

A2A actions execute the `message/send` A2A method and do not specify inputs or outputs.

**Example**

```agentscript
actions:
  hr_agent:
    target: "a2a://hr_agent_connection"
    kind: "a2a:send_message"
```

A2A actions have these properties.

| Parameter | Description | Type | Required |
| :---- | :---- | :---- | :---- |
| `target` | Governed A2A connection as a URI; must use the `a2a://` scheme | URI (`a2a://…`) | Yes |
| `kind` | Indicates that this executes the message/send A2A method. | "a2a:send\_message" | Yes |

#### MCP Actions

MCP actions invoke Model Context Protocol actions with optional input binding.

**Example**

```agentscript
actions:
  send_slack_message:
    target: "mcp://slack_mcp_connection"
    kind: "mcp:tool"
    tool_name: "send-message"
    inputs:
      channel: string = "my-default-channel"
      message: string
```

MCP actions have these properties.

| Parameter | Description | Type | Required |
| :---- | :---- | :---- | :---- |
| `target` | Governed MCP connection as a URI; must use the `mcp://` scheme | URI (`mcp://…`) | Yes |
| `kind` | Constant indicating this will invoke an MCP tool | "mcp:tool" | Yes |
| `tool_name` | The name of the tool to call | String | Yes |
| `inputs` | Define bindable arguments. Input arguments provided are not exhaustive. The tool will auto-discover additional arguments and consider them in slot filling mode. | Object | No |

### A2A Trigger 

Triggers reference one of the interfaces defined for a broker in the agent network. Each broker must have one–and only one–trigger per each interface declared in its agent network.

The A2A trigger reacts to send/message methods and automatically manages the task history, context ID and task IDs. The trigger also responds to various A2A protocol methods.

* [Get Task](https://a2a-protocol.org/latest/specification/#313-get-task)  
* [List Tasks](https://a2a-protocol.org/latest/specification/#314-list-tasks)  
* [Cancel Task](https://a2a-protocol.org/latest/specification/#315-cancel-task)  
* [Subscribe to Task](https://a2a-protocol.org/latest/specification/#316-subscribe-to-task)  
* [Create Push Notification Config](https://a2a-protocol.org/latest/specification/#317-create-push-notification-config)  
* [Get Push Notification Config](https://a2a-protocol.org/latest/specification/#318-get-push-notification-config)  
* [List Push Notification Config](https://a2a-protocol.org/latest/specification/#319-list-push-notification-configs)  
* [Delete Push Notification Config](https://a2a-protocol.org/latest/specification/#3110-delete-push-notification-config)  
* [Get Extended Agent Card](https://a2a-protocol.org/latest/specification/#3111-get-extended-agent-card)

**Example**

```agentscript
trigger employeeOnboardingTrigger:
  kind: "a2a"
  target: "brokers://employee-onboarding/a2a"
  on_message: -> transition to @orchestrator.hrSystemOnboard
```

The A2A trigger has these properties.

| Parameter | Description | Type | Required |
| :---- | :---- | :---- | :---- |
| `kind` | Value that indicates this is an A2A trigger. | `"a2a"` | Yes |
| `target` | Broker interface entry point. Must use the `brokers://` URI form: `brokers://<brokerName>/<interfaceName>` | URI (`brokers://…`) | Yes |
| `on_message` | Procedure that executes when the A2A interface receives a new `message/send` request. Must define a transition to the workflow's initial node. | Procedure | Yes |

## Node Types

Agent network and Agent Script support these node types. 

### Subagent Node

This node defines a generic agent loop node, made of a prompt and a set of actions. Because it can use actions and supports human-in-the-loop flows, this node is ideal for implementing patterns like classification, semantic routing, or LLM reasoning.

**Example**

```agentscript
subagent profile-extractor:
  description: "Extracts structured user profile data from text"
  reasoning:
    instructions: -> 
      Extract the following information from the user's message: {!@request.payload.message.parts[0].text}
    outputs:
      properties:
        name:
          type: "string"
          description: "Full name of the person"
          minLength: 1
        email:
          type: "string"
          description: "Email address"
          pattern: "^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$"
        age:
          type: "integer"
          description: "Person's age"
          minimum: 0
          maximum: 150
        preferences:
          type: "object"
          description: "User preferences"
          properties:
            newsletter:
              type: "boolean"
              description: "Whether user wants newsletter"
              default: "false"
            category:
              type: "string"
              description: "Preferred category"
              enum:
                - "tech"
                - "business"
                - "sports"
        tags:
          type: "array"
          description: "Interest tags"
          items:
            type: "string"
          minItems: 1
          maxItems: 10
  on_exit: -> transition to @orchestrator.process_profile
```

The subagent node has these properties.

| Parameter | Description | Type | Required |
| :---- | :---- | :---- | :---- |
| `id` | The node identifier, defined next to the node type. | String | Yes |
| `label` | An optional short, human-readable display name for the node. | String | No |
| `description` | A CommonMark string providing a description of the node. | String | No |
| `on_exit` | A procedure that executes when the node execution finishes. | Procedure | Yes |
| `llm` | Overrides the default LLM setting | @llm reference See [LLM Section](#llm-section) | No |
| `system.instructions` | Overrides the global `system.instructions` at the file root level | String | No |
| `reasoning.instructions` | Session-specific query or instructions for this particular node, typically containing user provided or user related context | String | Yes |
| `reasoning.actions` | The available actions | Array\[actions\] | No |
| `reasoning.outputs` | Schema definition describing the expected structure of the agent's output | Outputs See [Node Outputs](#node-outputs) | No |
| `reasoning.max_number_of_loops` | The maximum number of loops an execution can take. Useful for keeping it from running too long and consuming too many tokens. Default: 25 | Integer | No |
| `outputs` | A schema definition for the agentic output. | Object See [Node Outputs](#node-outputs) | No |

### Orchestrator Node

The orchestrator node is a specialization of the subagent node used for orchestrating multiple agents and MCP servers to achieve a specified goal. It is optimized for multi-agent orchestration. Use this node type for workflows that need to call multiple external agents or actions to achieve a goal.

**Example**

```agentscript
orchestrator flight-booking-agent:
  description: books flights by looking for the best offer across approved partners
  system:
    instructions: |
      You are a flight booking agent.
      
      The process for flight booking is:
        1. Ask the user for a destination and travel dates and present them with matching alternatives using available actions.
        2. Allow the user to change or refine the search
        3. Once the user selects a flight, book it using the concur agent tool
  reasoning:
    instructions: ->
      @request.payload.message.parts[0].text
    actions:
      search-flight: @actions.search-flight
        with companyId = @variables.companyId
      
      get-flight-info: @actions.get-flight-info
      
      concur: @actions.concur-agent
        with http_headers = {"Authorization": @request.headers["Authorization"]}
  outputs:
    properties:
      flightNumber:
        type: "string"
        description: "The flight identification number"
      airline:
        type: "string"
        description: "The airline name"
    max_number_of_loops: 10
    task_timeout_secs: 60
  
  on_exit: ->
    transition to @executor.send_summary
```

The orchestrator node has these properties.

| Parameter | Description | Type | Required |
| :---- | :---- | :---- | :---- |
| `id` | The node identifier, defined next to the node type. | String | Yes |
| `label` | An optional short, human-readable display name for the node. | String | No |
| `description` | A CommonMark string providing a description of the node. | String | No |
| `on_exit` | A procedure that executes when the node execution finishes. | Procedure | Yes |
| `llm` | Overrides the default LLM setting | @llm reference See [LLM Section](#llm-section) | No |
| `system.instructions` | Overrides the global `system.instructions` at the file root level | String | No |
| `reasoning.instructions` | Session-specific query or instructions for this particular node, typically containing user provided or user related context | String | Yes |
| `reasoning.actions` | The available actions | Array\[actions\] | No |
| `reasoning.outputs` | Schema definition describing the expected structure of the agent's output | Outputs See [Node Outputs](#node-outputs) | No |
| `reasoning.max_number_of_loops` | The maximum number of loops an execution can take. Useful for keeping it from running too long and consuming too many tokens. Default: 25 | Integer | No |
| `outputs` | A schema definition for the agentic output. | Object See [Node Outputs](#node-outputs) | No |

### Generator Node

The generator node calls an LLM to generate text. It is not an agent loop, and it does not support human-in-the-loop learning or other actions. It performs exactly one LLM call. Use this node for summarization, formatting, or templated text generation.

**Example**

```agentscript
generator summarize-report:
  description: "Generate a one-paragraph summary of the report."
  prompt: "Summarize the following in one paragraph: {!@variables.report}"
  on_exit: ->
    transition to ...
```

The generator node has these properties. 

| Parameter | Description | Type | Required |
| :---- | :---- | :---- | :---- |
| `id` | The node identifier, defined next to the node type. | String | Yes |
| `label` | An optional short, human-readable display name for the node. | String | No |
| `description` | A CommonMark string providing a description of the node. | String | No |
| `on_exit` | A procedure that executes when the node execution finishes. | Procedure | Yes |
| `llm` | A reference to the LLM connection. | @llm reference See [LLM Section](#llm-section) | No |
| `system.instructions` | Overrides the global `system.instructions` at the file root level for this generator node. | String | No |
| `prompt` | Session-specific query or instructions for this particular node, typically containing user provided or user related context. | String | Yes |
| `outputs` | A schema definition for the agentic output. | Object See [Node Outputs](#node-outputs) | No |

### Executor Node

The executor node is used to execute a set of Agent Script statements, primarily for setting variables or deterministic tool invocations. Use this node to set variables or call actions with known or fixed arguments.

**Example**

```agentscript
executor sendHrSlackUpdate:
  do: ->
    run @actions.send_slack_message
    with text= @generator.generate-hr-slack-update-message.output
    with channel_id= "my-onboarding-channel-id"
  on_exit: ->
    transition to @router.countrySwitch
```

The executor node has these properties. 

| Parameter | Description | Type | Required |
| :---- | :---- | :---- | :---- |
| `id` | The node identifier, defined next to the node type. | String | Yes |
| `label` | An optional short, human-readable display name for the node. | String | No |
| `description` | A CommonMark string providing a description of the node. | String | No |
| `on_exit` | A procedure that executes when the node execution finishes. | Procedure | Yes |
| `do` | Agent Script statements to execute | procedure | Yes |

### Router Node

The router node performs dynamic transitions based on deterministic conditions. This node does not support transition to in its on\_exit attribute. Use this node for branching based on structured output from a previous node.

**Example**

```agentscript
router countryRouter:
  routes:
    - target: @orchestrator.argentinaOnboard
      when: @orchestrator.hrSystemOnboard.output.country  == "ARG"
      label: "Argentina"
    - target: @orchestrator.usOnboard
      when: @orchestrator.hrSystemOnboard.output.country  == "USA"
      label: "USA"
  otherwise:
    target: @echo.invalidCountryResponse
```

The router node has these properties.

| Parameter | Description | Type | Required |
| :---- | :---- | :---- | :---- |
| `id` | The node identifier, defined next to the node type. | String | Yes |
| `label` | An optional short, human-readable display name for the node. | String | No |
| `description` | A CommonMark string providing a description of the node. | String | No |
| `on_exit` | A procedure that executes when the node execution finishes. | Procedure | Yes |
| `routes` | An array of condition and target pairs, plus an optional label field for UI. Must define at least one route. Each route contains: `target`, `when`, and optional `label`. | Array | Yes |
| `otherwise` | Defines a default transition when no route condition matches. Contains: `target`. | Object | Yes with `routes` |

### Echo Node

The echo node sends a response back to the client. The number of responses depends on the trigger interface and its configuration. Use this node for the end of a workflow, or anytime you want to emit a response. Currently only supports `a2a:response` (non-streaming). 

**Example**

```agentscript
echo a2a_response:
  kind: "a2a:response"
  task: a2a.task({
    state: "completed",
    message: a2a.message(
          {
            messageId: uuid(),
            parts:[
              a2a.textPart("You have been onboarded!your employee ID is" +@orchestrator.hrSystemOnboard.output.employeeId)
            ]
          }),
    artifacts: a2a.parts(*@variables.artifacts),
    metadata:None
    })
```

| Parameter | Description | Type | Required |
| :---- | :---- | :---- | :---- |
| `id` | The node identifier, defined next to the node type. | String | Yes |
| `label` | An optional short, human-readable display name for the node. | String | No |
| `description` | A CommonMark string providing a description of the node. | String | No |
| `on_exit` | A procedure that executes when the node execution finishes. | Procedure | Yes |
| `kind` | Discriminator for the response type. Must be "a2a:response". | String | Yes |
| `task` | A Task object as defined in the A2A specification. The `id`, `contextId` and `history` attributes are automatically populated by the trigger | Task object | Yes |

### A2A Namespace Functions

The `a2a` namespace provides a set of functions that support A2A Task object creation. Do not prefix these functions with `@` as it's reserved for references such as `@variables`, `@actions`, `@request`, and `@orchestrator.<nodeId>`.

| Function | Description | Input Arguments | Output | Example |
| :---- | :---- | :---- | :---- | :---- |
| `a2a.task` | Builds an A2A Task response object | `state: str` (required) `message` (optional, from `a2a.message`) `artifacts: list` (optional, from `a2a.artifact`) `metadata: dict` (optional) | `dict` (Task) | `a2a.task("completed", message=a2a.message(...), artifacts=[a2a.artifact(...)])` |
| `a2a.message` | Builds an A2A Message object | `parts: list` (required, from `a2a.textPart/a2a.dataPart/a2a.filePart`) `role: str` (optional, default: "agent") `metadata: dict` (optional) | `dict` (Message) | `a2a.message([{messageId: uuid(), parts: [a2a.textPart("Hello")]}])` |
| `a2a.textPart` | Builds a TextPart object (kind: "text") | `text: str` (required) `metadata: dict` (optional) | `dict` (TextPart) | `` a2a.textPart("Employee ID: {!@orchestrator.employee.id}") `a2a.textPart("Status: Complete", metadata={priority: "high"})` `` |
| `a2a.dataPart` | Builds a DataPart object (kind: "data") | `data: dict` (required) `metadata: dict` (optional) | `dict` (DataPart) | `` a2a.dataPart({employeeId: "E123", department: "Engineering"}) `a2a.dataPart(@orchestrator.result.output)` `` |
| `a2a.filePart` | Builds a FilePart object (kind: "file") | `uri: str` (optional, required if bytes not provided) `bytes: str` (optional, base64-encoded) `name: str` (optional) `mime_type: str` (optional) `metadata: dict` (optional) | `dict` (FilePart) | `a2a.filePart(uri="https://example.com/report.pdf", name="report.pdf", mime_type="application/pdf") a2a.filePart(bytes="SGVsbG8gV29ybGQ=", name="data.txt")` |
| `a2a.artifact` | Builds an A2A Artifact object with auto-generated ID | `parts: list` (required, from `a2a.textPart/a2a.dataPart/a2a.filePart`)  `artifact_id: str` (optional, auto-generated)  `name: str` (optional)  `description: str` (optional) `metadata: dict` (optional) | `dict` (Artifact) | `` a2a.artifact([a2a.dataPart(...)], name="Results", description="Analysis results") `a2a.artifact([a2a.filePart(...)], artifact_id="custom-id")` `` |
| `a2a.parts` | Collects multiple items into a list for composing parts/artifacts arrays | `*args: Any` (variable arguments) | `list` | `` a2a.parts(*@variables.artifacts) `a2a.parts(a2a.textPart("Part 1"), a2a.dataPart({key: "value"}))` `` |

Usage notes:

* Functions are designed to be composed: `a2a.task` accepts `messages` created by `a2a.message`, which accepts `parts` created by `a2a.textPart`/`a2a.dataPart`/`a2a.filePart`.
* `a2a.filePart` requires either `uri` OR `bytes` (base64-encoded), but not both  
* `a2a.artifact` auto-generates `artifactId` if it's not provided.  
* Use `a2a.parts` with the `*` operator to unpack arrays, for example, `a2a.parts(*@variables.artifacts)`.
* All `metadata` parameters are optional and accept arbitrary dictionaries  
* For tasks, it's not necessary to define the `id`, `contextId` and `history` attributes, those are automatically populated by the trigger.

## Built-in Functions {#built-in-functions}

Use these functions in expressions alongside references and interpolations. They include time and ID helpers (`now`, `uuid`), string utilities (`strip`, `startswith`, and `endswith`), JSON parsing (`parse_json`), and common numeric helpers (`abs`, `round`, and `sum`) for deterministic math-style logic without calling external tools.

| Function | Description | Input arguments | Output | Example |
| :---- | :---- | :---- | :---- | :---- |
| `now` | Current UTC time in ISO 8601 format | None | String (ISO 8601\) | `now()` |
| `uuid` | Random UUID v4 | None | String (UUID) | `uuid()` |
| `strip` | Removes leading/trailing characters from a string | String, optional chars (default: whitespace) | String | `strip(" hello ") → "hello"` |
| `startswith` | Whether a string starts with a prefix | String, prefix | Boolean | `startswith("hello world", "hello")` |
| `endswith` | Whether a string ends with a suffix | String, suffix | Boolean | `endswith("report.pdf", ".pdf")` |
| `abs` | Absolute value | Number | Number | `abs(-42)` |
| `round` | Round to optional digit count | Number, optional `ndigits` | Number | `round(3.14159, 2)` |
| `sum` | Sum of a numeric list | List | Number | `sum([10, 20, 30])` |
| `parse_json` | Parse a JSON string | String (valid JSON) | Object or array | `parse_json('{"key": "value"}')` |

## Node Outputs {#node-outputs}

Use the `outputs` field to define the expected shape of the agent's response using a schema notation similar to a JSON schema. When provided, the agent produces output matching the defined structure for downstream parsing and processing.

Each property maps to a field in the agent's output. The following types are supported.

**Note:** Advanced JSON schema features are not supported, so do not copy patterns from generic JSON Schema tutorials unless they match what is documented here.

| Type | Description |
| :---- | :---- |
| String | Text values with optional constraints like `pattern` (regex), `minLength`, `maxLength`, and `enum` (allowed values). |
| Number / Integer | Numeric values with optional constraints like `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, and `enum`. |
| Boolean | `True` or `False` (with optional default). |
| Array | Lists of items, where `items` define the schema for each element (can be any supported type). Supports `minItems` and `maxItems`. |
| Object | Nested structures with their own `properties` map. Supports a `required` array to specify mandatory fields. |

Each property definition can include:

* `type`: The data type (required).  
* `description`: A human-readable explanation of the property's purpose.  
* `default`: A default value if the property is omitted.

The `outputs` definition does not support the following:

* `additionalProperties` or similar JSON Schema extensibility flags  
* Combinators such as `anyOf`, `oneOf`, or `allOf`  
* References or shared definitions (`$ref`, `$defs`)  
* Composition beyond nested `object` / `array` structures as described above

## Node Expressions and References

Nodes access data from other parts of the workflow using expressions.

The following references are used.

| Prefix | Reference | Example |
| :---- | :---- | :---- |
| `@llm.` | LLM definitions | `@llm.open-api-llm` |
| `@actions.` | action definitions | `@actions.hr_agent` |
| `@request.` | Trigger request data | `@request.payload`, `@request.interface` |
| `@request.headers` | HTTP headers (case-insensitive) | `@request.headers["Authorization"]` |
| `@variables.` | Workflow variables | `@variables.companyId` |
| `@<nodeType>.<nodeId>.` | Node references | `@orchestrator.hrOnboard.output` |

### Accessing Node Output and Input

Every node has `.output` (the value it produced) and `.input` (the output of whichever node transitioned into it).

**Example**

```agentscript
@orchestrator.hrOnboard.output.employeeId    # a specific field from a node's output
@generate.writeEmailContent.output             # the full string from a generate node
@generate.generate_email.input                 # whatever the preceding node produced
```

* Use `.output` when you know exactly which upstream node you’re referencing.  
* Use `.input` when multiple nodes transition into the current one and you want to decouple it from the specific path taken.

In this example, `@generate.generate_email.input` returns whichever of node\_a/b/c actually transitioned into it.

```
node_a ──┐
         │
node_b ──┼──► generate_email ──► send_email
         │
node_c ──┘
```

### Setting Action Headers

Any actions that connect to an external system often need to set custom headers. Use cases range from propagating authorization headers to adding custom correlation information.

For this, both the MCP and A2A actions automatically get an implicit optional `http_headers` parameter object type that can be used to set those:

```agentscript
actions:
  my_hr_agent: @actions.hr_agent
    with http_headers = {"Authorization": @request.headers["Authorization"], "X-CorrelationId": @variables.conversationId}
```

### String Interpolation

Use `{!expression}` to embed values inside strings.

**Example**

```agentscript
prompt: "The employee's country is {!@orchestrator.hrOnboard.output.country}"
```

### Slot Filling 

Use slot filling (`...`) to tell an LLM to figure out a value.

**Example**

```agentscript
actions:
  send_message: @actions.send_slack_message
    with message = ...    # LLM decides the message content
```

### Tool Binding at the Node Level

When you reference a tool inside a node, you can fix, default, or slot-fill its arguments using `with`.

**Example**

```agentscript
actions:
  # All arguments via slot filling (LLM decides everything)
  sendToDefault: @actions.send_slack
  
  # Fix the channel, LLM fills the message
  sendToFixed: @actions.send_slack
    with channel = "agent-fabric"
  
  # Fix everything — fully deterministic
  fullyDeterministic: @actions.send_slack
    with message = @variables.calculatedMessage
    with channel = @variables.channelId
```
