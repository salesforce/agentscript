import type { SyntaxNode } from './syntax-node.js';
import type { Range } from './position.js';

export interface CstMeta {
  node: SyntaxNode;
  range: Range;
}
