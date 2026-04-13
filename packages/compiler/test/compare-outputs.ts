/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Compare compiler outputs between module-agentscript and agent-dsl.
 * Shows which scripts produce identical AgentJSON and highlights differences.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MODULE_DIR = path.resolve(__dirname, 'outputs', 'module-agentscript');
const AGENT_DSL_DIR = path.resolve(__dirname, 'outputs', 'agent-dsl');

interface ComparisonResult {
  scriptName: string;
  status:
    | 'identical'
    | 'different'
    | 'missing-module'
    | 'missing-agent-dsl'
    | 'both-missing';
  sizeDiff?: number;
  differences?: string[];
  cosmetics?: string[];
}

interface ComparisonDiffs {
  differences: string[];
  cosmetics: string[];
}

function compareJSON(obj1: any, obj2: any, path: string = ''): ComparisonDiffs {
  const diffs: string[] = [];
  const cosmetics: string[] = [];

  if (typeof obj1 !== typeof obj2) {
    diffs.push(`${path}: Type mismatch (${typeof obj1} vs ${typeof obj2})`);
    return { differences: diffs, cosmetics };
  }

  if (obj1 === null || obj2 === null) {
    if (obj1 !== obj2) {
      // If both keys exist but one is null and the other is not, that's a REAL difference
      // (not cosmetic - we're missing actual data)
      const val1Str = JSON.stringify(obj1);
      const val2Str = JSON.stringify(obj2);
      // Always store full values for CSV export
      diffs.push(
        `${path}: module-agentscript=${val1Str}, agent-dsl=${val2Str}`
      );
    }
    return { differences: diffs, cosmetics };
  }

  if (Array.isArray(obj1) && Array.isArray(obj2)) {
    if (obj1.length !== obj2.length) {
      diffs.push(
        `${path}: Array length mismatch (module-agentscript=${obj1.length}, agent-dsl=${obj2.length})`
      );
    }
    const minLen = Math.min(obj1.length, obj2.length);
    for (let i = 0; i < minLen; i++) {
      const result = compareJSON(obj1[i], obj2[i], `${path}[${i}]`);
      diffs.push(...result.differences);
      cosmetics.push(...result.cosmetics);
    }
    return { differences: diffs, cosmetics };
  }

  if (typeof obj1 === 'object' && typeof obj2 === 'object') {
    const keys1 = new Set(Object.keys(obj1));
    const keys2 = new Set(Object.keys(obj2));

    for (const key of keys1) {
      if (!keys2.has(key)) {
        const val1 = obj1[key];
        const val1Str = JSON.stringify(val1);
        // Treat null, undefined, empty arrays, and empty objects as cosmetic when omitted
        const isEmptyValue =
          val1 === null ||
          val1 === undefined ||
          (Array.isArray(val1) && val1.length === 0) ||
          (typeof val1 === 'object' &&
            val1 !== null &&
            !Array.isArray(val1) &&
            Object.keys(val1).length === 0);

        if (isEmptyValue) {
          cosmetics.push(
            `${path}.${key}: module-agentscript=${val1Str}, agent-dsl=omits field`
          );
        } else {
          // Always store full values for CSV export
          diffs.push(
            `${path}.${key}: module-agentscript=${val1Str}, agent-dsl=omits field`
          );
        }
      }
    }

    for (const key of keys2) {
      if (!keys1.has(key)) {
        const val2 = obj2[key];
        const val2Str = JSON.stringify(val2);
        // Treat null, undefined, empty arrays, and empty objects as cosmetic when omitted
        const isEmptyValue =
          val2 === null ||
          val2 === undefined ||
          (Array.isArray(val2) && val2.length === 0) ||
          (typeof val2 === 'object' &&
            val2 !== null &&
            !Array.isArray(val2) &&
            Object.keys(val2).length === 0);

        if (isEmptyValue) {
          cosmetics.push(
            `${path}.${key}: module-agentscript=omits field, agent-dsl=${val2Str}`
          );
        } else {
          // Always store full values for CSV export
          diffs.push(
            `${path}.${key}: module-agentscript=omits field, agent-dsl=${val2Str}`
          );
        }
      }
    }

    for (const key of keys1) {
      if (keys2.has(key)) {
        const result = compareJSON(
          obj1[key],
          obj2[key],
          path ? `${path}.${key}` : key
        );
        diffs.push(...result.differences);
        cosmetics.push(...result.cosmetics);
      }
    }

    return { differences: diffs, cosmetics };
  }

  if (obj1 !== obj2) {
    // Stringify for better readability of primitives
    const val1Str = JSON.stringify(obj1);
    const val2Str = JSON.stringify(obj2);

    // Treat label and description differences as cosmetic
    const isCosmetic = path.endsWith('.label') || path.endsWith('.description');

    // Always store full values for CSV export
    if (isCosmetic) {
      cosmetics.push(
        `${path}: module-agentscript=${val1Str}, agent-dsl=${val2Str}`
      );
    } else {
      diffs.push(
        `${path}: module-agentscript=${val1Str}, agent-dsl=${val2Str}`
      );
    }
  }

  return { differences: diffs, cosmetics };
}

function compareScript(scriptName: string): ComparisonResult {
  const baseName = scriptName.replace('.agent', '');

  const moduleFile = path.join(MODULE_DIR, `${baseName}.agent.json`);
  const agentDslFile = path.join(AGENT_DSL_DIR, `${baseName}.json`);

  const moduleExists = fs.existsSync(moduleFile);
  const agentDslExists = fs.existsSync(agentDslFile);

  if (!moduleExists && !agentDslExists) {
    return { scriptName, status: 'both-missing' };
  }

  if (!moduleExists) {
    return { scriptName, status: 'missing-module' };
  }

  if (!agentDslExists) {
    return { scriptName, status: 'missing-agent-dsl' };
  }

  const moduleJSON = JSON.parse(fs.readFileSync(moduleFile, 'utf-8'));
  const agentDslJSON = JSON.parse(fs.readFileSync(agentDslFile, 'utf-8'));

  const comparisonResult = compareJSON(moduleJSON, agentDslJSON);

  if (
    comparisonResult.differences.length === 0 &&
    comparisonResult.cosmetics.length === 0
  ) {
    return {
      scriptName,
      status: 'identical',
      sizeDiff: 0,
    };
  }

  const moduleSize = JSON.stringify(moduleJSON).length;
  const agentDslSize = JSON.stringify(agentDslJSON).length;

  return {
    scriptName,
    status: 'different',
    sizeDiff: moduleSize - agentDslSize,
    differences: comparisonResult.differences.slice(0, 20), // Limit to first 20 differences
    cosmetics: comparisonResult.cosmetics.slice(0, 20), // Limit to first 20 cosmetics
  };
}

function main() {
  console.log('AgentScript Compiler Comparison');
  console.log('module-agentscript vs agent-dsl');
  console.log('='.repeat(80));
  console.log();

  // Check if agent-dsl directory exists
  if (!fs.existsSync(AGENT_DSL_DIR)) {
    console.error(
      `❌ ERROR: agent-dsl output directory not found: ${AGENT_DSL_DIR}`
    );
    console.error();
    console.error(
      'To generate agent-dsl outputs, run the Python agent-dsl compiler.'
    );
    console.error('See: agent-dsl repo');
    process.exit(1);
  }

  // Get all scripts from both directories
  const moduleScripts = fs.existsSync(MODULE_DIR)
    ? fs
        .readdirSync(MODULE_DIR)
        .filter(f => f.endsWith('.agent.json'))
        .map(f => f.replace('.agent.json', ''))
    : [];

  const agentDslScripts = fs
    .readdirSync(AGENT_DSL_DIR)
    .filter(f => f.endsWith('.json') && !f.includes('.compile_errors.'))
    .map(f => f.replace('.json', ''));

  const allScripts = new Set([...moduleScripts, ...agentDslScripts]);
  const results: ComparisonResult[] = [];

  for (const script of Array.from(allScripts).sort()) {
    results.push(compareScript(script));
  }

  // Group and display results
  const identical = results.filter(r => r.status === 'identical');
  const different = results.filter(r => r.status === 'different');
  const missingModule = results.filter(r => r.status === 'missing-module');
  const missingAgentDsl = results.filter(r => r.status === 'missing-agent-dsl');

  console.log(`✅ IDENTICAL OUTPUTS (${identical.length} scripts):`);
  for (const result of identical) {
    console.log(`   - ${result.scriptName}`);
  }
  console.log();

  if (different.length > 0) {
    console.log(`⚠️  DIFFERENT OUTPUTS (${different.length} scripts):`);
    for (const result of different) {
      console.log(
        `   - ${result.scriptName} (size diff: ${result.sizeDiff} bytes)`
      );
      if (result.differences && result.differences.length > 0) {
        console.log(`     Real differences:`);
        for (const diff of result.differences.slice(0, 5)) {
          console.log(`       ${diff}`);
        }
        if (result.differences.length > 5) {
          console.log(`       ... and ${result.differences.length - 5} more`);
        }
      }
      if (result.cosmetics && result.cosmetics.length > 0) {
        console.log(`     Cosmetic differences (null field omissions):`);
        for (const cosmetic of result.cosmetics.slice(0, 3)) {
          console.log(`       ${cosmetic}`);
        }
        if (result.cosmetics.length > 3) {
          console.log(`       ... and ${result.cosmetics.length - 3} more`);
        }
      }
    }
    console.log();
  }

  if (missingModule.length > 0) {
    console.log(
      `❌ MISSING IN MODULE-AGENTSCRIPT (${missingModule.length} scripts):`
    );
    for (const result of missingModule) {
      console.log(`   - ${result.scriptName}`);
    }
    console.log();
  }

  if (missingAgentDsl.length > 0) {
    console.log(`❌ MISSING IN AGENT-DSL (${missingAgentDsl.length} scripts):`);
    for (const result of missingAgentDsl) {
      console.log(`   - ${result.scriptName}`);
    }
    console.log();
  }

  console.log('='.repeat(80));
  console.log(`SUMMARY:`);
  console.log(`  Total scripts compared: ${results.length}`);
  console.log(`  Identical: ${identical.length}`);
  console.log(`  Different: ${different.length}`);
  console.log(`  Missing in module-agentscript: ${missingModule.length}`);
  console.log(`  Missing in agent-dsl: ${missingAgentDsl.length}`);
  console.log();

  if (identical.length === results.length) {
    console.log(
      '🎉 ALL OUTPUTS ARE IDENTICAL! The compilers produce the same results.'
    );
  } else {
    console.log(
      `⚠️  ${different.length + missingModule.length + missingAgentDsl.length} scripts have differences or are missing.`
    );
  }

  // Save detailed comparison report
  const reportPath = path.resolve(
    __dirname,
    'outputs',
    'comparison-report-agentdsl.json'
  );
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`\nDetailed report saved to: ${reportPath}`);

  // Generate and save difference summary
  const allDiffs: string[] = [];
  const allCosmetics: string[] = [];
  for (const result of results) {
    if (result.differences) {
      allDiffs.push(...result.differences);
    }
    if (result.cosmetics) {
      allCosmetics.push(...result.cosmetics);
    }
  }

  // Count patterns for real differences
  const patternCounts = new Map<string, number>();
  for (const diff of allDiffs) {
    patternCounts.set(diff, (patternCounts.get(diff) || 0) + 1);
  }

  const topPatterns = Array.from(patternCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([pattern, count]) => ({ pattern, count }));

  // Count patterns for cosmetic differences
  const cosmeticPatternCounts = new Map<string, number>();
  for (const cosmetic of allCosmetics) {
    cosmeticPatternCounts.set(
      cosmetic,
      (cosmeticPatternCounts.get(cosmetic) || 0) + 1
    );
  }

  const topCosmeticPatterns = Array.from(cosmeticPatternCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([pattern, count]) => ({ pattern, count }));

  // Categorize differences
  const nullOmissions = allCosmetics.length; // All cosmetics are null omissions now
  const valueDifferences = allDiffs.filter(
    d => d.includes('module-agentscript=') && d.includes('agent-dsl=')
  ).length;
  const missingFields = allDiffs.filter(d => d.includes('omits field')).length;

  const summary = {
    timestamp: new Date().toISOString(),
    totalScripts: results.length,
    identical: identical.length,
    different: different.length,
    missingModule: missingModule.length,
    missingAgentDsl: missingAgentDsl.length,
    statistics: {
      totalDifferences: allDiffs.length,
      totalCosmetics: allCosmetics.length,
      nullOmissions,
      valueDifferences,
      missingFields,
    },
    topPatterns,
    topCosmeticPatterns,
  };

  const summaryPath = path.resolve(
    __dirname,
    'outputs',
    'comparison-summary-agentdsl.json'
  );
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');
  console.log(`Summary saved to: ${summaryPath}`);

  // Generate CSV export
  const csvPath = path.resolve(
    __dirname,
    'outputs',
    'comparison-report-agentdsl.csv'
  );
  const csvRows: string[] = [
    'script_name,status,type,field_name,module_agentscript,agent_dsl',
  ];

  for (const result of results) {
    // Skip identical scripts and missing scripts - only show actual differences
    if (
      result.status === 'identical' ||
      result.status === 'missing-module' ||
      result.status === 'missing-agent-dsl'
    ) {
      continue;
    } else {
      // Add real differences
      if (result.differences) {
        for (const diff of result.differences) {
          const match = diff.match(
            /^([^:]+): module-agentscript=(.+), agent-dsl=(.+)$/
          );
          if (match) {
            const field = match[1];
            let moduleVal = match[2];
            let agentDslVal = match[3];
            // Escape CSV special characters
            moduleVal =
              moduleVal.includes(',') || moduleVal.includes('"')
                ? `"${moduleVal.replace(/"/g, '""')}"`
                : moduleVal;
            agentDslVal =
              agentDslVal.includes(',') || agentDslVal.includes('"')
                ? `"${agentDslVal.replace(/"/g, '""')}"`
                : agentDslVal;
            csvRows.push(
              `${result.scriptName},different,difference,${field},${moduleVal},${agentDslVal}`
            );
          } else {
            // For diffs that don't match the pattern, just include the diff text
            const escapedDiff =
              diff.includes(',') || diff.includes('"')
                ? `"${diff.replace(/"/g, '""')}"`
                : diff;
            csvRows.push(
              `${result.scriptName},different,difference,${escapedDiff},,`
            );
          }
        }
      }
      // Add cosmetic differences
      if (result.cosmetics) {
        for (const cosmetic of result.cosmetics) {
          const match = cosmetic.match(
            /^([^:]+): module-agentscript=(.+), agent-dsl=(.+)$/
          );
          if (match) {
            const field = match[1];
            let moduleVal = match[2];
            let agentDslVal = match[3];
            // Escape CSV special characters
            moduleVal =
              moduleVal.includes(',') || moduleVal.includes('"')
                ? `"${moduleVal.replace(/"/g, '""')}"`
                : moduleVal;
            agentDslVal =
              agentDslVal.includes(',') || agentDslVal.includes('"')
                ? `"${agentDslVal.replace(/"/g, '""')}"`
                : agentDslVal;
            csvRows.push(
              `${result.scriptName},different,cosmetic,${field},${moduleVal},${agentDslVal}`
            );
          } else {
            // For cosmetics that don't match the pattern
            const escapedCosmetic =
              cosmetic.includes(',') || cosmetic.includes('"')
                ? `"${cosmetic.replace(/"/g, '""')}"`
                : cosmetic;
            csvRows.push(
              `${result.scriptName},different,cosmetic,${escapedCosmetic},,`
            );
          }
        }
      }
    }
  }

  fs.writeFileSync(csvPath, csvRows.join('\n'), 'utf-8');
  console.log(`CSV export saved to: ${csvPath}`);
}

main();
