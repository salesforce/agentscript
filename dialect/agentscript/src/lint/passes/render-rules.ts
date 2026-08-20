/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Validates render rule syntax on reasoning actions:
 * - Error when the `when` block's reference is not `@connection.<surface>`.
 * - Error when a `when @connection.X` block has no `render:` clause.
 * - Error when a `render:` clause appears outside a `when` block.
 * - Error when a `show_and_return:` clause appears outside a `render:` body.
 * - Error when a `when` body has more than one `render:` clause.
 * - Error when two `when @connection.X` blocks under the same action target the
 *   same connection (a connection may have at most one render rule per action).
 * - Error when a `render:` body has more than one `show_and_return:` clause.
 * - Error when `render:` value is not `@response_formats.<name>` or
 *   `@connection.<X>.response_formats.<name>`.
 * - Error when a longform format ref names a different connection than the
 *   enclosing `when @connection.X:`.
 * - Error when a format ref names a response_format that is neither a
 *   reserved built-in name (`json`) nor declared in the enclosing
 *   connection's `response_formats:` sub-map.
 * - Error when a connection declares a `response_formats:` entry using a
 *   reserved built-in name (e.g. `json`).
 * - Error when `show_and_return:` value is not a boolean literal.
 *
 * Diagnostic codes:
 *   render-rule-empty-when (Error)
 *   render-outside-when (Error)
 *   show-and-return-outside-render (Error)
 *   render-rule-multiple-render (Error)
 *   render-rule-duplicate-connection (Error)
 *   render-rule-multiple-show-and-return (Error)
 *   when-non-connection-ref (Error)
 *   render-rule-invalid-format-ref (Error)
 *   render-rule-format-not-in-connection (Error)
 *   render-rule-format-connection-mismatch (Error)
 *   render-rule-show-and-return-not-bool (Error)
 *   response-format-reserved-name (Error)
 */

/**
 * Reserved built-in response-format names — always resolvable under
 * `@response_formats.<name>` regardless of what the enclosing connection
 * declares, and forbidden as user-declared `response_formats:` entry names.
 * Kept in sync with the compiler's `BUILT_IN_RESPONSE_FORMATS`.
 */
const RESERVED_RESPONSE_FORMAT_NAMES = new Set(['json']);

import type {
  AstNodeLike,
  AstRoot,
  LintPass,
  NamedMap,
  PassStore,
} from '@agentscript/language';
import type { CstMeta } from '@agentscript/types';
import {
  defineRule,
  each,
  attachDiagnostic,
  constraintValidationKey,
  lintDiagnostic,
  decomposeAtMemberChain,
  isAstNodeLike,
  isNamedMap,
  recurseAstChildren,
  resolveNamespaceKeys,
  schemaContextKey,
  storeKey,
} from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import { reasoningActionsKey } from './reasoning-actions.js';

type StmtNode = Record<string, unknown>;

/**
 * Index of connection-scoped response_format names — populated per document by
 * {@link connectionFormatsAnalyzer}. Keys are connection names (as authored in
 * `connection <name>:`); values are the ordered list of response_format names
 * declared in that connection's `response_formats:` sub-map.
 *
 * Empty when the active schema has no `connection` namespace (e.g. pure
 * agentscript). The render-rules pass treats an empty map as "unknown" and
 * skips ownership checks — mirrors the reasoning-actions analyzer pattern.
 *
 * Ordering matters: the empty-`when` render-rule fallback uses the first
 * element to name the concrete format that will be used at runtime.
 */
export const connectionFormatsIndexKey = storeKey<Map<string, string[]>>(
  'connection-formats-index'
);

class ConnectionFormatsAnalyzer implements LintPass {
  readonly id = connectionFormatsIndexKey;
  readonly description =
    'Indexes each connection’s response_formats sub-map for render-rule ownership checks';

  finalize(store: PassStore, root: AstRoot): void {
    const ctx = store.get(schemaContextKey);
    if (!ctx) return;

    const index = new Map<string, string[]>();
    const rootObj = root as AstNodeLike;
    const connectionKeys = resolveNamespaceKeys('connection', ctx);

    for (const key of connectionKeys) {
      const connections = rootObj[key];
      if (!isNamedMap(connections)) continue;
      for (const [connName, block] of connections as NamedMap<unknown>) {
        if (!block || typeof block !== 'object') continue;
        const formats = (block as AstNodeLike).response_formats;
        const names: string[] = [];
        if (isNamedMap(formats)) {
          for (const [
            formatName,
            formatBlock,
          ] of formats as NamedMap<unknown>) {
            names.push(formatName);
            if (RESERVED_RESPONSE_FORMAT_NAMES.has(formatName)) {
              const range = rangeOf(formatBlock);
              if (range) {
                attachDiagnostic(
                  formatBlock as AstNodeLike,
                  lintDiagnostic(
                    range,
                    `'${formatName}' is a reserved built-in response format name and cannot be declared as a user response format`,
                    DiagnosticSeverity.Error,
                    'response-format-reserved-name'
                  )
                );
              }
            }
          }
        }
        index.set(connName, names);
      }
    }

    store.set(connectionFormatsIndexKey, index);
  }
}

export function connectionFormatsAnalyzer(): LintPass {
  return new ConnectionFormatsAnalyzer();
}

function isKind(stmt: unknown, kind: string): stmt is StmtNode {
  return (
    typeof stmt === 'object' &&
    stmt !== null &&
    (stmt as { __kind?: string }).__kind === kind
  );
}

function rangeOf(stmt: unknown): CstMeta['range'] | undefined {
  const cst = (stmt as { __cst?: CstMeta } | null)?.__cst;
  return cst?.range;
}

/**
 * A normalized format reference parsed from a `render:` value.
 * `connection` is set only for the longform `@connection.X.response_formats.Y`;
 * shortform refs (`@response_formats.Y`) leave it undefined and rely on the
 * enclosing `when @connection.X:` for scope.
 */
interface ParsedFormatRef {
  connection: string | undefined;
  name: string;
}

function parseFormatRef(expr: unknown): ParsedFormatRef | null {
  const chain = decomposeAtMemberChain(expr);
  if (!chain) return null;
  const { namespace, path } = chain;

  if (namespace === 'response_formats' && path.length === 1) {
    return { connection: undefined, name: path[0] };
  }
  // @connection.<X>.response_formats.<Y>
  if (
    namespace === 'connection' &&
    path.length === 3 &&
    path[1] === 'response_formats'
  ) {
    return { connection: path[0], name: path[2] };
  }
  return null;
}

export function renderRulesRule(): LintPass {
  return defineRule({
    id: 'render-rules',
    description:
      'Validates render: and show_and_return: clauses on reasoning actions',
    deps: {
      entry: each(reasoningActionsKey),
      connectionFormats: connectionFormatsIndexKey,
    },

    run({ entry, connectionFormats }) {
      const { statements } = entry;
      if (!statements) return;

      // Track which connections already have a `when @connection.X` block
      const seenConnections = new Set<string>();

      for (const stmt of statements) {
        if (isKind(stmt, 'RenderStatement')) {
          const range = rangeOf(stmt);
          if (range) {
            attachDiagnostic(
              stmt,
              lintDiagnostic(
                range,
                "render can only be used within a 'when @connection.<surface>' block",
                DiagnosticSeverity.Error,
                'render-outside-when'
              )
            );
          }
          continue;
        }

        if (isKind(stmt, 'ShowAndReturnStatement')) {
          const range = rangeOf(stmt);
          if (range) {
            attachDiagnostic(
              stmt,
              lintDiagnostic(
                range,
                "'show_and_return:' must appear nested inside a 'render:' clause",
                DiagnosticSeverity.Error,
                'show-and-return-outside-render'
              )
            );
          }
          continue;
        }

        if (!isKind(stmt, 'WhenStatement')) continue;

        // Enforce that the `when` block's subject is `@connection.<surface>`.
        // Accept only a single-level `@connection.<name>` — nested chains here
        // are ill-formed as a when-subject.
        const subject = (stmt as { subject?: unknown }).subject;
        const subjectChain = subject
          ? decomposeAtMemberChain(subject as never)
          : null;
        const whenConnection =
          subjectChain &&
          subjectChain.namespace === 'connection' &&
          subjectChain.path.length === 1
            ? subjectChain.path[0]
            : undefined;
        if (!whenConnection) {
          const refRange = rangeOf(subject) ?? rangeOf(stmt);
          if (refRange) {
            attachDiagnostic(
              stmt,
              lintDiagnostic(
                refRange,
                "'when' block reference must be '@connection.<surface>' (e.g. '@connection.messaging')",
                DiagnosticSeverity.Error,
                'when-non-connection-ref'
              )
            );
          }
          // Skip further checks — the shape is already broken.
          continue;
        }

        // A connection may have at most one render rule per action. Flag every
        // `when @connection.X` block after the first. Do not `continue` — the
        // block still runs through the checks below so independent authoring
        // errors (missing/duplicate `render:`, bad format ref, bad
        // `show_and_return:`)
        // are reported alongside the duplicate, not hidden by it.
        if (seenConnections.has(whenConnection)) {
          const refRange = rangeOf(subject) ?? rangeOf(stmt);
          if (refRange) {
            attachDiagnostic(
              stmt,
              lintDiagnostic(
                refRange,
                `Duplicate when context: '${whenConnection}'`,
                DiagnosticSeverity.Error,
                'render-rule-duplicate-connection'
              )
            );
          }
        }
        seenConnections.add(whenConnection);

        const body = (stmt as { body?: unknown[] }).body ?? [];
        const renderStmts = body.filter(s => isKind(s, 'RenderStatement'));

        // Any `show_and_return:` sibling directly under `when` (i.e. not nested
        // inside a `render:`) is invalid — flag every such statement.
        const strayShowAndReturns = body.filter(s =>
          isKind(s, 'ShowAndReturnStatement')
        );
        for (const stray of strayShowAndReturns) {
          const range = rangeOf(stray);
          if (range) {
            attachDiagnostic(
              stray,
              lintDiagnostic(
                range,
                "'show_and_return:' must appear nested inside a 'render:' clause",
                DiagnosticSeverity.Error,
                'show-and-return-outside-render'
              )
            );
          }
        }

        if (renderStmts.length === 0) {
          const range = rangeOf(stmt);
          if (range) {
            attachDiagnostic(
              stmt,
              lintDiagnostic(
                range,
                `'when @connection.${whenConnection}' block requires a 'render:' clause`,
                DiagnosticSeverity.Error,
                'render-rule-empty-when'
              )
            );
          }
        } else if (renderStmts.length > 1) {
          for (const extra of renderStmts.slice(1)) {
            const range = rangeOf(extra);
            if (range) {
              attachDiagnostic(
                extra,
                lintDiagnostic(
                  range,
                  "Only one 'render:' clause is allowed per 'when @connection.<surface>' block",
                  DiagnosticSeverity.Error,
                  'render-rule-multiple-render'
                )
              );
            }
          }
        }

        // Validate every `render:` body — each may contain at most one
        // `show_and_return:` clause. Sibling `show_and_return:` directly under
        // `when` is now caught by the top-level ShowAndReturnStatement branch
        // above.
        for (const render of renderStmts) {
          // Validate the render: value is a supported format reference.
          const renderValue = (render as { value?: unknown }).value;
          const parsed = renderValue ? parseFormatRef(renderValue) : null;
          const valueRange = rangeOf(renderValue) ?? rangeOf(render);

          if (!parsed) {
            if (valueRange) {
              attachDiagnostic(
                render,
                lintDiagnostic(
                  valueRange,
                  "'render:' value must be '@response_formats.<name>' or '@connection.<surface>.response_formats.<name>'",
                  DiagnosticSeverity.Error,
                  'render-rule-invalid-format-ref'
                )
              );
            }
          } else {
            // Longform must name the same connection as the enclosing `when`.
            if (
              parsed.connection !== undefined &&
              parsed.connection !== whenConnection
            ) {
              if (valueRange) {
                attachDiagnostic(
                  render,
                  lintDiagnostic(
                    valueRange,
                    `Response format '${parsed.name}' is not valid for connection '${whenConnection}'`,
                    DiagnosticSeverity.Error,
                    'render-rule-format-connection-mismatch'
                  )
                );
              }
            } else if (!RESERVED_RESPONSE_FORMAT_NAMES.has(parsed.name)) {
              // Ownership check: non-reserved names must live in this
              // connection's response_formats sub-map. Skipped when the index
              // has no entry for the connection (unknown/undefined connection
              // is flagged elsewhere by undefined-reference passes).
              const formats = connectionFormats.get(whenConnection);
              if (formats && !formats.includes(parsed.name)) {
                if (valueRange) {
                  attachDiagnostic(
                    render,
                    lintDiagnostic(
                      valueRange,
                      `Response format '${parsed.name}' is not valid for connection '${whenConnection}'`,
                      DiagnosticSeverity.Error,
                      'render-rule-format-not-in-connection'
                    )
                  );
                }
              }
            }
          }

          const renderBody =
            (render as { body?: unknown[] }).body ?? ([] as unknown[]);
          const showAndReturnStmts = renderBody.filter(s =>
            isKind(s, 'ShowAndReturnStatement')
          );
          if (showAndReturnStmts.length > 1) {
            for (const extra of showAndReturnStmts.slice(1)) {
              const range = rangeOf(extra);
              if (range) {
                attachDiagnostic(
                  extra,
                  lintDiagnostic(
                    range,
                    "Only one 'show_and_return:' clause is allowed per 'render:' body",
                    DiagnosticSeverity.Error,
                    'render-rule-multiple-show-and-return'
                  )
                );
              }
            }
          }

          // Validate each `show_and_return:` value is a boolean literal.
          for (const showAndReturn of showAndReturnStmts) {
            const showAndReturnValue = (showAndReturn as { value?: unknown })
              .value;
            const isBoolLiteral =
              typeof showAndReturnValue === 'object' &&
              showAndReturnValue !== null &&
              (showAndReturnValue as { __kind?: string }).__kind ===
                'BooleanLiteral';
            if (!isBoolLiteral) {
              const valueRange =
                rangeOf(showAndReturnValue) ?? rangeOf(showAndReturn);
              if (valueRange) {
                attachDiagnostic(
                  showAndReturn,
                  lintDiagnostic(
                    valueRange,
                    "'show_and_return:' value must be a boolean literal ('True' or 'False')",
                    DiagnosticSeverity.Error,
                    'render-rule-show-and-return-not-bool'
                  )
                );
              }
            }
          }
        }
      }
    },
  });
}

/**
 * Detects render:, show_and_return:, and when @connection statements that
 * appear outside a reasoning action body — e.g. at the top level of a script,
 * inside an if/else body, or inside a run: block. These are ill-formed
 * regardless of the surrounding action structure and would otherwise slip past
 * `renderRulesRule` (which only inspects the top-level statement list of each
 * reasoning action).
 *
 * Diagnostic codes:
 *   render-outside-when (Error) — for RenderStatement outside reasoning action
 *   show-and-return-outside-render (Error) — for ShowAndReturnStatement outside reasoning action
 *   when-connection-outside-action (Error) — for WhenStatement outside reasoning action
 */
class RenderRuleScopePass implements LintPass {
  readonly id = storeKey('render-rule-scope');
  readonly description =
    'Detects render/show_and_return/when-connection statements outside a reasoning action body';

  private stack: string[] = [];

  init(): void {
    this.stack = [];
  }

  enterNode(_key: string, value: unknown, _parent: unknown): void {
    if (!isAstNodeLike(value)) return;
    const kind = value.__kind;

    if (
      kind === 'RenderStatement' ||
      kind === 'ShowAndReturnStatement' ||
      kind === 'WhenStatement'
    ) {
      if (!this.isInsideReasoningAction()) {
        const range = (value.__cst as CstMeta | undefined)?.range;
        if (range) {
          const { message, code } = misplacedMessage(kind);
          attachDiagnostic(
            value,
            lintDiagnostic(range, message, DiagnosticSeverity.Error, code)
          );
        }
      }
    }

    this.stack.push(typeof kind === 'string' ? kind : '');
  }

  exitNode(_key: string, value: unknown, _parent: unknown): void {
    if (!isAstNodeLike(value)) return;
    this.stack.pop();
  }

  run(_store: PassStore, _root: AstRoot): void {
    // No-op — work happens during the walk.
  }

  /**
   * A statement is "inside a reasoning action" when we can walk up the ancestor
   * chain and reach a ReasoningActionBlock without crossing another
   * statement-scope boundary. WhenStatement and RenderStatement are
   * transparent — legitimate nested render/show_and_return statements live
   * inside them. Crossing an if/else/run/collect body means we're in a nested
   * conditional/action scope, which is not a valid location.
   */
  private isInsideReasoningAction(): boolean {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const kind = this.stack[i];
      if (kind === 'ReasoningActionBlock') return true;
      if (
        kind === 'IfStatement' ||
        kind === 'RunStatement' ||
        kind === 'CollectClause'
      ) {
        return false;
      }
      // WhenStatement and RenderStatement are transparent —
      // nested render:/show_and_return: statements inside them are legitimate.
    }
    return false;
  }
}

function misplacedMessage(kind: string): { message: string; code: string } {
  if (kind === 'RenderStatement') {
    return {
      message:
        "'render:' must appear inside a 'when @connection.<surface>' block within a reasoning action body",
      code: 'render-outside-when',
    };
  }
  if (kind === 'ShowAndReturnStatement') {
    return {
      message:
        "'show_and_return:' must appear nested inside a 'render:' clause within a reasoning action body",
      code: 'show-and-return-outside-render',
    };
  }
  return {
    message:
      "'when @connection.<surface>' must appear inside a reasoning action body",
    code: 'when-connection-outside-action',
  };
}

export function renderRuleScopePass(): LintPass {
  return new RenderRuleScopePass();
}

/**
 * `render:` clauses reference formats via two shapes:
 *   - `@response_formats.<name>`
 *   - `@connection.<surface>.response_formats.<name>`
 *
 * `response_formats` is a scoped namespace (via ResponseFormatBlock's
 * `scopeAlias`) that is not directly referenceable outside the block that
 * scopes it, so a bare `@response_formats.X` reference would otherwise trip
 * the `undefined-reference` pass with a "non-referenceable-scope" error. The
 * longform `@connection.X.response_formats.Y` chain likewise walks through
 * `response_formats`, which is not a top-level schema key, so it would trigger
 * an "unknown-property" chain diagnostic.
 *
 * Correctness of these references is checked structurally by
 * {@link renderRulesRule} (shape + ownership + reserved names) and by the
 * compiler (existence). This pass marks the reference expressions as
 * pre-validated so `undefinedReferencePass` skips them.
 *
 * Runs after `constraintValidationPass` (which publishes the `validatedRefs`
 * set) and before `undefinedReferencePass` (which reads it).
 */
class RenderTargetExemptionPass implements LintPass {
  readonly id = storeKey('render-target-exemption');
  readonly description =
    'Marks render: value expressions as pre-validated to avoid duplicate undefined-reference diagnostics';
  readonly requires = [constraintValidationKey];

  run(store: PassStore, root: AstRoot): void {
    const validatedRefs = store.get(constraintValidationKey);
    if (!validatedRefs) return;
    // Published as ReadonlySet, but the underlying set is mutable — this is
    // the same channel constraintValidationPass uses to record validations.
    const mutable = validatedRefs as Set<AstNodeLike>;
    walkForRenderTargets(root, mutable);
  }
}

function walkForRenderTargets(
  node: unknown,
  validatedRefs: Set<AstNodeLike>,
  visited: Set<unknown> = new Set()
): void {
  if (!node || typeof node !== 'object') return;
  if (visited.has(node)) return;
  visited.add(node);

  if (isAstNodeLike(node) && node.__kind === 'RenderStatement') {
    const value = (node as { value?: unknown }).value;
    if (isAstNodeLike(value)) {
      collectMemberChainNodes(value, validatedRefs);
    }
    return;
  }

  // Delegate to `recurseAstChildren` — the canonical traversal that reads
  // `__children` on blocks/sequences (where statements like RenderStatement
  // actually live) and falls back to `Object.entries` for expressions.
  recurseAstChildren(node, (_key, child) =>
    walkForRenderTargets(child, validatedRefs, visited)
  );
}

/**
 * Walk a MemberExpression chain and register every intermediate expression
 * node. `undefined-reference` inspects the leaf MemberExpression for shortform
 * refs (`@response_formats.X`) and the two-level tail for longform refs
 * (`@connection.messaging.response_formats.choices` → three levels), so
 * registering the whole chain covers both.
 */
function collectMemberChainNodes(
  expr: AstNodeLike,
  validatedRefs: Set<AstNodeLike>
): void {
  let current: unknown = expr;
  while (isAstNodeLike(current)) {
    validatedRefs.add(current);
    if (current.__kind !== 'MemberExpression') break;
    current = (current as { object?: unknown }).object;
  }
}

export function renderTargetExemptionPass(): LintPass {
  return new RenderTargetExemptionPass();
}
