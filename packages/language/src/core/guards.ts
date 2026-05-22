/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Type guard functions using `instanceof` for Expression and Statement classes.
 *
 * Prefer these guards over manual `__kind` checks + casts -- they narrow the
 * type in a single call and are resilient to string literal typos.
 */

import { isAstNodeLike } from './types.js';
import {
  TemplateText,
  TemplateInterpolation,
  MemberExpression,
  Identifier,
  StringLiteral,
  SubscriptExpression,
  AtIdentifier,
} from './expressions.js';

import { IfStatement, TransitionStatement, ToClause } from './statements.js';
import type { SetClause, WithClause } from './statements.js';

// ── Expression guards ────────────────────────────────────────────────

export function isTemplateText(node: unknown): node is TemplateText {
  return node instanceof TemplateText;
}

export function isTemplateInterpolation(
  node: unknown
): node is TemplateInterpolation {
  return node instanceof TemplateInterpolation;
}

export function isMemberExpression(node: unknown): node is MemberExpression {
  return node instanceof MemberExpression;
}

export function isIdentifier(node: unknown): node is Identifier {
  return node instanceof Identifier;
}

export function isStringLiteral(node: unknown): node is StringLiteral {
  return node instanceof StringLiteral;
}

export function isSubscriptExpression(
  node: unknown
): node is SubscriptExpression {
  return node instanceof SubscriptExpression;
}

export function isAtIdentifier(node: unknown): node is AtIdentifier {
  return node instanceof AtIdentifier;
}

// ── Statement guards ─────────────────────────────────────────────────

export function isIfStatement(node: unknown): node is IfStatement {
  return node instanceof IfStatement;
}

export function isTransitionStatement(
  node: unknown
): node is TransitionStatement {
  return node instanceof TransitionStatement;
}

export function isToClause(node: unknown): node is ToClause {
  return node instanceof ToClause;
}

export function isSetClause(node: unknown): node is SetClause {
  return isAstNodeLike(node) && node.__kind === 'SetClause';
}

export function isWithClause(node: unknown): node is WithClause {
  return isAstNodeLike(node) && node.__kind === 'WithClause';
}
