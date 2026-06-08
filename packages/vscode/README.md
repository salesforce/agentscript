# Agent Script Language Server for VS Code

This extension provides Agent Script language support in VS Code through the Agent Script Language Server.

## Overview

Agent Script is a high-level declarative programming language for representing Salesforce agents. It allows you to define conversational agents, their reasoning capabilities, actions, and transitions between topics using a clean, YAML-like syntax. This extension brings Agent Script language support to VS Code, including syntax highlighting, real-time diagnostics, and code navigation.

Agent Script files use the `.agent` extension and are compiled to an underlying specification (AgentGraph) that the Salesforce reasoning engine executes.

## Features

- **Syntax Highlighting** — Full Agent Script syntax highlighting from semantic tokens
- **Diagnostics** — parse errors, lint warnings, and compile errors
- **Hover** — type information and documentation
- **Completions** — field and namespace completions
- **Go to Definition**
- **Find References**
- **Rename**
- **Document & Workspace Symbols** - Easy code navigation from outline view
- **Code Actions** — quick fixes with suggestions

## Installation

The Agent Script extension is installed automatically when you install the Agentforce DX extension, which contains tools for authoring, previewing, and testing the agents you build using Agent Script. But you can also install this extension separately from the VS Code Marketplace.

Open a workspace that contains an Agent Script file (`.agent`). The language server automatically starts when you open an Agent Script file.

## Get Started with Agent Script

See the [Agent Script documentation](https://developer.salesforce.com/docs/ai/agentforce/guide/agent-script.html) for examples and how to get started.

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `agentscript.dialect` | `agentforce` | Default dialect when no `# @dialect:` annotation is present. Options: `agentforce`, `agentscript` |
| `agentscript.trace.server` | `off` | Traces communication between VS Code and the language server. Options: `off`, `messages`, `verbose` |

### Selecting a Dialect

You can set the default dialect in VS Code settings, or override per-file with a comment in the first 10 lines:

```
# @dialect: agentforce=2.2
```

### File Organization

Agent Script files are typically organized in Salesforce DX projects as part of an `AiAuthoringBundle` metadata component in a package directory. Each `.agent` file represents a complete agent definition.


## Additional Resources

- [Agent Script Documentation](https://developer.salesforce.com/docs/einstein/genai/guide/agent-script.html)
- [Examples](https://developer.salesforce.com/docs/einstein/genai/guide/ascript-example.html)
- [Agentforce DX Documentation](https://developer.salesforce.com/docs/einstein/genai/guide/agent-dx.html)
- [Agent Script Recipes](https://github.com/trailheadapps/agent-script-recipes)
- [Agent Script Recipes Documentation](https://developer.salesforce.com/sample-apps/agent-script-recipes)
