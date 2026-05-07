# Agent Script

<!-- Badges go here once repo is public -->

Agent Script is an open agent specification language, allowing you to configure agents
with a common set of building blocks that harmonize both nondeterministic and deterministic control flow. It was first developed for Agentforce agents, but is meant to extend to all kinds of agents in general.

## Overview

This repository contains libraries used for the following:

1. Parsing + linting agentscript (base, agentforce, agentfabric dialects)
2. Compiling agentforce dialect
3. UIs + LSP tooling for agentscript

We provide this repository for developers to peruse/contribute, agents to peruse/contribute, agent builders to gain a deeper understanding of how agent script works.

For a formal language specification, see [SPEC.md](SPEC.md).

### Why Agent Script

Agent Script allows you to define an agent as a single file with custom syntax for storing state,
specifying execution flow, string templating, and defining deterministic hooks for agent control.

At Salesforce, Agent Script integrates with the Agent Builder, as well as a variety of developer tools that enable management of the agent development lifecycle (ADLC).

### Determinism versus Autonomy

Agent Script does not prescribe how much control you take. The language gives you the tools — how you use them is up to you.

At one end, you can write highly deterministic agents: use `before_reasoning` to gate transitions, `if`/`else` to focus the LLM's instructions, and `set` to drive state explicitly. At the other end, you can write a single `reasoning.instructions` block and let the LLM reason freely. Most agents sit somewhere in between.

The key design principle is that execution is decoupled from specification. Agent Script describes *what* the agent is — its state, its available actions, its instructions — not *how* the runtime executes it. This means the same script can run on increasingly capable runtimes without changing a line of code. You're specifying the agent, not implementing it.

In this sense Agent Script follows the same pattern as other industry-standard declarative approaches: hooks, lifecycle events, data + procedures. More procedures means more determinism. Fewer procedures means more autonomy. The language doesn't take sides.

## Quick Start

### Prerequisites

Node.js >= 20 and pnpm >= 8

### Installation

```bash
git clone https://github.com/salesforce/agentscript.git
cd agentscript
pnpm install
pnpm build
```

### Run the UI

```bash
pnpm ui:dev
```

Opens the AgentScript playground at `http://localhost:27002`.

### Use as a Library

```bash
pnpm add @agentscript/agentforce
```

```typescript
import { parse } from '@agentscript/agentforce';

const doc = parse(`
system:
    instructions: "You are a helpful agent."

topic billing:
    description: "Handle billing inquiries"
`);

console.log(doc.hasErrors);   // false
console.log(doc.diagnostics); // []
console.log(doc.emit());      // formatted source
```

## Syntax/Structure Overview

Agent Script is block-based. Everything is a block, and blocks compose to form an agent.

Blocks fall into two categories: **configuration** (`config`, `system`) which set up the agent's identity and behavior, and **execution** (`topic`, `start_agent`) which define how the agent runs. The language is indentation-sensitive — like Python or YAML, indentation determines scope. Execution blocks have _implied_ execution -- i.e. determined by the runtime, meaning the simple ReAct loop is implemented behind the scenes and not within the script itself.

**Keys and values** follow a simple pattern: keys are unquoted, values are introduced by `:`. Values can be any of the standard scalar types (string, number, boolean), a list, or a nested block. Together they form a full dictionary structure:

```
config:
    agent_name: "Support Bot"
    default_locale: "en_US"

variables:
    case_id: mutable string = ""
        description: "The current support case ID"
    is_verified: mutable boolean = False
```

**Templates** use `|` for multiline strings:

```
system:
    instructions: |
        You are a helpful support agent.
        Always verify the customer before discussing account details.
```

**Procedures** represent executable logic attached to a block. They can be explicitly introduced with `->`, but the parser auto-detects procedure context from the schema — so `->` is often optional. Parameters are currently implicit — derived from context rather than declared explicitly. Within a procedure that returns a string, `|` appends to the output:

```
reasoning:
    instructions: ->
        | Greet the user and ask for their case ID.
        if @variables.is_verified:
            | You may discuss account details.
        | Always be concise and professional.
```

**Expressions** follow Python-like syntax with a fixed set of builtins. **Namespace lookups** use `@` — `@variables.case_id`, `@actions.lookup_case`, `@subagent.billing`.

**Special procedural syntax** within execution blocks:

- `set` — assigns a variable
- `run` — invokes an action
- `with` — assigns input parameters to an action
- any block following a `with` clause denotes a **callback** — code that runs after the action returns

```
before_reasoning:
    run @actions.verify_customer
        with email=@variables.user_email
        set @variables.is_verified = @outputs.verified
        set @variables.case_id = @outputs.case_id

after_reasoning:
    if not @variables.is_verified:
        transition to @subagent.identity_verification
```

Each block has a **schema** defined by its dialect. A **dialect** is a collection of block types and their schemas — it defines what blocks are valid, what fields they accept, and what types those fields can be.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  UI Playground                                                       │
│  Monaco editor · graph view · builder                               │
├─────────────────────────────────────────────────────────────────────┤
│  Editor Integrations                                                 │
│  vscode · monaco                                                     │
├─────────────────────────────────────────────────────────────────────┤
│  LSP Layer                                                           │
│  lsp (core) · lsp-server (Node.js) · lsp-browser (Worker)           │
├─────────────────────────────────────────────────────────────────────┤
│  Lint Passes                                                         │
│  DAG of passes registered per-dialect                               │
├─────────────────────────────────────────────────────────────────────┤
│  Compiler                                                            │
│  AST → Salesforce runtime specification                             │
├─────────────────────────────────────────────────────────────────────┤
│  Dialect Layer                                                       │
│  agentscript (base) · agentforce · agentfabric                      │
│  each extends the base schema with blocks, fields, and lint rules   │
├─────────────────────────────────────────────────────────────────────┤
│  Schema                                                              │
│  TypeScript-defined block/field schema — base + dialect extensions  │
├─────────────────────────────────────────────────────────────────────┤
│  Parsers                                                             │
│  parser-javascript  (TypeScript, error-tolerant, CST output)        │
│  parser-tree-sitter (C/WASM, declarative, source-of-truth grammar)  │
└─────────────────────────────────────────────────────────────────────┘
```

## Repository Overview

### Foundation Layer

| Package | Description |
| --- | --- |
| [`@agentscript/types`](packages/types/) | Shared types (`SyntaxNode`, `Diagnostic`, `Range`, etc.) used across all packages. Zero dependencies. |
| [`@agentscript/parser-tree-sitter`](packages/parser-tree-sitter/) | Tree-sitter grammar and C parser. Generates Node.js native bindings and WASM for browser use. Zero internal dependencies. Must rebuild after grammar changes. |
| [`@agentscript/parser-javascript`](packages/parser-javascript/) | Hand-written TypeScript parser. Error-tolerant recursive descent with Pratt expression parsing and CST output. Pure JS — no native dependencies. |
| [`@agentscript/parser`](packages/parser/) | Parser abstraction layer. Resolves to `parser-javascript` by default; swap to `parser-tree-sitter` via conditional exports. |

### Core Layer

| Package | Description |
| --- | --- |
| [`@agentscript/language`](packages/language/) | Language infrastructure and analysis engine. Provides AST types, scope/symbol resolution, linting framework (18+ passes), and the Language Service API. |

### Dialect Layer

| Package | Description |
| --- | --- |
| [`@agentscript/agentscript-dialect`](dialect/agentscript/) | Base dialect — core language schema and lint rules. |
| [`@agentscript/agentforce-dialect`](dialect/agentforce/) | Extends AgentScript with Salesforce Agentforce-specific blocks, fields, and compilation. |
| [`@agentscript/agentfabric-dialect`](dialect/agentfabric/) | AgentFabric dialect — alternative schema, lint rules, and compiler. |

### Compiler

| Package | Description |
| --- | --- |
| [`@agentscript/compiler`](packages/compiler/) | Transforms parsed AgentScript AST into a Salesforce runtime specification with source-map support. |

### SDK

| Package | Description |
| --- | --- |
| [`@agentscript/agentforce`](packages/agentforce/) | Batteries-included SDK. Combines parser, language, compiler, and dialects into a single import. Provides `parse()`, `Document` (with mutation/undo/redo), `parseComponent()`, `emitComponent()`, and `compileSource()`. Works in Node.js and browsers. |

### LSP Layer

| Package | Description |
| --- | --- |
| [`@agentscript/lsp`](packages/lsp/) | Dialect-agnostic LSP core. All providers (diagnostics, hover, completions, definition, references, rename, symbols, code actions, semantic tokens) live here. Parser and dialects are injected via config. |
| [`@agentscript/lsp-server`](packages/lsp-server/) | Node.js LSP server. Thin stdio/IPC wrapper over `@agentscript/lsp`. Ships the `agentscript-lsp` CLI. |
| [`@agentscript/lsp-browser`](packages/lsp-browser/) | Browser LSP server. Runs in a Web Worker with the TypeScript parser. Single-bundle output. |

### Editor Integrations

| Package | Description |
| --- | --- |
| [`@agentscript/vscode`](packages/vscode/) | VS Code extension — syntax highlighting, diagnostics, completions, go-to-definition, rename, and more for `.agent` files. |
| [`@agentscript/monaco`](packages/monaco/) | Monaco Editor integration — language registration, syntax highlighting, hover, and schema resolution. |

### UI Playground

A browser-based playground for working with Agent Script, backed by the full LSP. Includes:

- **Monaco editor** — same editing experience as VS Code: diagnostics, completions, hover
- **Graph view** — visualize the agent's topic/subagent flow as a node graph
- **CST/AST explorer** — inspect the parse tree and compiled output in real time
- **Multiple dialects** — switch between agentscript, agentforce, and agentfabric
- **Example scripts** — preloaded examples to get started quickly

Run locally with `pnpm ui:dev`. Contributions welcome.

## Development

```bash
pnpm build          # build all packages (via Turbo)
pnpm test           # run all tests
pnpm lint           # lint all packages
pnpm typecheck      # type-check all packages
pnpm format         # format with Prettier
pnpm dev            # watch mode for all packages
pnpm docs:dev       # run the docs site locally
pnpm ui:dev         # run the UI playground locally
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution checklist and how to submit a pull request. You'll need to sign the [Salesforce CLA](https://cla.salesforce.com/sign-cla) before your PR can be merged.

## Questions

Open a [GitHub issue](https://github.com/salesforce/agentscript/issues/new) for bugs, features, or questions.

## Open Source Approach & Limitations

We're open sourcing the Agent Script specification, toolchain, and developer tools — the parser, linter, compiler, LSP, editor integrations, and UI. These are genuinely open and we welcome contributions to all of them.

What we're not open sourcing (yet) is the runtime. Agent Script compiles to a Salesforce-internal specification format that executes on Salesforce infrastructure. That means you can parse, lint, compile, and build tooling around Agent Script, but running agents requires Salesforce's runtime environment.

As a result, we're not accepting changes to the language spec for now. The spec needs to stay in sync with the runtime, and until we have a path to open sourcing the runtime, unilateral spec changes would create a split we can't support.

What's genuinely open:
- the parser, linter, LSP, and all developer tooling
- bug fixes across any of the above
- editor integrations (VS Code, Monaco)
- the UI playground
- documentation and the formal spec

We want to be straightforward about this tradeoff. More will open up over time.

## License

Apache 2.0 — see [LICENSE.txt](LICENSE.txt) for the full text.
