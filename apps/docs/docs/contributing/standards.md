---
sidebar_position: 3
---

# Coding Standards

## TypeScript

- Never use `any` type -- use proper types, generics, `unknown`, or type assertions through `unknown`
- Strict mode enabled across all packages
- Prefer `interface` over `type` for object shapes
- Explicit return types on exported functions
- Use `const` by default, never `var`

## Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Files | `kebab-case.ts` | `graph-layout.ts` |
| Classes | `PascalCase` | `BlockFactory` |
| Functions/methods | `camelCase` | `parseBlock()` |
| Constants | `UPPER_SNAKE_CASE` | `MAX_RETRIES` |
| Interfaces | `PascalCase` (no `I` prefix) | `NodeConfig` |
| Type parameters | Single uppercase letter | `T`, `K`, `V` |
| Lint pass IDs | `'category/rule-name'` pattern | `'types/no-any'` |
| Package names | `@agentscript/package-name` | `@agentscript/compiler` |

## Testing

- Write tests for new functionality
- Run tests with `pnpm test` from root or specific package
- Aim for thorough coverage of new code
- Test files: `*.test.ts` or `*.spec.ts`
- Framework: Vitest

## Git Workflow

- Conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`
- Branch naming: `feature/`, `fix/`, `docs/`, `refactor/`
- Pre-commit hooks run ESLint + Prettier automatically
- Keep commits atomic and well-described
- Run `pnpm format` before committing

## Code Quality

- Prioritize simplicity and maintainability
- Don't over-engineer with unnecessary abstractions
- Use Turborepo for build orchestration
- Internal dependencies use `workspace:*` protocol

## Documentation

- Update relevant docs when changing functionality
- API documentation is auto-generated via TypeDoc
- Do not manually edit files in `docs/api/`
- Do not create summary/aggregation documentation files
- Keep README files up to date
