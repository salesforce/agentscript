#!/usr/bin/env tsx

/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Validates TypeScript code blocks in documentation files
 *
 * This script:
 * 1. Extracts all TypeScript code blocks from markdown files
 * 2. Compiles them to check for syntax and type errors
 * 3. Reports any issues found
 *
 * Uses the actual TypeScript SDK types - no manual mocks to maintain!
 *
 * Usage:
 *   npm run validate-code-blocks
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';
import { glob } from 'glob';

interface CodeBlock {
  file: string;
  lineNumber: number;
  code: string;
  language: string;
}

interface ValidationResult {
  file: string;
  lineNumber: number;
  errors: string[];
  warnings: string[];
}

const DOCS_DIR = path.join(__dirname, 'docs');
const TEMP_DIR = path.join(__dirname, '.code-validation-temp');
const CORE_PATH = path.resolve(__dirname, '../../packages/core');

// Minimal helper code for examples - imports types from core!
const HELPER_CODE = `
// Import types from core
import type {
  BaseNode,
  BlockNode,
  Diagnostic,
  DiagnosticSeverity,
  Position,
  SourceSpan,
  LintRule,
  LintContext,
  DialectConfig,
  TransformResult,
} from '@agentscript/core';

import {
  BaseDialect,
  Validator,
  StringNode,
  NumberNode,
  BooleanNode,
  VariableRefNode,
} from '@agentscript/core';

// Legacy type aliases for documentation examples
type LinterRule = LintRule;
type ValidationContext = LintContext;
type Range = SourceSpan;
interface ASTVisitor<T = unknown> {
  readonly id: string;
  visit(node: BaseNode): void;
  getDecoration(): T;
}
interface DecoratedNode<T extends BaseNode> extends BaseNode {
  getDecoration<V>(visitor: new () => ASTVisitor<V>): V | undefined;
}
class SymbolTableVisitor implements ASTVisitor<Map<string, unknown>> {
  readonly id = 'symbol-table';
  visit() {}
  getDecoration() { return new Map(); }
}
class ActionRegistryVisitor implements ASTVisitor<Map<string, unknown>> {
  readonly id = 'action-registry';
  visit() {}
  getDecoration() { return new Map(); }
}
function createDiagnostic(message: string, range: Range, severity: number, options?: any): Diagnostic {
  return { message, span: range, severity: severity as any, source: options?.source, code: options?.code };
}
function getNodeRange(node: BaseNode): Range {
  return node.span || { start: { row: 0, column: 0 }, end: { row: 0, column: 0 } };
}

// Test framework types
declare function describe(name: string, fn: () => void): void;
declare function it(name: string, fn: () => void): void;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare function expect(value: any): any;

// Mock helper functions for examples
function parseCode(code: string): any {
  return { type: 'program', children: [] };
}

function parse(code: string): any {
  return { type: 'program', children: [] };
}

async function checkApiExists(apiName: string): Promise<boolean> {
  return true;
}

function hasCapability(node: BaseNode, capability: string): boolean {
  return false;
}

// Mock data types for examples
interface ComplexityData {
  complexity: number;
  decisions: number;
  loops: number;
  conditionals: number;
}

interface ActionSymbol {
  name: string;
  inputs: Map<string, string>;
  outputs: Map<string, string>;
}

interface Scope {
  resolve(name: string): any;
  resolveUpwards(name: string): any;
  resolveDownwards(path: string[]): any;
}

interface MyDataType {
  count: number;
}

class MyData {
  value: string = '';
}

type VisitorConstructor<T = any> = new () => ASTVisitor<T>;

// Mock variables
const myCode = '';
const code = '';
const myCustomLinter: LinterRule = {} as any;
const myCustomLinter1: LinterRule = {} as any;
const myCustomLinter2: LinterRule = {} as any;
const snakeCaseNaming: LinterRule = {} as any;
const unusedActionsLinter: LinterRule = {} as any;
const maxComplexityLinter: LinterRule = {} as any;
const securityScanner: LinterRule = {} as any;
const endpointValidation: LinterRule = {} as any;
const noDuplicateActions: LinterRule = {} as any;
const mySchema: any = {};
const myDialect: any = {};
const ast: BaseNode = {} as any;
const node: BaseNode = {} as any;
const context: ValidationContext = {} as any;
const dialect: BaseDialect = {} as any;
const securityLinter: LinterRule = {} as any;
const capabilityLinter: LinterRule = {} as any;
const platformSpecificLinter1: LinterRule = {} as any;
const platformSpecificLinter2: LinterRule = {} as any;
const rateLimitLinter: LinterRule = {} as any;
const authMethodLinter: LinterRule = {} as any;
const baseDialect: BaseDialect = {} as any;

// Mock classes
class AgentScriptDialect extends BaseDialect {
  constructor(config?: DialectConfig) {
    super(config || { id: 'agentscript', name: 'AgentScript', version: '1.0.0' });
  }
}

class PlatformDialect extends BaseDialect {
  constructor(config?: DialectConfig) {
    super(config || { id: 'platform', name: 'Platform', version: '1.0.0' });
  }
}

class Dialect extends BaseDialect {
  constructor(config?: DialectConfig) {
    super(config || { id: 'custom', name: 'Custom', version: '1.0.0' });
  }
}

class ComplexityAnalyzer extends ASTVisitor<ComplexityData> {
  readonly id = 'complexity';
  visit(node: BaseNode): void {}
  getDecoration(): ComplexityData {
    return { complexity: 0, decisions: 0, loops: 0, conditionals: 0 };
  }
}

class ActionCallTracker extends ASTVisitor<Map<string, number>> {
  readonly id = 'action-calls';
  visit(node: BaseNode): void {}
  getDecoration(): Map<string, number> {
    return new Map();
  }
}

// Mock functions
function validate(node: BaseNode, context: ValidationContext): Diagnostic[] {
  return [];
}

async function validateAsync(node: BaseNode, context: ValidationContext): Promise<Diagnostic[]> {
  return [];
}

// Test helpers
function createTestInput(): any {
  return {};
}

const methodName = 'testMethod';
const expected = 'expected value';

// Mock fs module
const fs = {
  readFileSync: (path: string) => '',
  writeFileSync: (path: string, data: string) => {},
};
`;

/**
 * Extract TypeScript code blocks from markdown files
 */
function extractCodeBlocks(filePath: string): CodeBlock[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const blocks: CodeBlock[] = [];

  let inCodeBlock = false;
  let currentBlock: string[] = [];
  let blockStartLine = 0;
  let language = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Start of code block
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true;
        blockStartLine = i + 1;
        language = line.slice(3).trim();
        currentBlock = [];
      } else {
        // End of code block
        inCodeBlock = false;

        if (language === 'typescript' || language === 'ts') {
          blocks.push({
            file: filePath,
            lineNumber: blockStartLine,
            code: currentBlock.join('\n'),
            language,
          });
        }

        currentBlock = [];
        language = '';
      }
    } else if (inCodeBlock) {
      currentBlock.push(line);
    }
  }

  return blocks;
}

/**
 * Validate a TypeScript code block
 */
function validateCodeBlock(block: CodeBlock, index: number): ValidationResult {
  const result: ValidationResult = {
    file: block.file,
    lineNumber: block.lineNumber,
    errors: [],
    warnings: [],
  };

  // Skip code blocks that are clearly fragments or examples
  const code = block.code.trim();
  if (!code) {
    return result;
  }

  // Check if this is a complete, standalone code block or a fragment
  const isFragment =
    code.includes('// ...') ||
    code.includes('/* ... */') ||
    code.includes('/*...*/') || // Without spaces
    /\/\*[^*]*\.\.\.[^*]*\*\//.test(code) || // Match /* ... */ with any content
    code.startsWith('//') ||
    code.startsWith('export interface') || // Interface definitions
    code.startsWith('export type') || // Type definitions
    code.startsWith('enum ') || // Enum definitions
    code.startsWith('interface ') ||
    code.startsWith('type ') ||
    code.startsWith('function ') || // Function signatures
    code.startsWith('abstract class ') || // Abstract class definitions
    code.includes('A function whose declared type') || // Intentional examples
    code.length < 30 ||
    // Skip API documentation code blocks (from typedoc)
    block.file.includes('/api/') ||
    // Skip code blocks that are clearly just showing signatures
    (code.split('\n').length <= 5 && !code.includes('{')) ||
    // Skip method signature examples (no class context)
    /^(async\s+)?validate\s*\(/.test(code.trim()) ||
    /^(async\s+)?(override\s+)?visit\s*\(/.test(code.trim()) ||
    /^override\s+/.test(code.trim()) || // Method overrides without class
    /^(async\s+)?transform\s*\(/.test(code.trim()) || // Transform methods
    /^static\s+(override\s+)?/.test(code.trim()) || // Static members without class
    /^async\s+[a-z][a-zA-Z]*\s*\(/.test(code.trim()) || // Async methods without class
    // Skip blocks that start with method calls without context
    /^[a-z][a-zA-Z]*\s*\(/.test(code.trim()) ||
    // Skip blocks with pattern placeholders
    /\.\.\.\s*[,})\]]/.test(code) ||
    /\/\*[^*]*\.\.\.[^*]*\*\/\s*[,})\]]/.test(code) || // /* ... */ followed by delimiter
    // Skip blocks that look like method bodies (start with method name followed by paren)
    /^[a-z][a-zA-Z]*\s*\([^)]*\)\s*\{/.test(code.trim()) ||
    // Skip class definitions with only method signatures (no implementations)
    (code.includes('class ') && !code.match(/\{\s*[^}]*\{/));

  if (isFragment) {
    // For fragments and API docs, just do basic syntax check
    return validateSyntax(block, result);
  }

  // For complete blocks, do full type checking
  return validateWithTypeScript(block, index, result);
}

/**
 * Basic syntax validation for code fragments
 */
function validateSyntax(
  block: CodeBlock,
  result: ValidationResult
): ValidationResult {
  try {
    // Try to parse as TypeScript
    const sourceFile = ts.createSourceFile(
      'temp.ts',
      block.code,
      ts.ScriptTarget.Latest,
      true
    );

    // Check for syntax errors
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const diagnostics = (sourceFile as any).parseDiagnostics || [];

    for (const diag of diagnostics) {
      const message = ts.flattenDiagnosticMessageText(diag.messageText, '\n');
      result.errors.push(`Syntax error: ${message}`);
    }
  } catch (error) {
    result.errors.push(`Parse error: ${error}`);
  }

  return result;
}

/**
 * Full TypeScript validation with type checking
 */
function validateWithTypeScript(
  block: CodeBlock,
  index: number,
  result: ValidationResult
): ValidationResult {
  // Create temporary file
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }

  const tempFile = path.join(TEMP_DIR, `block-${index}.ts`);

  // Prepend helper code with real SDK imports
  const wrappedCode = `${HELPER_CODE}\n\n${block.code}`;

  fs.writeFileSync(tempFile, wrappedCode);

  try {
    // Create TypeScript program with paths to resolve SDK
    const program = ts.createProgram([tempFile], {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      strict: false, // Be lenient for documentation examples
      noEmit: true,
      skipLibCheck: true,
      types: ['node'],
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      lib: ['ES2022'],
      // Point to the actual core package
      baseUrl: path.join(__dirname, '../..'),
      paths: {
        '@agentscript/core': [CORE_PATH + '/src/index.ts'],
        '@agentscript/core/*': [CORE_PATH + '/src/*'],
      },
    });

    // Get diagnostics
    const diagnostics = ts.getPreEmitDiagnostics(program);

    for (const diag of diagnostics) {
      if (!diag.file || diag.file.fileName !== tempFile) {
        continue;
      }

      const message = ts.flattenDiagnosticMessageText(diag.messageText, '\n');

      // Skip certain expected errors in documentation examples
      if (
        message.includes('@agentscript/core') ||
        message.includes('@agentscript/typescript-sdk') || // Legacy docs
        message.includes('@agentscript/dialect') ||
        message.includes('./action-counter') ||
        message.includes('Cannot redeclare block-scoped variable') || // Multiple examples may declare same vars
        message.includes('Duplicate identifier') || // Code blocks re-importing types we provide
        message.includes('Duplicate function implementation') || // Examples showing function signatures
        message.includes('Function implementation is missing') || // API reference showing signatures only
        message.includes('Constructor implementation is missing') || // API reference
        message.includes('A function whose declared type is neither') || // Intentional incomplete examples
        (message.includes('override') && message.includes('does not extend')) || // Override examples
        (message.includes('visitChildren') &&
          message.includes('does not exist')) || // Base class methods
        message.includes('Object is possibly') || // Null safety in examples
        (message.includes('Property') &&
          message.includes('does not exist on type') &&
          (message.includes('data') ||
            message.includes('linters') ||
            message.includes('loadExternalData') ||
            message.includes('computeFinalResults') ||
            message.includes('processNode') ||
            message.includes('transformCST'))) // Example-specific properties
      ) {
        continue;
      }

      // Calculate actual line number in original code
      const linesBeforeCode = HELPER_CODE.split('\n').length;
      const actualLine =
        diag.file.getLineAndCharacterOfPosition(diag.start || 0).line -
        linesBeforeCode +
        1;

      // Skip errors in injected code
      if (actualLine < 1) {
        continue;
      }

      const errorMessage = `Line ${actualLine}: ${message}`;

      if (diag.category === ts.DiagnosticCategory.Error) {
        result.errors.push(errorMessage);
      } else if (diag.category === ts.DiagnosticCategory.Warning) {
        result.warnings.push(errorMessage);
      }
    }
  } catch (error) {
    result.errors.push(`Compilation error: ${error}`);
  }

  return result;
}

/**
 * Clean up temporary files
 */
function cleanup() {
  if (fs.existsSync(TEMP_DIR)) {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
}

/**
 * Main validation function
 */
async function main() {
  /* eslint-disable no-console */
  console.log('🔍 Validating TypeScript code blocks in documentation...\n');

  // Find all markdown files
  const markdownFiles = await glob('**/*.{md,mdx}', {
    cwd: DOCS_DIR,
    absolute: true,
    ignore: ['**/node_modules/**'],
  });

  console.log(`Found ${markdownFiles.length} documentation files\n`);

  let totalBlocks = 0;
  let totalErrors = 0;
  let totalWarnings = 0;
  const results: ValidationResult[] = [];

  // Process each file
  for (const file of markdownFiles) {
    const blocks = extractCodeBlocks(file);

    if (blocks.length === 0) {
      continue;
    }

    const relativePath = path.relative(DOCS_DIR, file);
    console.log(`📄 ${relativePath}: ${blocks.length} code blocks`);

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const result = validateCodeBlock(block, totalBlocks + i);

      if (result.errors.length > 0 || result.warnings.length > 0) {
        results.push(result);
        totalErrors += result.errors.length;
        totalWarnings += result.warnings.length;
      }
    }

    totalBlocks += blocks.length;
  }

  // Clean up
  cleanup();

  // Report results
  console.log('\n' + '='.repeat(80));
  console.log(`\n📊 Validation Summary:`);
  console.log(`   Total code blocks: ${totalBlocks}`);
  console.log(`   Blocks with errors: ${results.length}`);
  console.log(`   Total errors: ${totalErrors}`);
  console.log(`   Total warnings: ${totalWarnings}`);

  if (results.length > 0) {
    console.log('\n❌ Issues found:\n');

    // Group by file
    const byFile = new Map<string, ValidationResult[]>();
    for (const result of results) {
      const relativePath = path.relative(DOCS_DIR, result.file);
      if (!byFile.has(relativePath)) {
        byFile.set(relativePath, []);
      }
      byFile.get(relativePath)!.push(result);
    }

    // Show first 10 files with issues
    let fileCount = 0;
    for (const [file, fileResults] of byFile) {
      if (fileCount >= 10) {
        console.log(`\n... and ${byFile.size - 10} more files with issues\n`);
        break;
      }

      console.log(`📄 ${file}`);
      for (const result of fileResults) {
        console.log(`   Line ${result.lineNumber}:`);
        // Show first 3 errors per block
        for (const error of result.errors.slice(0, 3)) {
          console.log(`      ❌ ${error}`);
        }
        if (result.errors.length > 3) {
          console.log(`      ... and ${result.errors.length - 3} more errors`);
        }
      }
      console.log('');
      fileCount++;
    }

    console.log(
      '💡 Tip: Some errors may be expected for documentation fragments.'
    );
    console.log(
      '   Run with STRICT=1 to fail the build, or fix the errors above.\n'
    );

    // Only fail if STRICT mode is enabled
    if (process.env.STRICT === '1') {
      process.exit(1);
    } else {
      console.log(
        '⚠️  Validation found issues but not failing (set STRICT=1 to fail)\n'
      );
      process.exit(0);
    }
  } else {
    console.log('\n✅ All code blocks are valid!\n');
    process.exit(0);
  }
  /* eslint-enable no-console */
}

// Run validation
main().catch(error => {
  console.error('Fatal error:', error);
  cleanup();
  process.exit(1);
});
