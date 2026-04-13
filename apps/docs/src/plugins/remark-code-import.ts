/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Remark plugin to import code snippets from source files
 *
 * Usage in markdown:
 * ```typescript import
 * @import {LintRule} from "@agentscript/core"
 * ```
 *
 * Or import from file:
 * ```typescript import
 * @import-file packages/core/src/linter/types.ts#LintRule
 * ```
 */

import { visit } from 'unist-util-visit';
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

interface CodeNode {
  type: 'code';
  lang: string;
  meta?: string;
  value: string;
}

const WORKSPACE_ROOT = path.resolve(__dirname, '../../../..');

/**
 * Extract a specific interface/type/class from a TypeScript file
 */
function extractTypeDefinition(
  filePath: string,
  typeName: string
): string | null {
  const fullPath = path.join(WORKSPACE_ROOT, filePath);

  if (!fs.existsSync(fullPath)) {
    console.warn(`File not found: ${fullPath}`);
    return null;
  }

  const sourceCode = fs.readFileSync(fullPath, 'utf-8');
  const sourceFile = ts.createSourceFile(
    fullPath,
    sourceCode,
    ts.ScriptTarget.Latest,
    true
  );

  let result: string | null = null;

  function visit(node: ts.Node) {
    // Check for interface, type alias, class, or enum
    if (
      (ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isEnumDeclaration(node)) &&
      node.name?.getText(sourceFile) === typeName
    ) {
      // Extract just the declaration (remove leading JSDoc if we want clean output)
      const start = node.getStart(sourceFile);
      const end = node.getEnd();

      result = sourceCode.substring(start, end);
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return result;
}

/**
 * Remark plugin to process code imports
 */
export default function remarkCodeImport() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tree: any) => {
    visit(tree, 'code', (node: CodeNode) => {
      const { meta, value } = node;

      // Check if this is an import directive
      if (meta?.includes('import') || value.trim().startsWith('@import')) {
        const lines = value.trim().split('\n');
        const importLine = lines[0];

        // Parse @import-file directive
        const fileMatch = importLine.match(/@import-file\s+(.+?)#(.+)/);
        if (fileMatch) {
          const [, filePath, typeName] = fileMatch;
          const extracted = extractTypeDefinition(filePath, typeName);

          if (extracted) {
            node.value = extracted;
            node.meta = undefined; // Remove the import meta
          } else {
            node.value = `// Error: Could not extract ${typeName} from ${filePath}`;
          }
          return;
        }

        // Parse @import directive (from package)
        const packageMatch = importLine.match(
          /@import\s+\{(.+?)\}\s+from\s+["'](.+?)["']/
        );
        if (packageMatch) {
          const [, typeNames, packageName] = packageMatch;
          const types = typeNames.split(',').map(t => t.trim());

          // Map package names to file paths
          const packagePaths: Record<string, string> = {
            '@agentscript/parser-tree-sitter':
              'packages/parser-tree-sitter/src',
          };

          const basePath = packagePaths[packageName];
          if (!basePath) {
            node.value = `// Error: Unknown package ${packageName}`;
            return;
          }

          // Try to find the type in common files
          const searchPaths = [
            path.join(basePath, 'index.ts'),
            path.join(basePath, 'types.ts'),
            path.join(basePath, 'linter/types.ts'),
            path.join(basePath, 'linter/index.ts'),
          ];

          let extracted: string | null = null;
          for (const typeName of types) {
            for (const searchPath of searchPaths) {
              extracted = extractTypeDefinition(searchPath, typeName);
              if (extracted) break;
            }
            if (extracted) break;
          }

          if (extracted) {
            node.value = extracted;
            node.meta = undefined;
          } else {
            node.value = `// Error: Could not find ${typeNames} in ${packageName}`;
          }
        }
      }
    });
  };
}
