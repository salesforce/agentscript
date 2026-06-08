#!/usr/bin/env tsx

/**
 * Generate compiler outputs for all test scripts
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@agentscript/parser';
import { Dialect } from '@agentscript/language';
import { AgentforceSchema } from '@agentscript/agentforce-dialect';
import { compile } from '../dist/compile.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCRIPTS_DIR = path.resolve(__dirname, '../../test-scripts/scripts');
const OUTPUT_DIR = path.resolve(
  __dirname,
  '../test/outputs/module-agentscript'
);

function compileScript(scriptPath: string): unknown {
  const source = fs.readFileSync(scriptPath, 'utf-8');
  const { rootNode: root } = parse(source);
  const mappingNode =
    root.namedChildren.find(n => n.type === 'mapping') ?? root;

  const dialect = new Dialect();
  const result = dialect.parse(mappingNode, AgentforceSchema);

  if (!result.value) {
    throw new Error(`Failed to parse ${scriptPath}`);
  }

  return compile(result.value as Record<string, unknown>);
}

function main() {
  console.log('Generating compiler outputs...');
  console.log('='.repeat(80));
  console.log();

  if (!fs.existsSync(SCRIPTS_DIR)) {
    console.error(`❌ ERROR: Scripts directory not found: ${SCRIPTS_DIR}`);
    process.exit(1);
  }

  // Create output directory
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Get all .agent files (excluding .roundtrip.agent files)
  const scriptFiles = fs
    .readdirSync(SCRIPTS_DIR)
    .filter(f => f.endsWith('.agent') && !f.includes('.roundtrip.'))
    .sort();

  console.log(`Found ${scriptFiles.length} script files\n`);

  let successCount = 0;
  let errorCount = 0;

  for (const scriptFile of scriptFiles) {
    const scriptPath = path.join(SCRIPTS_DIR, scriptFile);
    const baseName = scriptFile.replace('.agent', '');
    const outputPath = path.join(OUTPUT_DIR, `${baseName}.agent.json`);

    try {
      const compiled = compileScript(scriptPath);
      fs.writeFileSync(
        outputPath,
        JSON.stringify(compiled.output, null, 2),
        'utf-8'
      );
      console.log(`✅ ${scriptFile}`);
      successCount++;
    } catch (error) {
      console.error(
        `❌ ${scriptFile}: ${error instanceof Error ? error.message : String(error)}`
      );
      errorCount++;
    }
  }

  console.log();
  console.log('='.repeat(80));
  console.log(`✅ Successfully compiled: ${successCount}`);
  console.log(`❌ Failed: ${errorCount}`);
  console.log();
  console.log(`Outputs saved to: ${OUTPUT_DIR}`);
}

main();
