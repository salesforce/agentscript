import type { SyntaxNode } from './syntax-node.js';

export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export function toRange(node: SyntaxNode): Range {
  return {
    start: {
      line: node.startRow,
      character: node.startCol,
    },
    end: { line: node.endRow, character: node.endCol },
  };
}
