---
sidebar_position: 5
---

# CLI Reference

The CLI binary is called `agentforce`. It provides commands for authoring, linting, compiling, and simulating agents, as well as querying Salesforce orgs and managing projects.

## Default (no subcommand)

```bash
agentforce
```

Launches the interactive terminal UI.

## `auth`

```bash
agentforce auth [options]
```

Authenticate with a Salesforce org using OAuth 2.0 PKCE flow.

| Option | Description |
|---|---|
| `--login-url <url>` | Salesforce login URL (default: `https://login.salesforce.com`). Use `https://test.salesforce.com` for sandboxes. |
| `--port <port>` | Local callback server port (default: `1717`) |
| `--alias <name>` | Alias for this org connection |
| `--set-default` | Set as default org (default: `true`) |

Credentials are stored in `~/.agentforce/auth.json`.

## `scaffold`

```bash
agentforce scaffold [options]
```

Generate a new agent project.

| Option | Description |
|---|---|
| `-n, --name <name>` | Agent name (required) |
| `-d, --description <desc>` | Agent description |
| `-o, --output <dir>` | Output directory (default: `./<agent-name>`) |
| `--with-tools` | Include example tool definitions |

## `lint`

```bash
agentforce lint [options]
```

Lint `.agent` files for errors and warnings.

| Option | Description |
|---|---|
| `--file, -f <path>` | Path to `.agent` file or directory (required) |
| `--format <format>` | File format (must be `"agent"` if specified) |

Prints color-coded diagnostics. Exits with code 1 if errors are found.

## `compile`

```bash
agentforce compile [options]
```

Compile `.agent` files to Salesforce runtime specification.

| Option | Description |
|---|---|
| `--file, -f <path>` | Path to `.agent` file or directory (required) |
| `--format <format>` | Output format: `json` (default) or `yaml` |
| `-o, --output <path>` | Output file path (prints to stdout if omitted) |

## `simulate`

```bash
agentforce simulate <subcommand> [options]
```

Run agent simulations against a Salesforce org.

### `simulate start`

Start a new simulation session.

| Option | Description |
|---|---|
| `--file, -f <path>` | Path to `.agent` file (required) |
| `--org <alias>` | Salesforce org alias |

Output: JSON `{ sessionId, compiledHash }`

### `simulate send`

Send a message to an active session.

| Option | Description |
|---|---|
| `--session <id>` | Session ID from `start` (required) |
| `-m, --message <text>` | Message to send (required) |
| `--org <alias>` | Salesforce org alias |

Output: JSON with agent response, processing details, and traces.

### `simulate end`

End a simulation session.

| Option | Description |
|---|---|
| `--session <id>` | Session ID (required) |
| `--org <alias>` | Salesforce org alias |

### `simulate history`

View session history.

| Option | Description |
|---|---|
| `--session <id>` | Session ID (omit to list all sessions) |
| `--org <alias>` | Salesforce org alias |

## `tools`

```bash
agentforce tools [pattern] [options]
```

Search available Salesforce Flows and Apex actions.

| Option | Description |
|---|---|
| `<pattern>` | Regex pattern to filter tools (case-insensitive). Searches names, descriptions, URIs, and parameter names. |
| `--org <alias>` | Salesforce org alias |
| `--type <type>` | Filter by type: `"flow"` or `"apex"` |
| `--details` | Show full parameter definitions |
| `--limit <num>` | Results per page (default: 20) |
| `--offset <num>` | Pagination offset (default: 0) |

Example:

```bash
agentforce tools "Get.*Lead" --type flow --details
```

## `query`

```bash
agentforce query "<SOQL>" [options]
```

Execute a read-only SOQL query against a Salesforce org. Only SELECT statements are allowed -- DML statements (INSERT, UPDATE, DELETE, UPSERT) are rejected.

| Option | Description |
|---|---|
| `<soql>` | SOQL SELECT query (required) |
| `--org <alias>` | Salesforce org alias |
| `--tooling` | Use Tooling API instead of standard REST API |

Example:

```bash
agentforce query "SELECT Id, Name FROM Account LIMIT 10"
```

## `schema`

```bash
agentforce schema [options]
```

Print the full dialect schema.

| Option | Description |
|---|---|
| `--json` | Output raw JSON (default: human-readable syntax guide) |
| `--dialect <name>` | Dialect to display |

## `update`

```bash
agentforce update [options]
```

Update managed CLI files in a scaffolded project to the latest version.

| Option | Description |
|---|---|
| `--dir <path>` | Project directory (searches from cwd if omitted) |
| `--dry-run` | Preview changes without writing |
| `--force` | Overwrite user-modified files |

File status indicators:

- `✓` up-to-date
- `↑` updated
- `+` new file
- `✗` skipped (user-modified)
- `!` overwritten (with `--force`)

## Global Options

These options are available across all commands:

| Option | Description |
|---|---|
| `-h, --help` | Show help message |
| `-v, --version` | Show version number |
| `--org <alias>` | Salesforce org alias (used by commands that interact with Salesforce) |
| `--dialect <name>` | Dialect to use |
