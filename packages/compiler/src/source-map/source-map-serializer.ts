import {
  GenMapping,
  addMapping,
  setSourceContent,
  toEncodedMap,
} from '@jridgewell/gen-mapping';
import type { EncodedSourceMap } from '@jridgewell/gen-mapping';
import type { Range } from '@agentscript/types';

export interface SerializeOptions {
  /** Original source file path (goes into sources[]) */
  sourcePath: string;
  /** Original source text (goes into sourcesContent[]) */
  sourceContent: string;
  /** Output file name (goes into source map "file" field) */
  file?: string;
  /** JSON indentation (default: 2) */
  indent?: number;
}

export interface SerializeResult {
  /** The serialized JSON string */
  json: string;
  /** Standard Source Map V3 */
  sourceMap: EncodedSourceMap;
}

/**
 * Range map type: (output object, property key) → source Range.
 * Populated by CompilerContext.track(), read by the serializer.
 */
export type RangeMap = WeakMap<object, Map<string, Range>>;

/**
 * Custom JSON serializer that writes JSON output while simultaneously
 * building a standard Source Map V3.
 *
 * Ranges come from the range map (populated by ctx.track()).
 * Each mapped property becomes a V3 mapping entry with the JSON path as name.
 */
export function serializeWithSourceMap(
  output: unknown,
  ranges: RangeMap,
  options: SerializeOptions
): SerializeResult {
  const { sourcePath, sourceContent, file, indent = 2 } = options;

  const map = new GenMapping({ file: file ?? '' });
  setSourceContent(map, sourcePath, sourceContent);

  let genLine = 1;
  let genCol = 0;
  const chunks: string[] = [];

  const pathSegments: string[] = [];

  function currentPath(): string {
    return pathSegments.join('.');
  }

  function write(str: string): void {
    for (const ch of str) {
      if (ch === '\n') {
        genLine++;
        genCol = 0;
      } else {
        genCol++;
      }
    }
    chunks.push(str);
  }

  function emitMapping(
    originalLine: number,
    originalColumn: number,
    name?: string
  ): void {
    if (name) {
      addMapping(map, {
        generated: { line: genLine, column: genCol },
        source: sourcePath,
        original: { line: originalLine + 1, column: originalColumn },
        name,
      });
    } else {
      addMapping(map, {
        generated: { line: genLine, column: genCol },
        source: sourcePath,
        original: { line: originalLine + 1, column: originalColumn },
      });
    }
  }

  function serializeValue(value: unknown, currentIndent: number): void {
    if (value === null || value === undefined) {
      write('null');
      return;
    }
    if (typeof value === 'string') {
      write(JSON.stringify(value));
      return;
    }
    if (typeof value === 'number') {
      write(JSON.stringify(value));
      return;
    }
    if (typeof value === 'boolean') {
      write(value ? 'true' : 'false');
      return;
    }
    if (Array.isArray(value)) {
      serializeArray(value, currentIndent);
      return;
    }
    if (typeof value === 'object') {
      serializeObject(value as Record<string, unknown>, currentIndent);
      return;
    }
    write(JSON.stringify(value));
  }

  function serializeArray(arr: unknown[], currentIndent: number): void {
    if (arr.length === 0) {
      write('[]');
      return;
    }
    write('[\n');
    const childIndent = currentIndent + indent;
    for (let i = 0; i < arr.length; i++) {
      pathSegments.push(`[${i}]`);
      write(' '.repeat(childIndent));
      serializeValue(arr[i], childIndent);
      pathSegments.pop();
      if (i < arr.length - 1) write(',');
      write('\n');
    }
    write(' '.repeat(currentIndent) + ']');
  }

  function serializeObject(
    obj: Record<string, unknown>,
    currentIndent: number
  ): void {
    const keys = Object.keys(obj);
    if (keys.length === 0) {
      write('{}');
      return;
    }
    write('{\n');
    const childIndent = currentIndent + indent;
    const objRanges = ranges.get(obj);

    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      const val = obj[key];

      pathSegments.push(key);

      write(' '.repeat(childIndent));

      // Emit V3 mapping if this property has a tracked range
      const range = objRanges?.get(key);
      if (range) {
        emitMapping(range.start.line, range.start.character, currentPath());
      }

      write(JSON.stringify(key));
      write(': ');
      serializeValue(val, childIndent);

      pathSegments.pop();

      if (i < keys.length - 1) write(',');
      write('\n');
    }

    write(' '.repeat(currentIndent) + '}');
  }

  serializeValue(output, 0);

  return {
    json: chunks.join(''),
    sourceMap: toEncodedMap(map),
  };
}
