/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { ConstraintMetadata } from '@agentscript/language';
import type { Diagnostic } from '@agentscript/types';
import {
  resolveFieldControl,
  formatFieldName,
  type SchemaFieldInfo,
} from '~/lib/schema-introspection';
import { useFieldDiagnostics } from './hooks/useFieldDiagnostics';
import { DiagnosticMessages } from './DiagnosticBadge';
import { StringField } from './fields/StringField';
import { NumberField } from './fields/NumberField';
import { BooleanField } from './fields/BooleanField';
import { EnumField } from './fields/EnumField';
import { ReferenceField } from './fields/ReferenceField';
import { TemplateEditor } from './fields/TemplateEditor';
import { cn } from '~/lib/utils';
import type { Range } from '@agentscript/types';

// ---------------------------------------------------------------------------
// Value extraction helpers
// ---------------------------------------------------------------------------

interface AstValueLike {
  __kind?: string;
  __cst?: { range?: Range };
  __diagnostics?: Diagnostic[];
  __comments?: unknown[];
  value?: unknown;
  content?: string;
  parts?: unknown[];
  statements?: unknown[];
}

function extractStringValue(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const v = value as AstValueLike;
  // StringLiteral → .value, TemplateExpression → .content
  if (v.__kind === 'StringLiteral' && typeof v.value === 'string')
    return v.value;
  if (v.__kind === 'TemplateExpression' && typeof v.content === 'string')
    return v.content;
  // Fallback: try .value
  if (typeof v.value === 'string') return v.value;
  return String(value);
}

function extractNumberValue(value: unknown): number {
  if (!value || typeof value !== 'object') return 0;
  const v = value as AstValueLike;
  if (typeof v.value === 'number') return v.value;
  return 0;
}

function extractBooleanValue(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const v = value as AstValueLike;
  if (typeof v.value === 'boolean') return v.value;
  return false;
}

function getNodeRange(value: unknown): Range | undefined {
  if (!value || typeof value !== 'object') return undefined;
  return (value as AstValueLike).__cst?.range;
}

function getNodeDiagnostics(value: unknown): Diagnostic[] {
  if (!value || typeof value !== 'object') return [];
  return ((value as AstValueLike).__diagnostics as Diagnostic[]) ?? [];
}

// ---------------------------------------------------------------------------
// FieldRenderer
// ---------------------------------------------------------------------------

export interface FieldRendererProps {
  fieldInfo: SchemaFieldInfo;
  value: unknown;
  allDiagnostics: Diagnostic[];
  onScalarChange: (fieldName: string, value: string | number | boolean) => void;
  /** Render prop for compound types (block-editor, named-block-list, etc.). */
  renderCompound?: (
    fieldInfo: SchemaFieldInfo,
    value: unknown
  ) => React.ReactNode;
  /** When true, the field has no value in the AST yet (visual dimming). */
  isUnset?: boolean;
  className?: string;
}

export function FieldRenderer({
  fieldInfo,
  value,
  allDiagnostics,
  onScalarChange,
  renderCompound,
  isUnset,
  className,
}: FieldRendererProps) {
  const control = resolveFieldControl(fieldInfo);
  const range = getNodeRange(value);
  const nodeDiags = useFieldDiagnostics(allDiagnostics, range);
  const ownDiags = getNodeDiagnostics(value);
  const combinedDiags = [...nodeDiags, ...ownDiags];
  const hasError = combinedDiags.some(d => d.severity === 1);
  const constraints: ConstraintMetadata = fieldInfo.constraints;

  // Compound types delegate to parent via renderCompound
  if (
    control === 'block-editor' ||
    control === 'named-block-list' ||
    control === 'typed-map-editor' ||
    control === 'sequence-editor' ||
    control === 'procedure-editor'
  ) {
    return renderCompound ? <>{renderCompound(fieldInfo, value)}</> : null;
  }

  const label = formatFieldName(fieldInfo.name);
  const description = fieldInfo.description;
  const isRequired = fieldInfo.metadata.required;
  const isDeprecated = !!fieldInfo.metadata.deprecated;

  return (
    <div className={cn('group/field', isUnset && 'opacity-50', className)}>
      <div className="flex items-center gap-1.5">
        <label className="text-xs font-medium text-foreground">
          {label}
          {isRequired && <span className="ml-0.5 text-red-500">*</span>}
        </label>
        {isDeprecated && (
          <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
            Deprecated
          </span>
        )}
      </div>
      {description && (
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      )}

      {combinedDiags.length > 0 && (
        <div className="mt-1">
          <DiagnosticMessages diagnostics={combinedDiags} />
        </div>
      )}

      <div className="mt-1.5">
        {control === 'text-input' && (
          <StringField
            value={extractStringValue(value)}
            onChange={v => onScalarChange(fieldInfo.name, v)}
            constraints={constraints}
            hasError={hasError}
            placeholder={fieldInfo.metadata.example}
          />
        )}

        {control === 'textarea' && (
          <TemplateEditor
            content={extractStringValue(value)}
            onChange={v => onScalarChange(fieldInfo.name, v)}
            hasError={hasError}
            placeholder={fieldInfo.metadata.example}
          />
        )}

        {control === 'number-input' && (
          <NumberField
            value={extractNumberValue(value)}
            onChange={v => onScalarChange(fieldInfo.name, v)}
            constraints={constraints}
            hasError={hasError}
          />
        )}

        {control === 'toggle' && (
          <BooleanField
            value={extractBooleanValue(value)}
            onChange={v => onScalarChange(fieldInfo.name, v)}
          />
        )}

        {control === 'dropdown' && (
          <EnumField
            value={
              value !== undefined
                ? typeof (value as AstValueLike).value === 'string' ||
                  typeof (value as AstValueLike).value === 'number' ||
                  typeof (value as AstValueLike).value === 'boolean'
                  ? ((value as AstValueLike).value as string | number | boolean)
                  : extractStringValue(value)
                : undefined
            }
            options={constraints.enum ?? []}
            onChange={v => onScalarChange(fieldInfo.name, v)}
            hasError={hasError}
          />
        )}

        {control === 'reference-input' && (
          <ReferenceField
            value={extractStringValue(value)}
            onChange={v => onScalarChange(fieldInfo.name, v)}
            hasError={hasError}
          />
        )}
      </div>
    </div>
  );
}
