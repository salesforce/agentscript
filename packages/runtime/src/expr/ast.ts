/*
 * Copyright (c) 2026, Salesforce, Inc.
 * SPDX-License-Identifier: Apache-2.0
 */

export type ExprNode =
  | { kind: 'literal'; value: unknown }
  | { kind: 'ref'; path: string[] } // e.g. state.x, result.y, action.z
  | { kind: 'unary'; op: 'not' | '-'; arg: ExprNode }
  | { kind: 'binary'; op: BinOp; left: ExprNode; right: ExprNode }
  | { kind: 'call'; fn: string; args: ExprNode[] };

export type BinOp =
  | 'or'
  | 'and'
  | '=='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'is'
  | 'is not'
  | 'in'
  | 'not in'
  | '+'
  | '-'
  | '*'
  | '/'
  | '%';
