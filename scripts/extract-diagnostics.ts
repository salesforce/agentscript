#!/usr/bin/env tsx
/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Extract Diagnostics Script
 *
 * Scans the codebase for all diagnostic definitions and generates
 * a markdown documentation table.
 *
 * Usage: tsx scripts/extract-diagnostics.ts
 *
 * This script is run automatically during pre-commit to keep
 * the diagnostics documentation up to date.
 */

import * as fs from 'fs';
import * as path from 'path';

interface DiagnosticEntry {
  source: string;
  code: string;
  description: string;
  severity: string;
  file: string;
  line: number;
}

interface LintRule {
  id: string;
  description: string;
  severity: string;
  phase: string;
  file: string;
  line: number;
  codes: string[];
}

const ROOT_DIR = path.resolve(new URL('.', import.meta.url).pathname, '..');
const OUTPUT_FILE = path.join(
  ROOT_DIR,
  'apps/docs/docs/architecture/diagnostic-reference.md'
);

// Git repo base URL for source links
const GIT_BASE = 'https://github.com/salesforce/agentscript/blob/master';

// Directories to scan
const SCAN_DIRS = [
  'packages/core/src',
  'packages/schema/src',
  'dialects/base/src',
  'dialects/agentforce/src',
];

// Pattern to match LintRule definitions (only outside of comments/docstrings)
// Negative lookbehind for * to avoid matching examples in JSDoc comments
const LINT_RULE_PATTERN =
  /(?<!\*\s*)(?:const|export const)\s+(\w+):\s*LintRule\s*=\s*{([^}]+(?:{[^}]*}[^}]*)*)}/gs;

// Pattern to extract rule properties
const RULE_ID_PATTERN = /id:\s*['"]([^'"]+)['"]/;
const RULE_SEVERITY_PATTERN = /severity:\s*DiagnosticSeverity\.(\w+)/;
const RULE_PHASE_PATTERN = /phase:\s*['"]([^'"]+)['"]/;
const RULE_DESCRIPTION_PATTERN = /description:\s*['"]([^'"]+)['"]/;

function getAllTsFiles(dir: string): string[] {
  const files: string[] = [];
  const fullPath = path.join(ROOT_DIR, dir);

  if (!fs.existsSync(fullPath)) {
    return files;
  }

  function walk(currentPath: string) {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory() && !entry.name.includes('node_modules')) {
        walk(entryPath);
      } else if (
        entry.isFile() &&
        entry.name.endsWith('.ts') &&
        !entry.name.endsWith('.test.ts')
      ) {
        files.push(entryPath);
      }
    }
  }

  walk(fullPath);
  return files;
}

function extractInlineDiagnostics(
  content: string,
  filePath: string
): DiagnosticEntry[] {
  const diagnostics: DiagnosticEntry[] = [];
  const relativePath = path.relative(ROOT_DIR, filePath);

  // Find diagnostics.push or addDiagnostic calls
  const pushPattern =
    /(?:diagnostics\.push|addDiagnostic)\s*\(\s*{([^}]+(?:{[^}]*}[^}]*)*)}/gs;

  let match;
  while ((match = pushPattern.exec(content)) !== null) {
    const block = match[1];
    const lineNumber = content.substring(0, match.index).split('\n').length;

    const sourceMatch = block.match(/source:\s*['"]([^'"]+)['"]/);
    const codeMatch = block.match(/code:\s*['"]([^'"]+)['"]/);
    const messageMatch = block.match(/message:\s*['"`]([^'"`]+)['"`]/);
    const severityMatch = block.match(/severity:\s*DiagnosticSeverity\.(\w+)/);

    if (sourceMatch && codeMatch) {
      diagnostics.push({
        source: sourceMatch[1],
        code: codeMatch[1],
        description: messageMatch ? cleanMessage(messageMatch[1]) : '',
        severity: severityMatch ? severityMatch[1] : 'Error',
        file: relativePath,
        line: lineNumber,
      });
    }
  }

  return diagnostics;
}

function extractLintRules(content: string, filePath: string): LintRule[] {
  const rules: LintRule[] = [];
  const relativePath = path.relative(ROOT_DIR, filePath);

  let match;
  while ((match = LINT_RULE_PATTERN.exec(content)) !== null) {
    const ruleBlock = match[2];
    const lineNumber = content.substring(0, match.index).split('\n').length;

    const idMatch = ruleBlock.match(RULE_ID_PATTERN);
    const severityMatch = ruleBlock.match(RULE_SEVERITY_PATTERN);
    const phaseMatch = ruleBlock.match(RULE_PHASE_PATTERN);
    const descriptionMatch = ruleBlock.match(RULE_DESCRIPTION_PATTERN);

    if (idMatch) {
      // Find ctx.report calls with codes in the check function
      const codes: string[] = [];
      let reportMatch;
      const checkFnMatch = content
        .substring(match.index)
        .match(/check\s*\([^)]*\)\s*{([\s\S]*?)^\s{2}}/m);
      if (checkFnMatch) {
        const checkContent = checkFnMatch[1];
        // Match ctx.report calls - handle messages with commas by using a more flexible pattern
        // Pattern: ctx.report(severity, message, 'code' or ctx.report(severity, message, 'code', node)
        // The message can be a template literal with commas, so we match the code after looking for
        // the pattern: comma, whitespace, single/double quoted string, optional comma/paren
        const reportPattern =
          /ctx\.report\([\s\S]*?,\s*['"]([a-z][a-z0-9-]*)['"](?:\s*[,)])/g;
        while ((reportMatch = reportPattern.exec(checkContent)) !== null) {
          const code = reportMatch[1];
          // Skip template literal fragments and invalid codes
          if (
            !codes.includes(code) &&
            !code.includes('${') &&
            !code.includes("')}")
          ) {
            codes.push(code);
          }
        }
      }

      rules.push({
        id: idMatch[1],
        description: descriptionMatch ? descriptionMatch[1] : '',
        severity: severityMatch ? severityMatch[1] : 'Error',
        phase: phaseMatch ? phaseMatch[1] : 'semantic',
        file: relativePath,
        line: lineNumber,
        codes,
      });
    }
  }

  return rules;
}

function cleanMessage(message: string): string {
  // Remove template literals and variables
  return message
    .replace(/\$\{[^}]+\}/g, '...')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 80); // Truncate long messages
}

function generateMarkdown(
  diagnostics: DiagnosticEntry[],
  rules: LintRule[]
): string {
  // Group diagnostics by source
  const bySource = new Map<string, DiagnosticEntry[]>();
  for (const diag of diagnostics) {
    const existing = bySource.get(diag.source) || [];
    // Dedupe by code
    if (!existing.some(d => d.code === diag.code)) {
      existing.push(diag);
    }
    bySource.set(diag.source, existing);
  }

  // Add rules as sources
  for (const rule of rules) {
    const existing = bySource.get(rule.id) || [];
    // Add each code from the rule
    for (const code of rule.codes) {
      if (!existing.some(d => d.code === code)) {
        existing.push({
          source: rule.id,
          code,
          description: rule.description,
          severity: rule.severity,
          file: rule.file,
          line: rule.line,
        });
      }
    }
    // If rule has no codes, add the rule id as both source and implicit code
    if (rule.codes.length === 0) {
      existing.push({
        source: rule.id,
        code: '(via ctx.report)',
        description: rule.description,
        severity: rule.severity,
        file: rule.file,
        line: rule.line,
      });
    }
    bySource.set(rule.id, existing);
  }

  // Sort sources
  const sortedSources = Array.from(bySource.keys()).sort();

  // Group by dialect
  const agentscriptSources = sortedSources.filter(s =>
    s.startsWith('agentscript/')
  );
  const agentforceSources = sortedSources.filter(s =>
    s.startsWith('agentforce/')
  );
  // Base rules (no dialect prefix) - these are generic rules
  const baseRuleSources = sortedSources.filter(
    s =>
      !s.startsWith('agentscript/') &&
      !s.startsWith('agentforce/') &&
      !s.includes('/')
  );
  const otherSources = sortedSources.filter(
    s =>
      !s.startsWith('agentscript/') &&
      !s.startsWith('agentforce/') &&
      s.includes('/')
  );

  let md = `---
sidebar_position: 5
---

# Diagnostic Reference

This page lists all diagnostics that can be reported by the AgentScript linter and parser.

> **Note**: This file is auto-generated by \`scripts/extract-diagnostics.ts\`.
> Do not edit manually. Run \`pnpm extract-diagnostics\` to regenerate.

## Naming Convention

All diagnostics follow a consistent naming convention:

- **Source**: \`dialect/component\` format (e.g., \`agentscript/parser\`, \`agentforce/developer-name\`)
- **Code**: \`kebab-case\` format (e.g., \`unknown-field\`, \`syntax-error\`)

## AgentScript (Base) Diagnostics

These diagnostics are part of the core AgentScript language.

| Source | Code | Severity | Description | Defined In |
|--------|------|----------|-------------|------------|
`;

  for (const source of agentscriptSources) {
    const diags = bySource.get(source)!;
    for (const diag of diags.sort((a, b) => a.code.localeCompare(b.code))) {
      const sourceLink = `[${path.basename(diag.file)}:${diag.line}](${GIT_BASE}/${diag.file}#L${diag.line})`;
      md += `| \`${diag.source}\` | \`${diag.code}\` | ${diag.severity} | ${diag.description || '-'} | ${sourceLink} |\n`;
    }
  }

  if (agentforceSources.length > 0) {
    md += `
## Agentforce Dialect Diagnostics

These diagnostics are specific to the Agentforce dialect.

| Source | Code | Severity | Description | Defined In |
|--------|------|----------|-------------|------------|
`;

    for (const source of agentforceSources) {
      const diags = bySource.get(source)!;
      for (const diag of diags.sort((a, b) => a.code.localeCompare(b.code))) {
        const sourceLink = `[${path.basename(diag.file)}:${diag.line}](${GIT_BASE}/${diag.file}#L${diag.line})`;
        md += `| \`${diag.source}\` | \`${diag.code}\` | ${diag.severity} | ${diag.description || '-'} | ${sourceLink} |\n`;
      }
    }
  }

  if (baseRuleSources.length > 0) {
    md += `
## Base Lint Rules

These are generic lint rules that apply to all AgentScript dialects. The rule ID is used as the diagnostic source.

| Rule ID | Code | Severity | Description | Defined In |
|---------|------|----------|-------------|------------|
`;

    for (const source of baseRuleSources) {
      const diags = bySource.get(source)!;
      for (const diag of diags.sort((a, b) => a.code.localeCompare(b.code))) {
        const sourceLink = `[${path.basename(diag.file)}:${diag.line}](${GIT_BASE}/${diag.file}#L${diag.line})`;
        md += `| \`${diag.source}\` | \`${diag.code}\` | ${diag.severity} | ${diag.description || '-'} | ${sourceLink} |\n`;
      }
    }
  }

  if (otherSources.length > 0) {
    md += `
## Other Diagnostics

| Source | Code | Severity | Description | Defined In |
|--------|------|----------|-------------|------------|
`;

    for (const source of otherSources) {
      const diags = bySource.get(source)!;
      for (const diag of diags.sort((a, b) => a.code.localeCompare(b.code))) {
        const sourceLink = `[${path.basename(diag.file)}:${diag.line}](${GIT_BASE}/${diag.file}#L${diag.line})`;
        md += `| \`${diag.source}\` | \`${diag.code}\` | ${diag.severity} | ${diag.description || '-'} | ${sourceLink} |\n`;
      }
    }
  }

  // Add lint rules section - dedupe by id
  const uniqueRules = new Map<string, LintRule>();
  for (const rule of rules) {
    if (!uniqueRules.has(rule.id)) {
      uniqueRules.set(rule.id, rule);
    }
  }
  const deduped = Array.from(uniqueRules.values());

  if (deduped.length > 0) {
    md += `
## All Lint Rules

Complete list of registered lint rules.

| Rule ID | Phase | Severity | Description | Defined In |
|---------|-------|----------|-------------|------------|
`;

    for (const rule of deduped.sort((a, b) => a.id.localeCompare(b.id))) {
      const sourceLink = `[${path.basename(rule.file)}:${rule.line}](${GIT_BASE}/${rule.file}#L${rule.line})`;
      md += `| \`${rule.id}\` | ${rule.phase} | ${rule.severity} | ${rule.description || '-'} | ${sourceLink} |\n`;
    }
  }

  md += `
## See Also

- [Diagnostic Conventions](./diagnostic-conventions.md) - Guidelines for creating new diagnostics
- [Custom Lint Passes](../extending/custom-lint-passes.md) - How to create custom lint rules
`;

  return md;
}

function main(): void {
  console.warn('Extracting diagnostics from codebase...\n');

  const allDiagnostics: DiagnosticEntry[] = [];
  const allRules: LintRule[] = [];

  for (const dir of SCAN_DIRS) {
    const files = getAllTsFiles(dir);
    console.warn(`  Scanning ${dir}: ${files.length} files`);

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      const diagnostics = extractInlineDiagnostics(content, file);
      const rules = extractLintRules(content, file);

      allDiagnostics.push(...diagnostics);
      allRules.push(...rules);
    }
  }

  console.warn(`\nFound ${allDiagnostics.length} inline diagnostics`);
  console.warn(`Found ${allRules.length} lint rules`);

  const markdown = generateMarkdown(allDiagnostics, allRules);

  // Ensure output directory exists
  const outputDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_FILE, markdown);
  console.warn(`\nGenerated: ${path.relative(ROOT_DIR, OUTPUT_FILE)}`);
}

try {
  main();
} catch (err) {
  console.error('Error:', err);
  process.exit(1);
}
