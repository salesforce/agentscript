# Type Embedding System

This documentation site uses a hybrid approach that combines:
- **Auto-generated API reference** from TypeDoc
- **Manual guides and tutorials** with embedded type definitions from source code

## How It Works

### 1. Type Extraction

The `extract-types.ts` script extracts TypeScript type definitions from source files:

```bash
npm run extract-types
```

This creates `src/data/extracted-types.json` containing all exported types, interfaces, enums, and classes.

### 2. TypeDefinition Component

The `<TypeDefinition>` component displays extracted types in your MDX documentation:

```mdx
import TypeDefinition from '@site/src/components/TypeDefinition';

<TypeDefinition name="LinterRule" />
```

### 3. Automatic Extraction

Types are automatically extracted before each build via the `prebuild` script in `package.json`.

## Usage in Documentation

### Basic Usage

```mdx
---
title: My Documentation Page
---

import TypeDefinition from '@site/src/components/TypeDefinition';

# My Page

Here's the LinterRule interface:

<TypeDefinition name="LinterRule" />
```

### Hide Source File Path

```mdx
<TypeDefinition name="LinterRule" showSource={false} />
```

### Change Language Highlighting

```mdx
<TypeDefinition name="LinterRule" language="typescript" />
```

## Adding More Files to Extract

Edit `extract-types.ts` and add files to the `filesToExtract` array:

```typescript
const filesToExtract = [
  'packages/language/src/types.ts',
  'packages/language/src/linter/types.ts',
  'packages/your-new-file.ts',  // Add here
];
```

## Benefits

1. **Single Source of Truth**: Type definitions come directly from source code
2. **Always Up-to-Date**: Extracted at build time, never stale
3. **Flexible**: Combine auto-generated types with manual explanations
4. **Maintainable**: Changes to types automatically appear in docs
5. **No Runtime Overhead**: Extraction happens at build time, not runtime

## Workflow

### For Documentation Writers

1. Write your guide in MDX
2. Use `<TypeDefinition name="TypeName" />` to embed types
3. Add examples and explanations around the embedded types
4. Build the docs - types are automatically extracted

### For Developers

1. Update type definitions in source code
2. Add JSDoc comments for better documentation
3. Export types you want to be available in docs
4. Types automatically appear in documentation on next build

## Example

See `docs/type-embedding-example.mdx` for a complete example.

## Troubleshooting

### Type Not Found

If you get "Type definition not found", check:
1. Is the type exported?
2. Is the file in the `filesToExtract` array?
3. Run `npm run extract-types` manually to see what's extracted

### Type Not Updating

1. Delete `src/data/extracted-types.json`
2. Run `npm run extract-types`
3. Rebuild the docs

## Future Enhancements

Potential improvements:
- Extract function signatures
- Extract JSDoc comments with the types
- Support for extracting specific methods from classes
- Link to source code on GitHub
- Show type dependencies/relationships
