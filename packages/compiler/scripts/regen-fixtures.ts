#!/usr/bin/env tsx

/**
 * Regenerate the expected YAML fixtures used by `test/compare-all.test.ts`.
 *
 * The fixture pair list is imported directly from the test file, so the script
 * and the test stay in sync.
 *
 * Use this whenever a deliberate compiler-output change makes the parity test
 * fail. The point is reproducibility: anyone running this gets the same output,
 * so review diffs are bounded to what actually changed (no key-ordering or
 * line-wrap drift from hand-edits).
 *
 * Usage: `pnpm fixtures:regen`
 *
 * NOTE: this writes whatever the current compiler produces. If the compiler is
 * buggy, the fixtures will encode the bug. Inspect the diff before committing.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify as yamlStringify } from 'yaml';
import { parse } from '@agentscript/parser';
import { Dialect } from '@agentscript/language';
import { AgentforceSchema } from '@agentscript/agentforce-dialect';
import { DiagnosticSeverity } from '@agentscript/types';
import { compile } from '../src/compile.js';
import { toParsedAgentforce } from '../test/test-utils.js';
import { FIXTURE_PAIRS } from '../test/fixture-pairs.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCRIPTS_DIR = path.resolve(__dirname, '../test/fixtures/scripts');
const EXPECTED_DIR = path.resolve(__dirname, '../test/fixtures/expected');

function regenOne(agentFile: string, yamlFile: string): 'updated' | 'skipped' {
  const agentPath = path.join(SCRIPTS_DIR, agentFile);
  const expectedPath = path.join(EXPECTED_DIR, yamlFile);
  if (!fs.existsSync(agentPath)) {
    console.warn(`SKIP ${agentFile}: source file not found`);
    return 'skipped';
  }
  const source = fs.readFileSync(agentPath, 'utf-8');
  const { rootNode: root } = parse(source);
  const mappingNode =
    root.namedChildren.find(n => n.type === 'mapping') ?? root;
  const dialect = new Dialect();
  const dialectResult = dialect.parse(mappingNode, AgentforceSchema);
  if (!dialectResult.value) {
    console.warn(`SKIP ${agentFile}: dialect parse produced no value`);
    return 'skipped';
  }
  const compiled = compile(toParsedAgentforce(dialectResult.value));
  const errs = compiled.diagnostics.filter(
    d => d.severity === DiagnosticSeverity.Error
  );
  if (errs.length > 0) {
    console.warn(
      `SKIP ${agentFile}: ${errs.length} compile error(s)\n` +
        errs.map(e => `    ${e.message}`).join('\n')
    );
    return 'skipped';
  }
  fs.writeFileSync(expectedPath, yamlStringify(compiled.output), 'utf-8');
  return 'updated';
}

function main(): void {
  console.log(`Regenerating ${FIXTURE_PAIRS.length} fixtures...`);
  let updated = 0;
  let skipped = 0;
  for (const [agent, yaml] of FIXTURE_PAIRS) {
    if (regenOne(agent, yaml) === 'updated') updated++;
    else skipped++;
  }
  console.log(`\nUpdated: ${updated}, Skipped: ${skipped}`);
}

main();
