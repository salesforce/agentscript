/**
 * Performance benchmarks for @agentscript/parser-javascript.
 *
 * Run with: pnpm vitest bench
 *
 * Uses vitest's built-in bench() API. Each benchmark reports ops/sec,
 * mean time, and min/max/p95.
 */

import { describe, bench, beforeAll } from 'vitest';
import { parse, parseAndHighlight } from '../src/index.js';
import { Lexer } from '../src/lexer.js';
import {
  generateFlatMappings,
  generateDeepNesting,
  generateWideMappings,
  generateChainedExpression,
  generateNestedParens,
  generateMixedPrecedence,
  generateLargeString,
  generateEscapeHeavyStrings,
  generateTemplateHeavy,
  generateErrorHeavy,
  generateGarbageInput,
  generateUnclosedDelimiters,
  generateLargeSequence,
  generateProcedureHeavy,
  generateRealisticAgent,
} from './perf-generators.js';

// ---------------------------------------------------------------------------
// Helper: lex-only (isolate lexer cost)
// ---------------------------------------------------------------------------

function lexOnly(source: string): void {
  const lexer = new Lexer(source);
  lexer.tokenize();
}

// ---------------------------------------------------------------------------
// 1. File size scaling — flat mappings
// ---------------------------------------------------------------------------

describe('File size scaling (flat mappings)', () => {
  const inputs = new Map<string, string>();

  beforeAll(() => {
    for (const n of [100, 1_000, 10_000, 50_000]) {
      inputs.set(`${n} lines`, generateFlatMappings(n));
    }
  });

  for (const n of [100, 1_000, 10_000, 50_000]) {
    bench(`parse ${n} lines`, () => {
      parse(inputs.get(`${n} lines`)!);
    });
  }

  for (const n of [100, 1_000, 10_000, 50_000]) {
    bench(`lex-only ${n} lines`, () => {
      lexOnly(inputs.get(`${n} lines`)!);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Deep nesting
// ---------------------------------------------------------------------------

describe('Deep nesting', () => {
  const inputs = new Map<string, string>();

  beforeAll(() => {
    for (const depth of [50, 100, 200, 500]) {
      inputs.set(`${depth}`, generateDeepNesting(depth));
    }
  });

  for (const depth of [50, 100, 200, 500]) {
    bench(`parse depth=${depth}`, () => {
      parse(inputs.get(`${depth}`)!);
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Wide mappings
// ---------------------------------------------------------------------------

describe('Wide mappings (sibling keys)', () => {
  const inputs = new Map<string, string>();

  beforeAll(() => {
    for (const n of [1_000, 5_000, 10_000, 50_000]) {
      inputs.set(`${n}`, generateWideMappings(n));
    }
  });

  for (const n of [1_000, 5_000, 10_000, 50_000]) {
    bench(`parse ${n} keys`, () => {
      parse(inputs.get(`${n}`)!);
    });
  }
});

// ---------------------------------------------------------------------------
// 4. Complex expressions
// ---------------------------------------------------------------------------

describe('Chained expressions (a + b + c + ...)', () => {
  const inputs = new Map<string, string>();

  beforeAll(() => {
    for (const n of [100, 500, 1_000, 5_000]) {
      inputs.set(`${n}`, generateChainedExpression(n));
    }
  });

  for (const n of [100, 500, 1_000, 5_000]) {
    bench(`parse ${n} terms`, () => {
      parse(inputs.get(`${n}`)!);
    });
  }
});

describe('Nested parentheses', () => {
  const inputs = new Map<string, string>();

  beforeAll(() => {
    for (const depth of [50, 100, 200, 500]) {
      inputs.set(`${depth}`, generateNestedParens(depth));
    }
  });

  for (const depth of [50, 100, 200, 500]) {
    bench(`parse depth=${depth}`, () => {
      parse(inputs.get(`${depth}`)!);
    });
  }
});

describe('Mixed precedence expressions', () => {
  const inputs = new Map<string, string>();

  beforeAll(() => {
    for (const n of [100, 500, 1_000, 5_000]) {
      inputs.set(`${n}`, generateMixedPrecedence(n));
    }
  });

  for (const n of [100, 500, 1_000, 5_000]) {
    bench(`parse ${n} terms`, () => {
      parse(inputs.get(`${n}`)!);
    });
  }
});

// ---------------------------------------------------------------------------
// 5. Strings and templates
// ---------------------------------------------------------------------------

describe('Large string literals', () => {
  const inputs = new Map<string, string>();

  beforeAll(() => {
    for (const len of [1_000, 10_000, 100_000, 1_000_000]) {
      inputs.set(`${len}`, generateLargeString(len));
    }
  });

  for (const len of [1_000, 10_000, 100_000, 1_000_000]) {
    bench(`parse ${(len / 1000).toFixed(0)}K char string`, () => {
      parse(inputs.get(`${len}`)!);
    });
  }
});

describe('Escape-heavy strings', () => {
  const inputs = new Map<string, string>();

  beforeAll(() => {
    for (const n of [100, 500, 1_000, 5_000]) {
      inputs.set(`${n}`, generateEscapeHeavyStrings(n));
    }
  });

  for (const n of [100, 500, 1_000, 5_000]) {
    bench(`parse ${n} strings`, () => {
      parse(inputs.get(`${n}`)!);
    });
  }
});

describe('Template interpolations', () => {
  const inputs = new Map<string, string>();

  beforeAll(() => {
    for (const n of [50, 200, 500, 1_000]) {
      inputs.set(`${n}`, generateTemplateHeavy(n));
    }
  });

  for (const n of [50, 200, 500, 1_000]) {
    bench(`parse ${n} interpolations`, () => {
      parse(inputs.get(`${n}`)!);
    });
  }
});

// ---------------------------------------------------------------------------
// 6. Error recovery stress
// ---------------------------------------------------------------------------

describe('Error recovery — alternating valid/invalid', () => {
  const inputs = new Map<string, string>();

  beforeAll(() => {
    for (const n of [100, 1_000, 5_000, 10_000]) {
      inputs.set(`${n}`, generateErrorHeavy(n));
    }
  });

  for (const n of [100, 1_000, 5_000, 10_000]) {
    bench(`parse ${n} lines (50% errors)`, () => {
      parse(inputs.get(`${n}`)!);
    });
  }
});

describe('Error recovery — garbage input', () => {
  const inputs = new Map<string, string>();

  beforeAll(() => {
    for (const bytes of [1_000, 10_000, 50_000]) {
      inputs.set(`${bytes}`, generateGarbageInput(bytes));
    }
  });

  for (const bytes of [1_000, 10_000, 50_000]) {
    bench(`parse ${(bytes / 1000).toFixed(0)}K bytes garbage`, () => {
      parse(inputs.get(`${bytes}`)!);
    });
  }
});

describe('Error recovery — unclosed delimiters', () => {
  const inputs = new Map<string, string>();

  beforeAll(() => {
    for (const n of [100, 500, 1_000]) {
      inputs.set(`${n}`, generateUnclosedDelimiters(n));
    }
  });

  for (const n of [100, 500, 1_000]) {
    bench(`parse ${n} unclosed parens`, () => {
      parse(inputs.get(`${n}`)!);
    });
  }
});

// ---------------------------------------------------------------------------
// 7. Large sequences
// ---------------------------------------------------------------------------

describe('Large sequences', () => {
  const inputs = new Map<string, string>();

  beforeAll(() => {
    for (const n of [1_000, 10_000, 50_000]) {
      inputs.set(`${n}`, generateLargeSequence(n));
    }
  });

  for (const n of [1_000, 10_000, 50_000]) {
    bench(`parse ${n} items`, () => {
      parse(inputs.get(`${n}`)!);
    });
  }
});

// ---------------------------------------------------------------------------
// 8. Procedure-heavy input
// ---------------------------------------------------------------------------

describe('Procedure-heavy (if/run/set)', () => {
  const inputs = new Map<string, string>();

  beforeAll(() => {
    for (const n of [100, 500, 1_000, 5_000]) {
      inputs.set(`${n}`, generateProcedureHeavy(n));
    }
  });

  for (const n of [100, 500, 1_000, 5_000]) {
    bench(`parse ${n} statements`, () => {
      parse(inputs.get(`${n}`)!);
    });
  }
});

// ---------------------------------------------------------------------------
// 9. Highlighting overhead
// ---------------------------------------------------------------------------

describe('Highlighting overhead', () => {
  const inputs = new Map<string, string>();

  beforeAll(() => {
    for (const n of [100, 1_000, 5_000]) {
      inputs.set(`${n}`, generateRealisticAgent(n));
    }
  });

  for (const n of [100, 1_000, 5_000]) {
    bench(`parse-only ${n} lines`, () => {
      parse(inputs.get(`${n}`)!);
    });

    bench(`parse+highlight ${n} lines`, () => {
      parseAndHighlight(inputs.get(`${n}`)!);
    });
  }
});

// ---------------------------------------------------------------------------
// 10. Realistic workloads
// ---------------------------------------------------------------------------

describe('Realistic agent files', () => {
  const inputs = new Map<string, string>();

  beforeAll(() => {
    for (const n of [50, 500, 5_000, 50_000]) {
      inputs.set(`${n}`, generateRealisticAgent(n));
    }
  });

  for (const n of [50, 500, 5_000, 50_000]) {
    bench(`parse ${n} lines`, () => {
      parse(inputs.get(`${n}`)!);
    });
  }

  // Lexer-only comparison for realistic input
  for (const n of [500, 5_000, 50_000]) {
    bench(`lex-only ${n} lines`, () => {
      lexOnly(inputs.get(`${n}`)!);
    });
  }
});
