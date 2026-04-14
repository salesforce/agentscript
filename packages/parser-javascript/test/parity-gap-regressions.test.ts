/**
 * Parity gap regression tests: locks in the 7 fuzz-parity divergences fixed
 * by the bare-CR indentation reset and template-line hash guard (S04/T01).
 *
 * These inputs are the exact mutated sources produced by the fuzz-parity
 * engine (SEED=42) that previously caused both-valid-diverging results.
 * They contain bare \r and other control characters that cannot be reliably
 * stored in .txt corpus files (git/editors may normalise line endings), so
 * they live here as programmatic test cases.
 *
 * Each case asserts full s-expression parity between parser-js and tree-sitter.
 *
 * Remaining unfixed cases (3):
 *   1. actions.txt#19 — inline comment attached at different tree depth;
 *      tree-sitter nests the comment one level deeper than parser-js.
 *      Fixing requires changing comment-attachment heuristics with unclear
 *      correctness trade-offs.
 *   2. control_flow.txt#9 — leading tab on line 0 causes indentation
 *      disagreement on block nesting. Tabs-at-column-zero is an uncommon
 *      mutation where "correct" behaviour is debatable.
 *   3. template_comments.txt#2 — bare \r plus null byte in template context
 *      causes comment-line detection disagreement. A mutation-only edge case.
 *
 * Skips gracefully if tree-sitter native bindings are not available.
 */

import { describe, it, expect } from 'vitest';
import { parse as parseJS } from '../src/index.js';
import { normalizeSExp } from './test-utils.js';

// ── Dynamic tree-sitter loading ────────────────────────────────────

interface TreeSitterParser {
  parse(source: string): {
    rootNode: {
      toString(): string;
      hasError: boolean;
    };
  };
}

let treeSitterParser: TreeSitterParser | null = null;
let treeSitterAvailable = false;

try {
  const Parser = (await import('tree-sitter')).default;
  const AgentScript = (await import('@agentscript/parser-tree-sitter')).default;
  const parser = new Parser();
  parser.setLanguage(AgentScript as unknown as typeof parser.Language);
  treeSitterParser = parser as unknown as TreeSitterParser;
  treeSitterAvailable = true;
} catch {
  // tree-sitter native bindings not available — tests will be skipped
}

// ── Fixed divergence inputs (exact fuzz-parity mutations, SEED=42) ─

interface RegressionCase {
  /** Human-readable label for the test */
  name: string;
  /** Fuzz-parity key: seedName#iteration */
  key: string;
  /** Which fix resolved this: 'cr-indent-reset' or 'template-hash-guard' */
  fix: string;
  /** Exact mutated source (may contain \r, \0, etc.) */
  input: string;
}

const fixedCases: RegressionCase[] = [
  {
    name: 'CR in nested block with comment context',
    key: 'corpus/comments.txt#3',
    fix: 'cr-indent-reset',
    input:
      'topic test:\n   reasoning:\n       instructions: ->\n           set @variables.test = True\n       actions:\n           my_action: @actions.test\n\n#   after_reasoning:->\n#       transition to @topic.other\n\n   actions:\n#   Z  my_action:\n   \r    description: "test"',
  },
  {
    name: 'CR in logic set statement',
    key: 'corpus/logic.txt#11',
    fix: 'cr-indent-reset',
    input:
      'topic test:\n    afer_reasoninag:\n        \rset @variable.count = 0',
  },
  {
    name: 'CR in sequence with nested map',
    key: 'corpus/sequences.txt#4',
    fix: 'cr-indent-reset',
    input: 'hello:\n  - a: "hello"\n\r   b: 3\n    c: x\r== y\n    d: -3',
  },
  {
    name: 'CR in mapping with string value',
    key: 'parser-javascript/mapping_edge_cases.txt#10',
    fix: 'cr-indent-reset',
    input: 'config:\n   name: "hello["\n \r   count: 42\n   active: true',
  },
  {
    name: 'CR in deeply nested mapping',
    key: 'parser-javascript/sequence_edge_cases.txt#11',
    fix: 'cr-indent-reset',
    input: 'items:\n    -\n        nested:\n          \r  deep: "value"',
  },
  {
    name: 'CR in template multi-line content',
    key: 'parser-javascript/template_edge_cases.txt#8',
    fix: 'cr-indent-reset',
    input: 'confi:\n    message: |\n  \r      first li|ne\n\n        third lin',
  },
  {
    name: 'Hash treated as literal on template line',
    key: 'parser-javascript/template_edge_cases.txt#19',
    fix: 'template-hash-guard',
    input: 'config:\n    msg: |\n      #  Result: {!@utils.frmat(@data.value)}',
  },
];

// ── Test Suite ──────────────────────────────────────────────────────

describe.runIf(treeSitterAvailable)(
  'parity gap regressions (S04 fixes)',
  () => {
    for (const tc of fixedCases) {
      it(`${tc.name} [${tc.fix}] (${tc.key})`, () => {
        const jsResult = parseJS(tc.input);
        const tsTree = treeSitterParser!.parse(tc.input);

        const jsHasError = jsResult.rootNode.hasError;
        const tsHasError = tsTree.rootNode.hasError;

        // Both parsers must accept the input without errors
        expect(jsHasError).toBe(false);
        expect(tsHasError).toBe(false);

        // S-expressions must match exactly
        const jsSExp = normalizeSExp(jsResult.rootNode.toSExp());
        const tsSExp = normalizeSExp(tsTree.rootNode.toString());
        expect(jsSExp).toBe(tsSExp);
      });
    }
  }
);
