# AgentScript Documentation

**An open source project owned and sponsored by Salesforce.**

This directory contains the AgentScript documentation site built with [Docusaurus 3](https://docusaurus.io/).

## Features

- **Auto-generated API Documentation** - TypeDoc integration generates API docs from TypeScript packages
- **Manual Documentation** - Hand-written guides and tutorials
- **Search** - Full-text search across all documentation
- **Dark Mode** - Automatic dark mode support
- **Mobile Responsive** - Works on all devices

## Development

### Prerequisites

- Node.js >= 18.0.0
- pnpm >= 8.0.0

### Local Development

From the repository root:

```bash
# Start the docs dev server
pnpm docs:dev
```

Or from this directory:

```bash
# Install dependencies (if not already done from root)
pnpm install

# Start dev server with auto-reload
pnpm dev

# Or start without auto-reload (faster startup)
pnpm dev:simple
```

The `dev` command uses `nodemon` to watch for changes in:
- `generate-sidebar.ts` - Sidebar generation logic
- `sidebars.ts` - Sidebar configuration
- Package metadata in `dialects/` and `packages/`

When these files change, the dev server automatically restarts to pick up the changes.

This starts a local development server at `http://localhost:27000` with hot reload.

### Building

From the repository root:

```bash
# Build the static site
pnpm docs:build

# Serve the built site locally
pnpm docs:serve
```

Or from this directory:

```bash
# Build
pnpm build

# Serve
pnpm serve
```

The static files are generated in the `build/` directory.

## Structure

```
apps/docs/
├── docs/                      # Documentation content
│   ├── intro.md              # Landing page
│   ├── getting-started/      # Getting started guides
│   ├── architecture/         # Architecture docs
│   ├── contributing/         # Contributing guides
│   └── api/                  # Auto-generated API docs (created by TypeDoc)
├── src/
│   ├── css/
│   │   └── custom.css        # Custom styles
│   └── pages/
│       └── index.tsx         # Homepage
├── static/                    # Static assets (images, etc.)
├── docusaurus.config.ts      # Docusaurus configuration
├── sidebars.ts               # Sidebar navigation (uses generate-sidebar.ts)
├── generate-sidebar.ts       # Dynamic sidebar generation from workspace
├── nodemon.json              # File watching configuration for dev server
├── package.json
└── tsconfig.json
```

## Adding Documentation

### Manual Documentation

1. Create a new `.md` or `.mdx` file in `docs/`
2. Add frontmatter:
   ```markdown
   ---
   sidebar_position: 1
   ---
   
   # Your Title
   
   Your content here...
   ```
3. The page will automatically appear in the sidebar

### API Documentation

API documentation is automatically generated from TypeScript packages using TypeDoc.

To regenerate API docs:

```bash
# From repository root
pnpm docs:typedoc
```

Configuration is in:
- `/typedoc.json` - Root TypeDoc configuration
- `docusaurus.config.ts` - Docusaurus TypeDoc plugin settings

## Configuration

### Docusaurus Config

Main configuration is in `docusaurus.config.ts`:

- **Site metadata** - Title, tagline, URL
- **Theme configuration** - Navbar, footer, colors
- **Plugin configuration** - TypeDoc, search, etc.

### Sidebar

Navigation structure is dynamically generated in `sidebars.ts` using `generate-sidebar.ts`:

```typescript
const sidebars: SidebarsConfig = {
  tutorialSidebar: generateSidebar(workspaceRoot, typedocSidebar),
};
```

The sidebar automatically includes:
- All dialects from `dialects/` directory
- All packages from `packages/` directory
- Custom icons and display names from `PACKAGE_CONFIG` in `generate-sidebar.ts`

To customize package display:

1. Edit `generate-sidebar.ts`
2. Update the `PACKAGE_CONFIG` object:
   ```typescript
   const PACKAGE_CONFIG: Record<string, { emoji: string; displayName: string }> = {
     '@agentscript/dialect': {
       emoji: '🏛️',
       displayName: 'AgentScript Dialect',
     },
     // ... more packages
   };
   ```
3. The dev server will auto-reload if using `pnpm dev`

### Styling

Custom styles are in `src/css/custom.css`. You can override Docusaurus theme variables:

```css
:root {
  --ifm-color-primary: #2e8555;
  /* ... more variables */
}
```

## TypeDoc Integration

The docs site uses `docusaurus-plugin-typedoc` to generate API documentation from TypeScript source code.

### How It Works

1. TypeDoc reads TypeScript packages from the monorepo
2. Generates Markdown files in `docs/api/`
3. Docusaurus includes these in the site build
4. API docs appear in the sidebar under "API Reference"

### Configuration

TypeDoc is configured in two places:

**Root `/typedoc.json`:**
```json
{
  "entryPointStrategy": "packages",
  "entryPoints": ["packages/*", "dialects/*"],
  "out": "apps/docs/docs/api",
  "plugin": ["typedoc-plugin-markdown"]
}
```

**`docusaurus.config.ts`:**
```typescript
plugins: [
  [
    'docusaurus-plugin-typedoc',
    {
      entryPoints: ['../../packages/agentscript-typescript-sdk'],
      entryPointStrategy: 'packages',
      out: 'docs/api',
      // ... more options
    },
  ],
],
```

## Deployment

### GitHub Pages

The static build output can be deployed to GitHub Pages:

```bash
# Build the site
pnpm docs:build

# Deploy to gh-pages branch (configure in docusaurus.config.ts)
pnpm deploy
```

### Other Platforms

The `build/` directory contains static HTML/CSS/JS that can be deployed to:

- Netlify
- Vercel
- AWS S3
- Any static hosting service

## Troubleshooting

### Port Already in Use

If port 3000 is already in use:

```bash
# Use a different port
pnpm dev -- --port 3001
```

### Build Errors

Clear the cache and rebuild:

```bash
pnpm clear
pnpm build
```

### TypeDoc Not Generating

Make sure packages are built first:

```bash
# From repository root
pnpm build
pnpm docs:typedoc
pnpm docs:build
```

## Learn More

- [Docusaurus Documentation](https://docusaurus.io/docs)
- [TypeDoc Documentation](https://typedoc.org/)
- [MDX Documentation](https://mdxjs.com/)
