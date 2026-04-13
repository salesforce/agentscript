# Documentation Code Block Validation

This system ensures that TypeScript code blocks in our documentation remain valid and don't become outdated.

## How It Works

The `validate-code-blocks.ts` script:

1. **Extracts** all TypeScript code blocks from markdown files in `docs/`
2. **Compiles** each code block using the TypeScript compiler
3. **Reports** any syntax errors or type errors found
4. **Runs automatically** before building documentation

## Usage

### Manual Validation

Run validation manually:

```bash
pnpm --filter @agentscript/docs validate-code-blocks
```

### Automatic Validation

Validation runs automatically:

- **Before build**: `pnpm build` includes validation in the `prebuild` script
- **In CI/CD**: GitHub Actions runs validation on every PR and push

### What Gets Validated

The script validates:

- ✅ Complete TypeScript code blocks with `typescript` or `ts` language tags
- ✅ Syntax correctness
- ✅ Type correctness (with common SDK imports)
- ⚠️ Code fragments with `// ...` are checked for syntax only

### Common Imports

The validator automatically includes common imports from `@agentscript/agentforce`:

- `LinterRule`, `DiagnosticSeverity`, `createDiagnostic`, `getNodeRange`
- `BaseNode`, `DecoratedNode`, `ValidationContext`
- `ASTVisitor`, `SymbolTableVisitor`, `ActionRegistryVisitor`
- `TaskRunner`, `BaseDialect`, schema definition functions
- And more...

## Handling Validation Issues

### 1. Fix the Code Block

If the code is incorrect, update it in the markdown file:

```typescript
// Before (incorrect)
const rule: LinterRule = {
  name: 'my-rule',
  validate(node) {  // ❌ Missing context parameter
    // ...
  }
};

// After (correct)
const rule: LinterRule = {
  name: 'my-rule',
  validate(node, context) {  // ✅ Both parameters
    // ...
  }
};
```

### 2. Mark as Fragment

For intentional code fragments or pseudocode, add a comment to indicate it's incomplete:

```typescript
// This is a fragment showing the concept
const result = someFunction();
// ... rest of implementation
```

The validator will skip full type checking for fragments containing `// ...` or `/* ... */`.

### 3. Add Mock Implementations

If your example references functions that don't exist in the SDK, add them to the `MOCK_IMPLEMENTATIONS` section in `validate-code-blocks.ts`.

## Best Practices

### ✅ DO

- **Use complete, working examples** when possible
- **Test code blocks** before adding them to docs
- **Keep examples simple** and focused on one concept
- **Use real SDK APIs** from `@agentscript/agentforce`

### ❌ DON'T

- **Don't use made-up APIs** that don't exist in the SDK
- **Don't leave syntax errors** in code blocks
- **Don't skip validation** - it catches real issues!

## Example: Valid Code Block

```typescript
import {
  LinterRule,
  DiagnosticSeverity,
  createDiagnostic,
  getNodeRange
} from '@agentscript/agentforce';

export const noEmptyBlocks: LinterRule = {
  name: 'no-empty-blocks',
  description: 'Blocks must not be empty',
  severity: DiagnosticSeverity.Warning,
  selector: ['block', 'actions_block'],

  validate(node, context) {
    if (!node.children || node.children.length === 0) {
      return [
        createDiagnostic(
          'Empty blocks are not allowed',
          getNodeRange(node),
          DiagnosticSeverity.Warning
        )
      ];
    }
    return undefined;
  }
};
```

This code block will:
- ✅ Pass syntax validation
- ✅ Pass type checking
- ✅ Use real SDK APIs
- ✅ Be a complete, working example

## Troubleshooting

### "Cannot find module '@agentscript/agentforce'"

This is expected during validation - the script mocks the SDK imports. If you see this error when running the docs site, ensure dependencies are installed:

```bash
pnpm install
```

### "Syntax error in code block"

Check the markdown file at the reported line number. Common issues:
- Missing closing braces `}`
- Unclosed strings or template literals
- Invalid TypeScript syntax

### "Type error in code block"

The code compiles but has type issues. Check:
- Parameter types match the SDK interfaces
- Return types are correct
- Imported types are used correctly

## Future Enhancements

Possible improvements:

1. **Import from test files**: Use a remark plugin to import code directly from test suite
2. **Auto-fix**: Automatically fix common issues like missing imports
3. **Snippet library**: Maintain a library of validated, reusable code snippets
4. **Visual indicators**: Add badges to docs showing "validated" code blocks

## Related Files

- `validate-code-blocks.ts` - The validation script
- `package.json` - Contains the `validate-code-blocks` script
- `.github/workflows/ci.yml` - CI pipeline that runs validation
- `docs/**/*.md` - Documentation files with code blocks
