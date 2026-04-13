/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Extract TypeScript type definitions for use in documentation
 *
 * This script extracts interfaces, types, enums, and classes from source files
 * and saves them as JSON for use in MDX documentation.
 *
 * Run: tsx apps/docs/extract-types.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const WORKSPACE_ROOT = path.resolve(__dirname, '../..');
const OUTPUT_FILE = path.join(__dirname, 'src/data/extracted-types.json');

interface ExtractedType {
  name: string;
  kind: string;
  code: string;
  file: string;
  line: number;
}

const filesToExtract: string[] = [];

function extractTypes(filePath: string): ExtractedType[] {
  const fullPath = path.join(WORKSPACE_ROOT, filePath);

  if (!fs.existsSync(fullPath)) {
    console.warn(`File not found: ${fullPath}`);
    return [];
  }

  const sourceCode = fs.readFileSync(fullPath, 'utf-8');
  const sourceFile = ts.createSourceFile(
    fullPath,
    sourceCode,
    ts.ScriptTarget.Latest,
    true
  );

  const extracted: ExtractedType[] = [];

  function visit(node: ts.Node) {
    let shouldExtract = false;
    let kind = '';
    let name = '';

    if (
      ts.isInterfaceDeclaration(node) &&
      node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      shouldExtract = true;
      kind = 'interface';
      name = node.name.getText(sourceFile);
    } else if (
      ts.isTypeAliasDeclaration(node) &&
      node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      shouldExtract = true;
      kind = 'type';
      name = node.name.getText(sourceFile);
    } else if (
      ts.isEnumDeclaration(node) &&
      node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      shouldExtract = true;
      kind = 'enum';
      name = node.name.getText(sourceFile);
    } else if (
      ts.isClassDeclaration(node) &&
      node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      shouldExtract = true;
      kind = 'class';
      name = node.name?.getText(sourceFile) || '';
    }

    if (shouldExtract && name) {
      const start = node.getStart(sourceFile);
      const end = node.getEnd();
      const code = sourceCode.substring(start, end);
      const { line } = sourceFile.getLineAndCharacterOfPosition(start);

      extracted.push({
        name,
        kind,
        code,
        file: filePath,
        line: line + 1,
      });
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return extracted;
}

function main() {
  // eslint-disable-next-line no-console
  console.log('Extracting type definitions...');

  const allTypes: Record<string, ExtractedType> = {};

  for (const file of filesToExtract) {
    // eslint-disable-next-line no-console
    console.log(`  Processing ${file}...`);
    const types = extractTypes(file);

    for (const type of types) {
      allTypes[type.name] = type;
      // eslint-disable-next-line no-console
      console.log(`    ✓ ${type.kind} ${type.name}`);
    }
  }

  // Ensure output directory exists
  const outputDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Write to JSON
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allTypes, null, 2));

  // eslint-disable-next-line no-console
  console.log(
    `\n✓ Extracted ${Object.keys(allTypes).length} types to ${OUTPUT_FILE}`
  );
}

main();
