# Agent Script Formal Specification

## Part I: Base Grammar

### 1. Structure

#### 1.1 Indentation

Agent Script is indentation-sensitive. Nesting is determined by indentation level — a child block or field must be indented further than its parent. Spaces are the standard indentation character. Tabs are not recommended and their behavior is implementation-defined. The indentation unit is flexible — any increase in depth relative to the parent is valid; there is no required minimum (e.g. multiples of 2 or 4).

```
block_a:
    child_one: "value"
    child_two:
        grandchild: "value"
```

Here `child_one` and `child_two` are children of `block_a`. `grandchild` is a child of `child_two`.

#### 1.2 Comments

Comments begin with `#` and extend to the end of the line. There is no multi-line comment syntax.

```
# top-level comment
block_a:
    field: "value"  # inline comment
```

Comments may appear at the top level, inline with a field, or between blocks. Note: within a multiline template string (introduced by `|`), the `#` character is treated as a comment only if it appears at or shallower than the template's base indentation level. At deeper indentation, `#` is treated as literal template content. See [Section 6: Templating Syntax](#6-templating-syntax).

#### 1.3 Blocks

A block is the fundamental structural unit of Agent Script. A block is a key followed by `:`, optionally followed by a value. Blocks may be nested arbitrarily.

```
block_a:
    field_one: "value"
    field_two: 42
```

**Named blocks**

Some block types defined by the schema accept an instance name — a second label following the block type, separated by a space:

```
subagent order_handler:
    description: "Handles order inquiries"
```

Here `subagent` is the block type and `order_handler` is the instance name. Whether a block type accepts an instance name is determined by the schema; not all block types support it.

**Value types**

A block's value may be one of the following forms:

- **Scalar** — a string, number, or boolean on the same line as the key (see [Section 2: Type System](#2-type-system)):
  ```
  label: "My Agent"
  count: 42
  enabled: True
  ```

- **Sub-block** — a nested block, introduced by indentation on the following line:
  ```
  block_a:
      field: "value"
  ```

- **Sequence** — a YAML-style list of scalar values or list-maps:
  ```
  items:
      - "first"
      - "second"

  entries:
      - key: "name"
        value: "example"
  ```

- **Procedure** — executable logic, introduced by `->` or auto-detected from schema context. See [Section 5: Procedure Syntax](#5-procedure-syntax).

- **Template string** — a multiline string introduced by `|`. See [Section 6: Templating Syntax](#6-templating-syntax).

#### 1.4 Indented Properties

Non-primitive values may have indented properties beneath them. These properties are modifiers that annotate or configure the value — they are not nested blocks in the structural sense, but metadata attached to the declaration.

This pattern appears in variable declarations:

```
status: mutable string = "pending"
    description: "The current status of the request"

tags: mutable list[string] = None
    description: "List of tags associated with the request"
```

And in action references within procedures:

```
reasoning:
    actions:
        lookup_order: @actions.LookupOrder
            description: "Look up order details by order ID"
            with order_id=@variables.order_id
```

The indented properties are defined by the schema for the parent value type. Which properties are valid, required, or optional depends on the schema context.

### 2. Type System

#### 2.1 Scalar Types

Agent Script has four scalar types:

| Type | Description | Example |
|---|---|---|
| `string` | Quoted string value | `"hello"` |
| `number` | Integer or floating-point | `42`, `3.14` |
| `boolean` | Boolean value (`True` or `False`) | `True` |
| `object` | Untyped structured value | `None` (default) |

Boolean literals are capitalized: `True` and `False`.

#### 2.2 Lists and Objects

Lists are parameterized with an element type using bracket notation:

```
list[string]
list[number]
list[boolean]
list[object]
```

`object` is an untyped structured value. It accepts any nested structure and defaults to `None` when no value is provided.

#### 2.3 Variable Declarations

Variables are typed declarations that appear wherever the schema permits them. They are not required to be grouped inside a `variables` block — that is a schema-level convention, not a language requirement. Each declaration specifies a modifier, a name, a type, and an optional default value:

```
item_count: mutable number = 0
    description: "Number of items in the order"
session_id: linked string
    description: "Session ID provided by the runtime"
```

**Modifiers**

- `mutable` — the variable can be read and written from within the agent, including via `set` statements. This is the standard modifier for variables the agent manages.

- `linked` — the variable is bound to an external value provided by the runtime. It is strictly read-only — it cannot be assigned by any mechanism within the agent, including `set`, `@utils.setVariables`, or `with` parameters.

```
status: mutable string = "pending"
user_id: linked string
retry_count: mutable number = 0
locale: linked string
```

**Type annotation**

The type follows the variable name and modifier, separated by a space. A default value may be provided with `=`. If no default is given, the variable defaults to `None`.

```
label: mutable string = "default"
tags: mutable list[string] = None
metadata: mutable object = None
```

### 3. Values and Expressions

#### 3.1 Expression Syntax

Expressions follow Python-like syntax. The following operators are supported, listed by precedence from lowest to highest:

**Logical operators**

| Operator | Description |
|---|---|
| `or` | Logical OR |
| `and` | Logical AND |
| `not` | Logical NOT (unary) |

**Comparison operators**

| Operator | Description |
|---|---|
| `==` | Equality |
| `!=` | Inequality |
| `<`, `<=`, `>`, `>=` | Numeric comparison |
| `is` | Identity / None check |
| `is not` | Negated identity / None check |

**Arithmetic operators**

| Operator | Description |
|---|---|
| `+`, `-` | Addition, subtraction |
| `*`, `/` | Multiplication, division |
| `+` (unary), `-` (unary) | Unary plus/minus |

**Other**

| Syntax | Description |
|---|---|
| `(expr)` | Parenthesized expression |
| `expr.field` | Member access |
| `expr[index]` | Subscript / index access |
| `fn(args)` | Function call |
| `a if condition else b` | Ternary expression (Python-style, lowest precedence) |

Examples:

```
@variables.score >= 80
@variables.name != "" and @variables.verified == True
@outputs.result is not None
@outputs.items[0].id
@variables.count + 1
"prefix_" + @variables.label
score if score > 0 else 0
```

**Collection literals:** List and dictionary literals are supported in expressions:

```
[]          # empty list
[1, 2, 3]   # list literal
{}          # empty dict / object
```

These are most commonly used as default values in variable declarations:

```
tags:     mutable list[object] = []
metadata: mutable object = {}
```

**Type coercion:** Agent Script uses loose, Python-like type coercion. Values may be implicitly converted for comparison and arithmetic where the types are compatible. Strict type enforcement is not guaranteed.

**Null dereference:** Accessing a member of a `None` value (e.g. `@variables.foo.bar` when `@variables.foo` is `None`) produces a runtime error.

#### 3.2 References (`@` Namespace Lookup)

The `@` symbol denotes a namespace lookup. A reference of the form `@namespace.member` resolves the `namespace` to a registered scope and retrieves `member` from it.

```
@variables.order_id
@outputs.temperature_celsius
@actions.LookupOrder
@subagent.billing
@utils.transition
```

**Lookup order**

Namespaces are resolved in a defined order. When `@foo.bar` is evaluated, the runtime searches registered scopes in order until it finds a scope named `foo` that contains `bar`, or returns nothing if none is found. The lookup order is:

1. Local block scope (e.g. named block instance)
2. Parent block scopes, walking up the AST
3. Global scopes (injected by the dialect)

**Global / injected namespaces**

Dialects may inject namespaces into the global scope. These are available everywhere in the script without being declared. For example, `@utils` is a global namespace injected by supported dialects, providing built-in utilities such as `@utils.transition`.

**Namespace overrides**

A dialect may override a global namespace by registering a new scope under the same name. Local or parent scopes also shadow global namespaces of the same name. This allows dialects to extend or replace built-in behaviour without changing the syntax.

**References to typed blocks**

`@` references can refer to named block instances by their block type. The block type name serves as the namespace, and the instance name is the member:

```
@subagent.billing
@subagent.order_handler
```

Here `subagent` is the block type and `billing` / `order_handler` are instance names declared elsewhere in the script. This allows procedures to reference other agents, topics, or any named block registered in the schema.

**Aliases**

Namespaces may have aliases — alternative names that resolve to the same scope. In the AgentScript dialect, `@start_agent` is an alias for `@subagent`, so `@start_agent.foo` and `@subagent.foo` resolve identically. Aliases are registered per-dialect in the schema info.

### 4. Schema

#### 4.1 Schema Management

Every block in Agent Script has a schema. Schemas are defined in TypeScript using factory functions from `@agentscript/language`. The schema for a block defines what keys are valid, what types their values must be, and whether fields are required or optional.

The core factory functions are:

| Factory | Description |
|---|---|
| `Block(name, fields)` | A block with a fixed set of typed fields |
| `TypedMap(name, valueType)` | A variadic map where keys are user-defined and all values share the same type |
| `NamedBlock(name, fields)` | A block that accepts an instance name (`block_type instance_name:`) |
| `CollectionBlock(block)` | A collection of named blocks of a given type |

**Fixed-field blocks**

A `Block` has a predefined set of keys. Unknown keys are a schema error. For example, `config` and `system` are fixed-field blocks:

```typescript
// dialect/agentscript/src/schema.ts
export const ConfigBlock = Block('ConfigBlock', {
    description: StringValue,
    agent_name:  StringValue,
    ...
});
```

In Agent Script source:
```
config:
    agent_name: "My Agent"
    description: "An AI assistant for customer support"
```

**Variadic blocks (TypedMap)**

A `TypedMap` accepts any user-defined keys, all of the same value type. For example, `variables` and `inputs`/`outputs` are variadic:

```typescript
// packages/language/src/blocks.ts
export const VariablesBlock = TypedMap('VariablesBlock', VariablePropertiesBlock);
export const InputsBlock    = TypedMap('InputsBlock',    InputPropertiesBlock);
```

In Agent Script source — any key name is valid:
```
variables:
    order_id:   mutable string = ""
    item_count: mutable number = 0
    is_ready:   mutable boolean = False
```

Schemas are defined per-dialect. Dialects extend the base schema by registering additional block types or overriding existing ones. See [Section 4.2](#42-discriminators-kind) for how dialects use discriminators to specialize blocks.

#### 4.2 Discriminators (`kind`)

A block may declare a `kind` field whose value identifies a globally-registered schema type. When present, the block inherits the schema associated with that kind — its fields, validation rules, and defaults. This allows a single block type to represent multiple concrete shapes, selected at authoring time by the value of `kind`.

The specific kinds available and the schemas they map to are dialect-defined. The mechanism is intentionally left open-ended at the base level to allow dialects to extend it freely.

### 5. Procedure Syntax

#### 5.1 Procedures and `->` Auto-Detection

A procedure is a sequence of statements that executes as the value of a field. The procedure's return type is determined by the schema — a field like `instructions` expects a string return, while `before_reasoning` expects a sequence of imperative statements.

Procedures may be introduced explicitly with `->`:

```
reasoning:
    instructions: ->
        | Greet the user and ask for their order ID.
```

However, `->` is optional. The parser auto-detects procedure context from the schema — if the schema expects a procedure at that position, the arrow may be omitted. Ambiguous cases produce undefined behavior.

#### 5.2 String Return and Templating

When a procedure's return type is `string` (as determined by the schema), the `|` operator appends to the output string. Each `|` line contributes to the final string value, in order.

```
instructions: ->
    | Welcome to customer support.
    | I'm here to help you with any issues you're experiencing.
    | Please provide your email address to get started.
```

Conditional logic can be used to build strings dynamically:

```
instructions: ->
    | Hello!
    if @variables.customer_verified:
        | I can see your account details.
    | How can I help you today?
```

See [Section 6](#6-templating-syntax) for `{!...}` interpolation within template strings.

#### 5.3 `set` Statement

`set` assigns a value to a variable. The `@variables` namespace prefix is not required — the identifier is resolved against the variable scope automatically.

```
set @variables.status = "active"
set @variables.count = @variables.count + 1
```

Attempting to `set` a `linked` variable is an error — linked variables are strictly read-only by any mechanism within the agent. Only `mutable` variables may be assigned.

#### 5.4 `run` Statement

`run` invokes a named action. Unlike function calls in expressions, `run` is a first-class statement — the action is known to the system, traced, auditable, and supports callbacks.

```
run @actions.LookupOrder
```

Actions are referenced via the `@actions` namespace. The action must be declared in the `actions` block of the current or enclosing scope.

#### 5.5 `with` Clause

`with` binds a value to an input parameter of the preceding `run` statement. Multiple `with` clauses may follow a single `run`.

```
run @actions.LookupOrder
    with order_id=@variables.order_id
    with include_history=False
```

`with` clauses must immediately follow the `run` (or each other). The parameter name on the left must match a declared input of the action. Multiple parameters may also be specified in a single `with` clause using comma separation:

```
run @actions.UpdatePreferences
    with temperature_units=..., default_location=..., notification_settings=...
```

#### 5.6 `...` (Ellipsis)

`...` is used as a `with` value to indicate that the parameter should be supplied by the LLM at runtime — i.e. the value is not known statically and is left for the model to determine.

```
run @actions.SearchKnowledge
    with query=...
    with category=...
```

#### 5.7 `available when`

`available when` is a guard clause on a reasoning action binding. It conditionally makes the action available to the LLM based on a boolean expression. When the condition is false, the action is not presented to the LLM during that reasoning turn. `available when` is only valid within `reasoning.actions` — it cannot be used in `before_reasoning` or `after_reasoning`.

```
reasoning:
    actions:
        create_return: @actions.Create_Return
            available when @variables.return_eligible == True
            with order_id=@variables.order_id
            set @variables.rma_number = @outputs.rma_number

        go_to_billing: @utils.transition to @subagent.Billing
            available when @variables.verified is True
```

`available when` appears as an indented property on a reasoning action binding, before any `with` clauses.

#### 5.8 `if` / `else`

Conditional branching in procedures uses Python-style `if`/`else` syntax. The condition is any valid expression. The body is indented one level.

```
if @variables.verified:
    set @variables.status = "active"
```

An `else` clause may follow:

```
if @variables.verified:
    transition to @subagent.Verified
else:
    transition to @subagent.Identity
```

`if`/`else` may appear in any procedure context: `before_reasoning`, `after_reasoning`, `reasoning.instructions`, and callbacks. In string-return procedures, `|` lines inside an `if`/`else` block append to the output conditionally:

```
reasoning:
    instructions: ->
        | Welcome!
        if @variables.verified:
            | I can see your account details.
        else:
            | Please verify your identity first.
```

Note: `elif` is not supported. Use nested `if`/`else` blocks for multiple conditions.

#### 5.9 Callbacks

Callback statements are the statements indented beneath a `run` block, following any `with` clauses. They execute after the action returns and have access to the action's outputs via `@outputs`.

**`@outputs` scoping:** `@outputs` is scoped strictly to the callback block of the action that produced it. It is an implied parameter — conceptually `(outputs) ->` — and is not accessible outside the callback. Once the callback block ends, `@outputs` is no longer in scope.

```
run @actions.VerifyCustomer
    with email=@variables.customer_email
    set @variables.verified = @outputs.customer_found
    set @variables.customer_id = @outputs.customer_id
    transition to @subagent.verified_flow
```

**Statement ordering:** A callback block has two phases, executed in order:

1. **Input bindings** — `with` and `to` clauses. These bind inputs to the action before it executes.
2. **Callback body** — `set`, `run`, `transition`, and `if`/`else`. These are syntactic sugar for an implicit `then: ->` block that runs after the action returns.

Valid callback statements (phase 2):
- `set` — assign a variable from `@outputs` or any expression
- `run` — invoke another action (one level of nesting only)
- `transition` — transition to another subagent

**Action failure:** If an action fails at runtime, the behavior of `@outputs` and the callback body is undefined — error handling is left to the runtime.

Callbacks are syntactic sugar for a post-action procedure body. Each nested `run` introduces its own `@outputs` scope — the inner action's outputs shadow the outer action's outputs within the inner callback. There is no way to access an outer action's `@outputs` from within an inner callback:

```
run @actions.OuterAction
    with something=...
    set @variables.outer_result = @outputs.OuterActionResult  # outer @outputs
    run @actions.InnerAction
        set @variables.inner_result = @outputs.InnerActionResult  # inner @outputs
        # @outputs.OuterActionResult is NOT accessible here
```

Nesting is capped at one level deep. This is an intentional design constraint to avoid complex callback chains that are difficult to reason about.

#### 5.10 `transition` Statement

`transition to` transfers execution to another subagent or execution block. It is a first-class statement, not a function call.

```
transition to @subagent.billing
```

`transition to` may appear in `after_reasoning`, `before_reasoning`, or as a callback after a `run`. The target must be a reference to a valid execution block as defined by the dialect schema.

`transition to <target>` is a first-class syntax rule — `to` is not a `with` parameter but a dedicated keyword in the transition statement. The `@utils.transition` utility in supported dialects exposes this as an action reference in reasoning blocks:

```
reasoning:
    actions:
        go_to_billing: @utils.transition to @subagent.billing
            description: "Transfer to billing subagent"
```

### 6. Templating Syntax

#### 6.1 String Values and Multiline Strings

Any field that accepts a string value may be written as a quoted string or as a multiline template string introduced by `|`. These are equivalent forms:

```
label: "Hello, welcome!"

label: |
    Hello, welcome!
```

The `|` introduces a multiline string. The first non-empty line following `|` establishes the base indentation level. All subsequent lines must be at that level or further indented — content at that level is included in the string, and the template ends when indentation returns to or below the base level.

```
instructions: |
    You are a helpful support agent.
    Always verify the customer before proceeding.
        This line is indented further and is included as-is.
    Back to base level.
```

#### 6.2 `|` Append Semantics in Procedures

Within a procedure that returns a string (e.g. `instructions`), `|` appends to the output string. Each `|` line contributes to the final string in order, allowing conditional logic to build strings dynamically:

```
instructions: ->
    | Welcome to support.
    if @variables.verified:
        | I can see your account details.
    | How can I help you today?
```

Each `|` statement appends its content followed by a newline. The final string is the concatenation of all appended lines.

#### 6.3 `{!...}` Expression Interpolation

Template strings support expression interpolation using `{! expr }`. The expression is evaluated at runtime and its string representation is inserted inline:

```
instructions: ->
    | Hello, {! @variables.customer_name }!
    | Your order score is {! @variables.score }/100.
    | Next step: {! @variables.next_step }
```

Expressions inside `{!...}` follow the same syntax as Section 3 — any valid expression is permitted, including arithmetic and member access:

```
| Progress: {! @variables.current + 1 } of {! @variables.total }
| Status: {! @variables.verified if @variables.verified else "unverified" }
```

**Dialect restrictions**

A dialect may restrict a string field to disallow template syntax, permitting only quoted string literals. This is enforced at analysis time as an error-level diagnostic (`template-in-deterministic-procedure`). The restriction is declared in the schema using `disallowTemplates()` on the field definition.

### 7. Action Definitions

#### 7.1 Defining Actions

Actions are named blocks that declare an external tool or function the agent can invoke. They are defined in an `actions` block and referenced in procedures via `run` or in reasoning via `@actions.Name`.

```
actions:
    LookupOrder:
        description: "Retrieve order details by order number"
        inputs:
            order_number: string
                description: "The order number to look up"
                is_required: True
        outputs:
            status: string
                description: "Current order status"
        target: "flow://Lookup_Order_By_Number"
```

The base schema fields for an action are:

| Field | Type | Description |
|---|---|---|
| `description` | string | What the action does |
| `label` | string | Display label (optional) |
| `inputs` | variadic | Input parameter declarations |
| `outputs` | variadic | Output parameter declarations |
| `target` | string | URI identifying the external implementation |
| `source` | string | Global namespace function name or legacy identifier |

Additional fields (e.g. `require_user_confirmation`, `include_in_progress_indicator`) are dialect-specific extensions.

#### 7.2 Inputs and Outputs

Inputs and outputs are variadic blocks — each key is a user-defined parameter name, and its value is a typed declaration with optional properties:

```
inputs:
    order_number: string
        description: "The order number to look up"
        is_required: True
outputs:
    status: string
        description: "Current order status"
    items: list[object]
        description: "Items in the order"
```

Which properties are valid on inputs and outputs (e.g. `is_required`, `is_user_input`, `is_displayable`) is dialect-defined.

#### 7.3 Target URI

The `target` field is a URI string that identifies the external implementation of the action. The URI scheme determines how the runtime resolves the action. URI schemes are defined by the base compiler and extended by dialects. Examples from the agentforce dialect:

```
target: "flow://Flow_API_Name"
target: "apex://Apex_Class_Name"
target: "externalService://endpoint_name"
target: "standardInvocableAction://Action_Name"
```

The base compiler provides the URI schema — dialects may register additional schemes or constrain which schemes are valid for a given action type.

#### 7.4 Inheritance

Action blocks may be extended by dialects to add fields, tighten validation, or override defaults. This is done via `ActionBlock.extend(...)` in the dialect schema definition. Extended action blocks inherit all base fields and may add or override any of them.


---

## Part II: AgentScript Dialect

The AgentScript dialect defines the standard block types for authoring agents. It is the base dialect from which others (agentforce, agentfabric) extend.

Schema defined in: `dialect/agentscript/src/schema.ts`

> **Note on `topic` vs `subagent`:** Some examples and earlier versions of the language use `topic` as a block type. `topic` is agentforce-dialect-specific and is being deprecated in favor of `subagent`, which is the canonical term in the base dialect. All new scripts should use `subagent`.

---

### 1. `system`

System-level instructions and default messages for the agent. Appears at the top level of the script. Also available as a scoped override inside `subagent` blocks (where only `instructions` is permitted).

#### `instructions`

*Type: string / template*

Global system instructions inherited by all subagents. Supports `{!...}` interpolation. Each subagent inherits these instructions unless it provides its own `system.instructions` override.

```
system:
    instructions: |
        You are a helpful support agent.
        Always verify the customer before accessing account details.
```

#### `messages`

*Type: block — see [`messages`](#2-messages)*

Pre-defined message templates for standard runtime situations.

```
system:
    messages:
        welcome: "Hello! How can I help you today?"
        error: "Sorry, something went wrong. Please try again."
```

---

### 2. `config`

High-level agent configuration. The base dialect provides `description`; dialects may extend this block with additional fields. See the relevant dialect spec for the full list.

---

### 3. `variables`

A variadic block of typed variable declarations. Top-level only — not scoped to individual subagents. Keys are user-defined names; values are typed declarations with optional modifiers and defaults. See [Part I §2.3](#23-variable-declarations).

**Lifetime and scope:** Variables are global across the entire script. Their state persists across turns and across transitions between subagents — a variable set in `subagent.A` is visible in `subagent.B` after a transition.

Variables should include a `description` field. Descriptions are used by the LLM to understand what a variable holds, and are required for slot-filling via `@utils.setVariables` — the LLM uses the description to determine what value from the conversation to assign.

```
variables:
    order_id: mutable string = ""
        description: "The current order ID being discussed"
    verified: mutable boolean = False
        description: "Whether the customer has been identity-verified"
    session_id: linked string
        description: "Session ID provided by the runtime"
```

---

### 4. `start_agent`

The entry-point agent block. Exactly one `start_agent` is required per script — it is the first subagent the runtime activates. Its instance name is used as the agent identifier. Shares all fields with `subagent`. `@start_agent` is an alias for `@subagent`.

```
start_agent topic_selector:
    description: "Welcome user and route to the right subagent"
    reasoning:
        instructions: ->
            | Welcome the user and route their request.
        actions:
            go_to_orders: @utils.transition to @subagent.Order_Management
                description: "Handle order inquiries"
            go_to_returns: @utils.transition to @subagent.Return_Management
                description: "Handle return requests"
```

---

### 5. `subagent`

A named agent block defining logic for a specific conversation area. Multiple subagents may be defined. `start_agent` or other subagents route to them via `transition`.

#### `label`

*Type: string — string literals only, no templates*

Display label shown in the UI. Not provided to the LLM.

#### `description`

*Type: string — required*

Describes this subagent's purpose. Used by the runtime to determine when to transition to this subagent.

#### `system`

*Type: block (instructions only)*

An optional per-subagent override of the system instructions. Only the `instructions` field is available here (not `messages`).

```
system:
    instructions: "Focus on order lookups. Never expose internal record IDs."
```

#### `actions`

*Type: collection of named action blocks*

Action definitions available within this subagent. See [Part I §7](#7-action-definitions).

#### `before_reasoning`

*Type: procedure — templates disallowed*

Runs once per turn, before the LLM reasoning loop starts. May contain `set`, `run`, `transition`, and `if`/`else` logic. Template strings (`|`) are not permitted.

```
before_reasoning:
    if @variables.verified is not True:
        transition to @subagent.Identity
    run @actions.Check_Business_Hours
        set @variables.is_open = @outputs.is_business_hours
```

#### `reasoning`

*Type: block — see [`reasoning`](#9-reasoning)*

The reasoning loop block containing LLM instructions and action bindings.

#### `after_reasoning`

*Type: procedure — templates disallowed*

Runs once per turn, after the LLM reasoning loop completes. Same constraints as `before_reasoning`.

```
after_reasoning:
    if @variables.escalation_required:
        transition to @subagent.Escalation
    set @variables.turn_count = @variables.turn_count + 1
```

**Full example:**

```
subagent Order_Management:
    description: "Handles order lookups and updates"
    system:
        instructions: "Focus on helping the user with their order."
    before_reasoning:
        if @variables.verified is not True:
            transition to @subagent.Identity
    actions:
        Lookup_Order:
            description: "Retrieve order details"
            inputs:
                order_number: string
                    is_required: True
            outputs:
                status: string
                order_id: string
            target: "flow://Lookup_Order"
    reasoning:
        instructions: ->
            | Ask for the order number and call {!@actions.lookup_order}.
            | Never show the record ID: {!@variables.order_id}
        actions:
            lookup_order: @actions.Lookup_Order
                with order_number=...
                set @variables.status = @outputs.status
                set @variables.order_id = @outputs.order_id
            go_to_returns: @utils.transition to @subagent.Returns
                description: "Route when user wants to return items"
    after_reasoning:
        set @variables.request_count = @variables.request_count + 1
```

---

### 6. `before_reasoning`

A procedure block that runs before the reasoning loop on each turn. Valid statements: `set`, `run` (with callbacks), `transition`, `if`/`else`. Template strings (`|`) are not permitted — this block is deterministic and not LLM-driven.

---

### 7. `reasoning`

The reasoning loop block. Drives the LLM's behavior for a given turn.

**Loop termination:** The reasoning loop iterates until the LLM produces a generation (a response to the user) rather than invoking another action. Each iteration the LLM chooses to either call an action or generate a response. When it generates a response, the loop terminates and `after_reasoning` is called.

#### `instructions`

*Type: procedure with string return*

Instructions provided to the LLM. Re-evaluated on every iteration of the reasoning loop, allowing the prompt to reflect the latest variable state. Supports template strings (`|`), `{!...}` interpolation, and conditional logic to build context-sensitive prompts.

```
reasoning:
    instructions: ->
        | Help the user with their order.
        if @variables.verified:
            | The customer is verified. Their order ID is {!@variables.order_id}.
        | Always be concise and professional.
```

#### `actions`

*Type: collection of reasoning action bindings*

Action bindings made available to the LLM during reasoning. Each binding references a declared action and optionally provides `description`, `available when`, `with` clauses, and callbacks.

```
reasoning:
    actions:
        lookup_order: @actions.Lookup_Order
            description: "Look up an order by number"
            available when @variables.order_number != ""
            with order_number=@variables.order_number
            set @variables.status = @outputs.status

        go_to_returns: @utils.transition to @subagent.Returns
            description: "Route to returns when user wants to return items"
            available when @variables.verified is True

        capture_info: @utils.setVariables
            description: "Capture order number from conversation"
            with order_number=...

        escalate: @utils.escalate
            description: "Hand off to a human agent"
```

---

### 8. `after_reasoning`

A procedure block that runs after the reasoning loop on each turn. Same constraints as `before_reasoning` — deterministic, no template strings.

---

### 9. `actions`

A named collection of action definitions. Each action is a `NamedBlock` with a user-defined key. See [Part I §7](#7-action-definitions) for full action definition syntax.

---

### 10. `connected_subagent`

A reference to an externally-deployed agent identified by URI. The URI follows the same scheme pattern as action targets — the scheme is a runtime plugin. See [Part I §7.3](#73-target-uri).

#### `target`

*Type: string — required, string literals only*

URI identifying the connected agent. The scheme determines how the runtime resolves and invokes it (e.g. `"agentforce://Billing_Agent"`).

#### `label`

*Type: string*

Human-readable label for the connected agent.

#### `description`

*Type: string*

Description of the connected agent's capabilities.

```
connected_subagent External_Billing:
    target: "agentforce://Billing_Agent"
    description: "Handles complex billing disputes requiring specialist review"
```

---

### 11. `@utils`

Built-in utility actions injected as a global namespace by the AgentScript dialect. Available as action bindings in `reasoning.actions` or as statements in `before_reasoning`/`after_reasoning`.

#### `transition`

Transitions execution to another subagent. Used with the `to` keyword to specify the target. See [Part I §5.10](#510-transition-statement).

```
go_to_billing: @utils.transition to @subagent.Billing
    description: "Route to billing subagent"
    available when @variables.verified is True
```

#### `setVariables`

Sets one or more agent variables from the current conversation context. The LLM determines the values based on the conversation and the `description` of each variable. Inputs use `...` to indicate LLM-filled values.

```
capture_info: @utils.setVariables
    description: "Capture customer name and email from the conversation"
    with customer_name=...
    with customer_email=...
```

The descriptions on the target variables (declared in `variables:`) are used by the LLM to understand what to extract from the conversation.

#### `escalate`

Hands off the conversation to a human agent. Takes no inputs.

```
escalate: @utils.escalate
    description: "Hand off to a live agent when the user requests it"
```

---

### 12. `@system_variables`

Runtime-provided read-only variables injected as a global namespace. Available via `@system_variables.member`.

#### `user_input`

The raw text input from the user for the current turn.

```
if @system_variables.user_input is not None:
    run @actions.Log_Input
        with text=@system_variables.user_input
```
