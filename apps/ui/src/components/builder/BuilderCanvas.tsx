/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useCallback, useMemo } from 'react';
import { cn } from '~/lib/utils';
import type { FieldType } from '@agentscript/language';
import {
  emitDocument,
  isNamedMap,
  leadingComments,
  trailingComments,
  NamedMap,
} from '@agentscript/language';
import { DiagnosticSeverity } from '@agentscript/types';
import type { Diagnostic } from '@agentscript/types';
import type { AgentScriptAST } from '~/lib/parser';
import {
  getSchemaFields,
  getVariableOptions,
  getTopicOptions,
  getTypedMapPropertyFields,
  resolveFieldControl,
  formatFieldName,
  type SchemaFieldInfo,
} from '~/lib/schema-introspection';
import {
  upsertFieldInBlock,
  upsertCompoundFieldInBlock,
} from '~/lib/cst-mutator';
import { BlockCard } from './BlockCard';
import { NamedBlockList } from './NamedBlockList';
import { ReasoningActionList } from './ReasoningActionList';
import { TypedMapEditor } from './TypedMapEditor';
import { ProcedureField } from './fields/ProcedureField';
import { FieldRenderer } from './FieldRenderer';
import { CommentEditor } from './CommentEditor';
import { Button } from '~/components/ui/button';
import { Plus, CircleAlert, TriangleAlert, Info } from 'lucide-react';
import type { StatementKind } from './statements/AddStatementMenu';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AstLike {
  __kind?: string;
  __cst?: unknown;
  __comments?: unknown[];
  [key: string]: unknown;
}

interface BuilderCanvasProps {
  /** The AST block to render (single block instance, or Map for TypedMap). */
  block: unknown;
  /** The schema key for this block (e.g. "system", "start_agent", "actions"). */
  blockName: string;
  /** The schema describing this block's fields. */
  schema: Record<string, FieldType>;
  /** Instance name for named blocks (e.g. "main" for topic main). */
  instanceName?: string;
  diagnostics: Diagnostic[];
  cst: unknown;
  /** The root-level schema (all top-level block types). */
  rootSchema: Record<string, FieldType>;
  /** Full AST for re-emission on structural changes. */
  ast: AgentScriptAST | null;
  onApplyText: (text: string) => void;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BuilderCanvas({
  block,
  blockName,
  schema,
  instanceName,
  diagnostics,
  cst,
  rootSchema,
  ast,
  onApplyText,
  className,
}: BuilderCanvasProps) {
  const astRecord = ast as unknown as Record<string, unknown>;
  const blockObj = block as AstLike;
  const blockLeadingComments = leadingComments(blockObj);
  const blockTrailingComments = trailingComments(blockObj);
  const isMap = isNamedMap(block);

  const schemaFields = useMemo(() => getSchemaFields(schema), [schema]);

  // Compute variable options from AST for output assignment comboboxes
  const variableOptions = useMemo(
    () =>
      getVariableOptions(
        astRecord?.variables as NamedMap<Record<string, unknown>> | undefined
      ),
    [astRecord]
  );

  // Compute topic options from AST for transition "to" clause comboboxes
  const topicOptions = useMemo(
    () => getTopicOptions(astRecord, instanceName),
    [astRecord, instanceName]
  );

  // =========================================================================
  // Mutation handlers
  // =========================================================================

  /** Determine the CST block identifier for upsertFieldInBlock. */
  const cstBlockId = instanceName ?? blockName;

  /** Scalar field change: use CST mutator for format-preserving edits. */
  const handleScalarChange = useCallback(
    (fieldPath: string, value: string | number | boolean) => {
      if (!cst) return;

      const fieldName = fieldPath.includes('.')
        ? fieldPath.split('.').pop()!
        : fieldPath;

      try {
        const newText = upsertFieldInBlock(
          cst as never,
          cstBlockId,
          fieldName,
          value
        );
        onApplyText(newText);
      } catch {
        // Fallback: full re-emit
        if (astRecord) {
          const newText = emitDocument(
            astRecord as Record<string, unknown>,
            rootSchema as Record<string, FieldType>
          );
          onApplyText(newText);
        }
      }
    },
    [cst, cstBlockId, astRecord, rootSchema, onApplyText]
  );

  // --- Re-emit helper (used by structural operations) ---
  const reemit = useCallback(() => {
    if (!astRecord) return;
    const newText = emitDocument(
      astRecord as Record<string, unknown>,
      rootSchema as Record<string, FieldType>
    );
    onApplyText(newText);
  }, [astRecord, rootSchema, onApplyText]);

  // --- Named block operations ---
  const handleNamedAdd = useCallback(
    (childBlockKey: string, name: string) => {
      const currentText = ((cst as AstLike)?.text as string | undefined) ?? '';
      const newText =
        currentText.trimEnd() +
        `\n\n${childBlockKey} ${name}:\n  description: ""\n`;
      onApplyText(newText);
    },
    [cst, onApplyText]
  );

  const handleNamedDelete = useCallback(() => reemit(), [reemit]);
  const handleNamedRename = useCallback(() => reemit(), [reemit]);
  const handleNamedReorder = useCallback(() => reemit(), [reemit]);

  // --- TypedMap operations ---
  const handleTypedMapAdd = useCallback(
    (name: string, type: string, _modifier: string) => {
      const currentText = ((cst as AstLike)?.text as string | undefined) ?? '';
      const decl = `  ${name}: ${type}`;
      const blockLabel = blockName;
      const newText = currentText.includes(`${blockLabel}:`)
        ? currentText.replace(new RegExp(`(${blockLabel}:)`), `$1\n${decl}`)
        : currentText.trimEnd() + `\n\n${blockLabel}:\n${decl}\n`;
      onApplyText(newText);
    },
    [cst, blockName, onApplyText]
  );

  const handleTypedMapDelete = useCallback(() => reemit(), [reemit]);
  const handleTypedMapReorder = useCallback(() => reemit(), [reemit]);
  const handleTypedMapFieldChange = useCallback(() => reemit(), [reemit]);

  // --- Statement operations (for procedure fields) ---
  const handleStatementDelete = useCallback(() => reemit(), [reemit]);
  const handleStatementReorder = useCallback(() => reemit(), [reemit]);

  const handleStatementAdd = useCallback(
    (_fieldPath: string, _kind: StatementKind, _afterIndex: number) => {
      reemit();
    },
    [reemit]
  );

  const handleStatementUpdate = useCallback(() => reemit(), [reemit]);

  // --- Add compound field (e.g. system: inside a topic) ---
  const handleAddCompoundBlock = useCallback(
    (fieldName: string) => {
      if (!cst) return;
      try {
        const newText = upsertCompoundFieldInBlock(
          cst as never,
          cstBlockId,
          fieldName
        );
        onApplyText(newText);
      } catch {
        // Fallback: full re-emit
        if (astRecord) {
          const newText = emitDocument(
            astRecord as Record<string, unknown>,
            rootSchema as Record<string, FieldType>
          );
          onApplyText(newText);
        }
      }
    },
    [cst, cstBlockId, astRecord, rootSchema, onApplyText]
  );

  // =========================================================================
  // Render compound fields (recursion entry point)
  // =========================================================================

  const renderCompound = (
    fieldInfo: SchemaFieldInfo,
    value: unknown,
    parentPath: string
  ): React.ReactNode => {
    const fieldPath = `${parentPath}.${fieldInfo.name}`;

    // NamedBlock → NamedBlockList (or ReasoningActionList for reasoning actions)
    if (fieldInfo.fieldKind === 'Collection') {
      if (!isNamedMap(value)) return null;

      // Check if entries are ReasoningActionBlocks
      const firstEntry = value.values().next().value as
        | { __kind?: string }
        | undefined;
      if (firstEntry?.__kind === 'ReasoningActionBlock') {
        // Resolve topic-level action definitions from the parent block
        const topicActions = blockObj?.actions as
          | NamedMap<Record<string, unknown>>
          | undefined;
        return (
          <ReasoningActionList
            entries={value as NamedMap<Record<string, unknown>>}
            topicActions={topicActions}
            variableOptions={variableOptions}
            topicOptions={topicOptions}
            allDiagnostics={diagnostics}
            onReorder={() => handleNamedReorder()}
            onReemit={reemit}
          />
        );
      }

      return (
        <NamedBlockList
          blockType={fieldInfo.name}
          entries={value as NamedMap<Record<string, unknown>>}
          schema={fieldInfo.schema ?? {}}
          allDiagnostics={diagnostics}
          onScalarChange={handleScalarChange}
          onAdd={name => handleNamedAdd(fieldInfo.name, name)}
          onDelete={() => handleNamedDelete()}
          onRename={() => handleNamedRename()}
          onReorder={() => handleNamedReorder()}
          renderCompound={renderCompound}
        />
      );
    }

    // TypedMap → TypedMapEditor
    if (fieldInfo.fieldKind === 'TypedMap') {
      if (!isNamedMap(value)) return null;

      // Determine context-specific props for inputs/outputs vs variables
      const isInputs = fieldInfo.name === 'inputs';
      const isOutputs = fieldInfo.name === 'outputs';
      const isIO = isInputs || isOutputs;

      // Derive property fields from the TypedMap's propertiesSchema
      const derivedPropertyFields = getTypedMapPropertyFields(
        fieldInfo.fieldType
      );

      return (
        <TypedMapEditor
          blockName={fieldInfo.name}
          entries={value as NamedMap<Record<string, unknown>>}
          allDiagnostics={diagnostics}
          onAdd={(name, type, mod) => handleTypedMapAdd(name, type, mod)}
          onDelete={() => handleTypedMapDelete()}
          onReorder={() => handleTypedMapReorder()}
          onFieldChange={() => handleTypedMapFieldChange()}
          sectionLabel={isInputs ? 'Inputs' : isOutputs ? 'Outputs' : undefined}
          showModifier={!isIO}
          showDefault={!isIO}
          itemLabel={isInputs ? 'Input' : isOutputs ? 'Output' : undefined}
          propertyFields={
            derivedPropertyFields.length > 0 ? derivedPropertyFields : undefined
          }
        />
      );
    }

    // Block → nested BlockCard (or "Add" placeholder when undefined)
    if (fieldInfo.fieldKind === 'Block') {
      if (value && typeof value === 'object') {
        return (
          <BlockCard
            id={fieldPath}
            blockName={fieldInfo.name}
            value={value as Record<string, unknown> & { __kind?: string }}
            schema={fieldInfo.schema ?? {}}
            allDiagnostics={diagnostics}
            onScalarChange={handleScalarChange}
            renderCompound={renderCompound}
            depth={1}
          />
        );
      }
      // Undefined block → show "Add" placeholder
      return (
        <div className="rounded-lg border border-dashed border-border/50 p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                {formatFieldName(fieldInfo.name)}
              </p>
              {fieldInfo.description && (
                <p className="mt-0.5 text-xs text-muted-foreground/70">
                  {fieldInfo.description}
                </p>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs text-muted-foreground"
              onClick={() => handleAddCompoundBlock(fieldInfo.name)}
            >
              <Plus className="h-3 w-3" />
              Add
            </Button>
          </div>
        </div>
      );
    }

    // ProcedureValue → ProcedureField (handles undefined gracefully)
    if (fieldInfo.fieldKind === 'Primitive') {
      const control = resolveFieldControl(fieldInfo);
      if (control === 'procedure-editor') {
        const valLike = value as
          | { __kind?: string; statements?: unknown[] }
          | undefined;
        return (
          <ProcedureField
            value={valLike ? (valLike as never) : undefined}
            allDiagnostics={diagnostics}
            fieldPath={fieldPath}
            onStatementDelete={(_fp, _i) => handleStatementDelete()}
            onStatementReorder={(_fp, _f, _t) => handleStatementReorder()}
            onStatementAdd={handleStatementAdd}
            onStatementUpdate={(_fp, _i, _f, _v) => handleStatementUpdate()}
          />
        );
      }
    }

    return null;
  };

  // Show only block-level diagnostics — ones that point to the block
  // declaration itself (e.g. missing required fields). Field-level
  // diagnostics point deeper into the block body and are shown inline.
  const blockOnlyDiags = useMemo(() => {
    const own: Diagnostic[] = (blockObj?.__diagnostics as Diagnostic[]) ?? [];
    if (own.length === 0) return own;
    const blockLine = (
      blockObj?.__cst as { range?: { start: { line: number } } } | undefined
    )?.range?.start?.line;
    if (blockLine === undefined) return own;
    return own.filter(d => d.range.start.line === blockLine);
  }, [blockObj]);

  // =========================================================================
  // Render
  // =========================================================================

  // TypedMap block (e.g. variables) → render TypedMapEditor directly
  if (isMap) {
    const topLevelPropertyFields = getTypedMapPropertyFields(
      rootSchema[blockName]
    );
    return (
      <div className={cn('space-y-3', className)}>
        <TypedMapEditor
          blockName={blockName}
          entries={block as NamedMap<Record<string, unknown>>}
          allDiagnostics={diagnostics}
          onAdd={(name, type, mod) => handleTypedMapAdd(name, type, mod)}
          onDelete={() => handleTypedMapDelete()}
          onReorder={() => handleTypedMapReorder()}
          onFieldChange={() => handleTypedMapFieldChange()}
          propertyFields={
            topLevelPropertyFields.length > 0
              ? topLevelPropertyFields
              : undefined
          }
        />
      </div>
    );
  }

  // Regular block → render its schema fields
  const fieldPath = instanceName ? `${blockName}.${instanceName}` : blockName;

  return (
    <div className={cn('space-y-3', className)}>
      {blockOnlyDiags.length > 0 && (
        <div
          className={cn(
            'rounded-lg border px-3 py-2',
            blockOnlyDiags.some(d => d.severity === DiagnosticSeverity.Error)
              ? 'border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/20'
              : 'border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20'
          )}
        >
          <ul className="space-y-0.5">
            {blockOnlyDiags.map((d, i) => (
              <li key={i} className="flex items-center gap-1.5">
                {d.severity === DiagnosticSeverity.Error && (
                  <CircleAlert className="h-3 w-3 shrink-0 text-red-500" />
                )}
                {d.severity === DiagnosticSeverity.Warning && (
                  <TriangleAlert className="h-3 w-3 shrink-0 text-amber-500" />
                )}
                {(d.severity === DiagnosticSeverity.Information ||
                  d.severity === DiagnosticSeverity.Hint) && (
                  <Info className="h-3 w-3 shrink-0 text-blue-500" />
                )}
                <span
                  className={cn(
                    'text-xs',
                    d.severity === DiagnosticSeverity.Error &&
                      'text-red-700 dark:text-red-400',
                    d.severity === DiagnosticSeverity.Warning &&
                      'text-amber-700 dark:text-amber-400',
                    (d.severity === DiagnosticSeverity.Information ||
                      d.severity === DiagnosticSeverity.Hint) &&
                      'text-blue-700 dark:text-blue-400'
                  )}
                >
                  {d.message}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {blockLeadingComments.length > 0 && (
        <CommentEditor comments={blockLeadingComments} position="leading" />
      )}

      {schemaFields.map(fieldInfo => {
        const fieldValue = blockObj?.[fieldInfo.name];

        // Skip topic-level actions — they are shown via the explorer tree
        if (
          fieldInfo.name === 'actions' &&
          fieldInfo.fieldKind === 'Collection' &&
          isNamedMap(fieldValue)
        ) {
          const firstEntry = fieldValue.values().next().value as
            | { __kind?: string }
            | undefined;
          if (firstEntry?.__kind === 'ActionBlock') return null;
        }

        return (
          <FieldRenderer
            key={fieldInfo.name}
            fieldInfo={fieldInfo}
            value={fieldValue}
            isUnset={fieldValue === undefined}
            allDiagnostics={diagnostics}
            onScalarChange={(_, newVal) =>
              handleScalarChange(`${fieldPath}.${fieldInfo.name}`, newVal)
            }
            renderCompound={
              renderCompound
                ? (fi, v) => renderCompound(fi, v, fieldPath)
                : undefined
            }
          />
        );
      })}

      {blockTrailingComments.length > 0 && (
        <CommentEditor comments={blockTrailingComments} position="trailing" />
      )}
    </div>
  );
}
