---
sidebar_position: 2
---

# Installation

There are two ways to set up the AgentScript development environment: using a DevContainer (recommended) or installing locally.

## DevContainer Setup (Recommended)

The repository ships with a DevContainer configuration that provides a fully configured environment with all dependencies pre-installed.

**Prerequisites:**

- Docker Desktop or Docker Engine
- VS Code with the [Dev Containers](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers) extension

**Steps:**

1. Clone the repository:
   ```bash
   git clone <repo-url>
   cd agentscript
   ```

2. Open the folder in VS Code:
   ```bash
   code .
   ```

3. When prompted, click **Reopen in Container** (or run the `Dev Containers: Reopen in Container` command from the Command Palette).

4. Wait for the container to build. Dependencies are installed automatically by the post-create script.

## Local Setup

### Prerequisites

- **Node.js** >= 18.0.0
- **pnpm** >= 8.0.0
- **tree-sitter CLI** (optional, only needed for parser grammar development)

### Steps

1. Clone the repository:
   ```bash
   git clone <repo-url>
   cd agentscript
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Build all packages:
   ```bash
   pnpm build
   ```

4. Run the test suite:
   ```bash
   pnpm test
   ```

### Node Version for CI Parity

Some tests (notably the compiler parity tests) may require Node 18.20.8 to match CI behavior. If you encounter test failures on a newer Node version, pin to the CI version:

```bash
volta pin node@18.20.8
# or
nvm use 18.20.8
```

## Build Commands

| Command         | Description                          |
| --------------- | ------------------------------------ |
| `pnpm build`    | Build all packages (uses Turborepo)  |
| `pnpm test`     | Run all tests                        |
| `pnpm format`   | Format code with Prettier            |
| `pnpm lint`     | Run ESLint                           |
| `pnpm docs:dev` | Start docs dev server (port 27000)   |

## Important Notes

- **Always use pnpm.** Never use npm or yarn. The monorepo relies on pnpm workspaces and the `workspace:*` protocol for internal dependencies.
- **Parser changes require a full rebuild** including WASM:

  ```bash
  cd packages/parser-tree-sitter && pnpm run build
  ```

  This regenerates the grammar, builds native Node.js bindings, and compiles the WASM bundle.
- **Dialect changes require a rebuild** of the affected dialect package:

  ```bash
  pnpm build --filter @agentscript/agentscript-dialect
  ```

- **Pre-commit hooks** are configured via Husky and lint-staged. They run automatically on staged files when you commit.

## Next Steps

- [Quickstart](/getting-started/quickstart) -- Build the project and explore the structure.
- [Architecture](/architecture/overview) -- Understand how the parser, dialects, and lint engine work together.
