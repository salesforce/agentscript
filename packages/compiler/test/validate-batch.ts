/**
 * Validate edge case .agent scripts through the full pipeline:
 *   parse → dialect parse → lint (agentforce rules) → compile
 *
 * Usage:
 *   npx tsx packages/compiler/test/validate-batch.ts [prefix]
 *   npx tsx packages/compiler/test/validate-batch.ts edge_
 */

import { readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse } from '@agentscript/parser';
import { parseAndLint } from '@agentscript/language';
import type { Diagnostic } from '@agentscript/types';
import { agentforceDialect } from '@agentscript/agentforce-dialect';
import { compile } from '../src/compile.js';
import { toParsedAgentforce } from './test-utils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptsDir = join(__dirname, 'fixtures', 'scripts');

const filter = process.argv[2] || 'edge_';
const files = readdirSync(scriptsDir)
  .filter(f => f.startsWith(filter) && f.endsWith('.agent'))
  .sort();

console.log(`\nValidating ${files.length} scripts matching "${filter}"...\n`);

let clean = 0;
let warned = 0;
let failed = 0;
const errorList: string[] = [];
const warnList: string[] = [];

for (const file of files) {
  const source = readFileSync(join(scriptsDir, file), 'utf-8');
  try {
    // Step 1: Parse
    const { rootNode: root } = parse(source);
    const mappingNode =
      root.namedChildren.find(n => n.type === 'mapping') ?? root;

    // Step 2: Dialect parse + lint (full agentforce pipeline)
    const { ast, diagnostics } = parseAndLint(mappingNode, agentforceDialect);

    const errors = diagnostics.filter((d: Diagnostic) => d.severity === 1);
    const warnings = diagnostics.filter((d: Diagnostic) => d.severity === 2);

    // Step 3: Compile
    const parsed = toParsedAgentforce(ast);
    const result = compile(parsed);

    if (errors.length > 0) {
      console.log(`  ✗ ${file} — ${errors.length} lint error(s)`);
      for (const e of errors.slice(0, 3)) {
        console.log(`      [ERROR] ${e.message}`);
      }
      if (errors.length > 3)
        console.log(`      ... and ${errors.length - 3} more`);
      failed++;
      errorList.push(
        `${file}: ${errors.length} error(s) — ${errors[0].message}`
      );
    } else if (warnings.length > 0) {
      console.log(`  ⚠ ${file} — ${warnings.length} warning(s)`);
      for (const w of warnings.slice(0, 2)) {
        console.log(`      [WARN] ${w.message}`);
      }
      warned++;
      warnList.push(`${file}: ${warnings.length} warning(s)`);
    } else if (!result.output) {
      console.log(`  ✗ ${file} — no compile output`);
      failed++;
      errorList.push(`${file}: compile returned no output`);
    } else {
      console.log(`  ✓ ${file}`);
      clean++;
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log(`  ✗ ${file} — ${msg.split('\n')[0]}`);
    failed++;
    errorList.push(`${file}: ${msg.split('\n')[0]}`);
  }
}

console.log(`\n${'='.repeat(60)}`);
console.log(
  `Results: ${clean} clean, ${warned} warnings, ${failed} errors out of ${files.length}`
);
if (warnList.length > 0) {
  console.log(`\nWarnings:`);
  for (const w of warnList) {
    console.log(`  ⚠ ${w}`);
  }
}
if (errorList.length > 0) {
  console.log(`\nErrors:`);
  for (const err of errorList) {
    console.log(`  ✗ ${err}`);
  }
}
console.log('');
