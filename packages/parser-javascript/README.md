# @agentscript/parser-javascript

Hand-written TypeScript parser for the AgentScript language. Error-tolerant recursive descent parser with an indentation-aware lexer, Pratt expression parsing, and full CST (Concrete Syntax Tree) output.

## Features

- Zero runtime dependencies
- Error-tolerant: never crashes, always produces a CST
- NEWLINE and DEDENT tokens act as unconditional recovery points
- Implements the `SyntaxNode` interface consumed by dialect, LSP, monaco, and agentforce packages
- Syntax highlighting via CST walk (no tree-sitter query engine needed)

## Usage

```typescript
import { parse, parseAndHighlight } from '@agentscript/parser-javascript';

// Parse source code into a CST
const { rootNode } = parse(source);

// Parse and get syntax highlighting captures in one call
const captures = parseAndHighlight(source);
```

## API

| Export | Description |
|---|---|
| `parse(source)` | Parse source and return `{ rootNode: CSTNode }` |
| `parseAndHighlight(source)` | Parse and return `HighlightCapture[]` |
| `highlight(node)` | Walk an existing CST and produce highlight captures |
| `CSTNode` | CST node class implementing `SyntaxNode` |
| `TokenKind` | Enum of all token types |

## Scripts

```bash
pnpm build        # Compile TypeScript
pnpm test         # Run test suite (vitest)
pnpm test:watch   # Run tests in watch mode
pnpm bench        # Run vitest benchmarks
pnpm perf         # Run detailed performance analysis with timing output
pnpm perf:report  # Generate PERFORMANCE.md report
```

## Testing

Tests are located in `test/` and use vitest:

- **corpus.test.ts** — Parses tree-sitter corpus files and compares s-expression output
- **parity.test.ts** — Compares parser-javascript and tree-sitter on corpus inputs
- **fuzz.test.ts** — Random mutations of corpus inputs, checks parser-javascript invariants
- **fuzz-parity.test.ts** — Random mutations checked against both parsers simultaneously
- **error-recovery.test.ts** — CST coverage metrics for error recovery scenarios
- **robustness.test.ts** — 100+ edge cases verifying error recovery (unclosed delimiters, malformed syntax, garbage input)
- **single-quote.test.ts** — Verifies single quotes produce errors (parity with tree-sitter)

### Parity invariant

When an input parses without errors in **either** parser, it must parse without errors in
**both** parsers, and the resulting parse trees must be identical (normalized s-expressions).

Parse trees are allowed to deviate when the input is **not valid AgentScript** — both parsers
will have errors, but their error recovery strategies differ (recursive descent vs GLR), so
the resulting CSTs may differ. These deviations are tracked via snapshots.

## Performance Benchmarks

The package includes a comprehensive benchmark suite that stress-tests the parser across multiple dimensions.

See [PERFORMANCE.md](PERFORMANCE.md) for the latest benchmark results. Run `pnpm perf:report` to regenerate after changes.

### Running Benchmarks

```bash
# Detailed timing output (recommended)
pnpm perf

# Generate PERFORMANCE.md report (commit alongside code changes)
pnpm perf:report

# Vitest bench format (for CI)
pnpm bench
```

### Benchmark Dimensions

| Dimension | What it tests |
|---|---|
| File size scaling | Linear scaling: 100 to 100K lines of flat mappings |
| Deep nesting | Indent stack and recursion depth: 50 to 1,000 levels |
| Wide mappings | Sibling key accumulation: 1K to 50K keys |
| Chained expressions | Pratt parser with long `a + b + c...` chains |
| Nested parentheses | Recursive descent depth with `(((...)))` |
| Mixed precedence | Precedence climbing with interleaved `+ * - /` |
| Large strings | Lexer string scanning: 1KB to 1MB strings |
| Escape-heavy strings | Character-by-character escape processing |
| Template interpolations | `{! expr }` handling at scale |
| Error recovery | Alternating errors, garbage input, unclosed delimiters |
| Large sequences | `- item` syntax at 1K to 50K items |
| Procedure-heavy | `if`/`run`/`set` statement parsing |
| Highlighting overhead | `parse()` vs `parseAndHighlight()` comparison |
| Realistic workloads | Mixed agent files from 50 to 50K lines |
| Lexer isolation | Lex-only runs to separate lexer vs parser cost |

### Adding Generators

Input generators live in `test/perf-generators.ts`. Each function returns a string of synthetic AgentScript. To add a new stress dimension:

1. Add a generator function to `perf-generators.ts`
2. Add benchmark calls in both `perf.bench.ts` (vitest) and `run-perf.ts` (direct runner)

## Architecture

```
src/
  index.ts          — Public API (parse, parseAndHighlight)
  lexer.ts          — Indentation-aware tokenizer (INDENT/DEDENT/NEWLINE)
  parser.ts         — Recursive descent parser + statement parsing
  expressions.ts    — Pratt expression parser with precedence climbing
  cst-node.ts       — CST node class with SyntaxNode interface
  highlighter.ts    — CST walk for syntax highlighting captures
  errors.ts         — Error recovery utilities (synchronize, makeErrorNode)
  token.ts          — Token and TokenKind definitions
```
