/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useState, useCallback } from 'react';
import { cn } from '~/lib/utils';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Textarea } from '~/components/ui/textarea';
import { Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { PiDotsSixVerticalBold } from 'react-icons/pi';
import type { Diagnostic, Range } from '@agentscript/types';
import { NamedMap } from '@agentscript/language';
import { DiagnosticBadge } from './DiagnosticBadge';
import { useFieldDiagnostics } from './hooks/useFieldDiagnostics';
import { EnumField } from './fields/EnumField';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AstStringLike {
  __kind?: string;
  value?: string | number | boolean;
  name?: string;
}

interface VariablePropertiesBlock {
  __kind?: string;
  description?: AstStringLike;
  complex_data_type_name?: AstStringLike;
  is_required?: AstStringLike;
  [key: string]: unknown;
}

interface VariableDeclaration {
  __kind?: string;
  __name?: string;
  __cst?: { range?: Range };
  __diagnostics?: Diagnostic[];
  name?: string;
  type?: { __kind?: string; name?: string; value?: string; text?: string };
  modifier?: string | { __kind?: string; name?: string; value?: string };
  defaultValue?: { __emit?: (ctx: { indent: number }) => string };
  properties?: VariablePropertiesBlock;
  [key: string]: unknown;
}

/** Primitive types available in AgentScript */
const PRIMITIVE_TYPES = [
  'string',
  'number',
  'boolean',
  'object',
  'list',
  'map',
];

/** Variable modifiers */
const MODIFIERS = ['', 'mutable', 'linked'];

/** Extract a string from an AST value node */
function extractStr(node: AstStringLike | undefined): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (typeof node.value === 'string') return node.value;
  if (typeof node.name === 'string') return node.name;
  return '';
}

/** Describes a property field that should always be visible for each entry. */
export interface PropertyFieldDef {
  name: string;
  label: string;
  type: 'string' | 'boolean';
}

interface TypedMapEditorProps {
  blockName: string;
  entries: NamedMap<VariableDeclaration>;
  allDiagnostics: Diagnostic[];
  onAdd: (name: string, type: string, modifier: string) => void;
  onDelete: (name: string) => void;
  onReorder: (names: string[]) => void;
  onFieldChange: (varName: string, field: string, value: string) => void;
  className?: string;
  /** Section header label (e.g. "Inputs", "Outputs"). */
  sectionLabel?: string;
  /** Whether to show the modifier column (default true). */
  showModifier?: boolean;
  /** Whether to show the default value column (default true). */
  showDefault?: boolean;
  /** Label for the "Add" button (default "Variable"). */
  itemLabel?: string;
  /** Property fields to render inside the expanded detail panel. */
  propertyFields?: PropertyFieldDef[];
}

// ---------------------------------------------------------------------------
// Property count helper
// ---------------------------------------------------------------------------

function countSetProperties(
  props: VariablePropertiesBlock | undefined,
  propertyFields: PropertyFieldDef[] | undefined
): { set: number; total: number } {
  if (!propertyFields || propertyFields.length === 0)
    return { set: 0, total: 0 };
  let set = 0;
  for (const pf of propertyFields) {
    const v = props?.[pf.name] as AstStringLike | undefined;
    if (!v) continue;
    if (pf.type === 'boolean' && typeof v.value === 'boolean' && v.value) set++;
    else if (pf.type === 'string' && extractStr(v)) set++;
  }
  return { set, total: propertyFields.length };
}

// ---------------------------------------------------------------------------
// Sortable Row — Accordion style
// ---------------------------------------------------------------------------

function VariableRow({
  name,
  declaration,
  allDiagnostics,
  expanded,
  onToggle,
  onDelete,
  onFieldChange,
  sortable,
  showModifier = true,
  showDefault = true,
  propertyFields,
}: {
  name: string;
  declaration: VariableDeclaration;
  allDiagnostics: Diagnostic[];
  expanded: boolean;
  onToggle: () => void;
  onDelete: () => void;
  onFieldChange: (field: string, value: string) => void;
  sortable: boolean;
  showModifier?: boolean;
  showDefault?: boolean;
  propertyFields?: PropertyFieldDef[];
}) {
  const range = declaration.__cst?.range;
  const diags = useFieldDiagnostics(allDiagnostics, range);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: name, disabled: !sortable });

  const style: React.CSSProperties = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  const modifierRaw = declaration.modifier;
  const modifierValue =
    typeof modifierRaw === 'string'
      ? modifierRaw
      : ((modifierRaw as { name?: string; value?: string } | undefined)?.name ??
        (modifierRaw as { value?: string } | undefined)?.value ??
        '');

  const typeName =
    typeof declaration.type === 'string'
      ? declaration.type
      : (declaration.type?.name ??
        declaration.type?.value ??
        declaration.type?.text ??
        'string');

  const defaultValueText = declaration.defaultValue?.__emit
    ? declaration.defaultValue.__emit({ indent: 0 })
    : '';

  const props = declaration.properties;
  const canExpand = (propertyFields && propertyFields.length > 0) || !!props;
  const { set: propsSet, total: propsTotal } = countSetProperties(
    props,
    propertyFields
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group/var',
        expanded
          ? 'rounded-lg border border-border/60 bg-muted/20'
          : 'rounded hover:bg-muted/40',
        isDragging && 'bg-muted shadow-md'
      )}
    >
      {/* ── Collapsed summary row ── */}
      <div
        className={cn(
          'flex cursor-pointer items-center gap-2 px-3 py-2',
          expanded && 'border-b border-border/30'
        )}
        onClick={() => canExpand && onToggle()}
      >
        {sortable && (
          <span
            className="cursor-grab text-muted-foreground hover:text-foreground"
            onClick={e => e.stopPropagation()}
            {...attributes}
            {...listeners}
          >
            <PiDotsSixVerticalBold className="h-3.5 w-3.5" />
          </span>
        )}

        {canExpand ? (
          expanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="w-3.5" />
        )}

        {/* Name */}
        <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium">
          {name}
        </span>

        {/* Modifier badge */}
        {showModifier && modifierValue && (
          <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-medium text-blue-400">
            {modifierValue}
          </span>
        )}

        {/* Type badge */}
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {typeName}
        </span>

        {/* Default preview when collapsed */}
        {!expanded && showDefault && defaultValueText && (
          <span className="max-w-32 truncate text-[11px] text-muted-foreground">
            = {defaultValueText}
          </span>
        )}

        {/* Property count badge when collapsed */}
        {!expanded && propsTotal > 0 && (
          <span
            className={cn(
              'rounded-full px-1.5 py-0.5 text-[10px]',
              propsSet > 0
                ? 'bg-emerald-500/15 text-emerald-400'
                : 'bg-muted text-muted-foreground/60'
            )}
          >
            {propsSet}/{propsTotal}
          </span>
        )}

        <DiagnosticBadge diagnostics={diags} />

        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0 text-muted-foreground opacity-0 group-hover/var:opacity-100 hover:text-red-500"
          onClick={e => {
            e.stopPropagation();
            onDelete();
          }}
          title={`Remove ${name}`}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      {/* ── Expanded detail panel ── */}
      {expanded && (
        <div className="space-y-3 px-4 py-3">
          {/* Identity fields row */}
          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Name
              </label>
              <Input
                value={name}
                onChange={e => onFieldChange('name', e.target.value)}
                className="h-7 font-mono text-xs"
              />
            </div>
            {showModifier && (
              <div className="w-28 space-y-1">
                <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Modifier
                </label>
                <EnumField
                  value={modifierValue}
                  options={MODIFIERS}
                  onChange={v => onFieldChange('modifier', String(v))}
                  placeholder="none"
                  className="w-full"
                />
              </div>
            )}
            <div className="w-28 space-y-1">
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Type
              </label>
              <EnumField
                value={typeName}
                options={PRIMITIVE_TYPES}
                onChange={v => onFieldChange('type', String(v))}
                className="w-full"
              />
            </div>
          </div>

          {/* Default value */}
          {showDefault && (
            <div className="space-y-1">
              <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Default Value
              </label>
              <Input
                value={defaultValueText}
                onChange={e => onFieldChange('default', e.target.value)}
                className="h-7 font-mono text-xs"
                placeholder="No default"
              />
            </div>
          )}

          {/* ── Schema property fields ── */}
          {propertyFields && propertyFields.length > 0 && (
            <>
              <div className="border-t border-border/30" />
              <div className="space-y-2">
                {propertyFields.map(pf => {
                  const astVal = props?.[pf.name] as AstStringLike | undefined;

                  if (pf.type === 'boolean') {
                    const boolVal =
                      typeof astVal?.value === 'boolean' ? astVal.value : false;
                    return (
                      <label
                        key={pf.name}
                        className="flex cursor-pointer items-center gap-2"
                      >
                        <input
                          type="checkbox"
                          checked={boolVal}
                          onChange={e =>
                            onFieldChange(
                              `properties.${pf.name}`,
                              String(e.target.checked)
                            )
                          }
                          className="h-4 w-4 rounded border-border"
                        />
                        <span className="text-xs">{pf.label}</span>
                      </label>
                    );
                  }

                  const strVal = extractStr(astVal);
                  if (pf.name === 'description') {
                    return (
                      <div key={pf.name} className="space-y-1">
                        <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          {pf.label}
                        </label>
                        <Textarea
                          value={strVal}
                          onChange={e =>
                            onFieldChange(
                              `properties.${pf.name}`,
                              e.target.value
                            )
                          }
                          className="min-h-16 text-xs"
                          rows={2}
                          placeholder={`${pf.label}...`}
                        />
                      </div>
                    );
                  }

                  return (
                    <div key={pf.name} className="space-y-1">
                      <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                        {pf.label}
                      </label>
                      <Input
                        value={strVal}
                        onChange={e =>
                          onFieldChange(`properties.${pf.name}`, e.target.value)
                        }
                        className="h-7 text-xs"
                        placeholder={`${pf.label}...`}
                      />
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {/* Legacy: properties from AST when no propertyFields */}
          {!propertyFields &&
            props &&
            Object.keys(props).some(k => !k.startsWith('__')) && (
              <>
                <div className="border-t border-border/30" />
                <div className="space-y-2">
                  {Object.entries(props).map(([key, val]) => {
                    if (key.startsWith('__')) return null;
                    const astVal = val as AstStringLike;
                    if (typeof astVal?.value === 'boolean') {
                      return (
                        <label
                          key={key}
                          className="flex cursor-pointer items-center gap-2"
                        >
                          <input
                            type="checkbox"
                            checked={astVal.value}
                            onChange={e =>
                              onFieldChange(
                                `properties.${key}`,
                                String(e.target.checked)
                              )
                            }
                            className="h-4 w-4 rounded border-border"
                          />
                          <span className="text-xs">
                            {key.replace(/_/g, ' ')}
                          </span>
                        </label>
                      );
                    }
                    const strVal = extractStr(astVal);
                    if (!strVal) return null;
                    return (
                      <div key={key} className="space-y-1">
                        <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          {key.replace(/_/g, ' ')}
                        </label>
                        {key === 'description' ? (
                          <Textarea
                            value={strVal}
                            onChange={e =>
                              onFieldChange(`properties.${key}`, e.target.value)
                            }
                            className="min-h-16 text-xs"
                            rows={2}
                          />
                        ) : (
                          <Input
                            value={strVal}
                            onChange={e =>
                              onFieldChange(`properties.${key}`, e.target.value)
                            }
                            className="h-7 text-xs"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function TypedMapEditor({
  blockName: _blockName,
  entries,
  allDiagnostics,
  onAdd,
  onDelete,
  onReorder,
  onFieldChange,
  className,
  sectionLabel,
  showModifier = true,
  showDefault = true,
  itemLabel = 'Variable',
  propertyFields,
}: TypedMapEditorProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('string');
  const [expandedName, setExpandedName] = useState<string | null>(null);

  const names = [...entries.keys()];

  const handleToggle = useCallback((varName: string) => {
    setExpandedName(prev => (prev === varName ? null : varName));
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = names.indexOf(String(active.id));
    const newIndex = names.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = [...names];
    const [removed] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, removed);
    onReorder(reordered);
  };

  const handleAdd = () => {
    const trimmed = newName.trim();
    if (trimmed && !entries.has(trimmed)) {
      onAdd(trimmed, newType, '');
      setNewName('');
      setShowAdd(false);
    }
  };

  return (
    <div className={cn('space-y-1', className)}>
      {sectionLabel && (
        <div className="px-2 pt-1 pb-0.5">
          <span className="text-xs font-medium text-foreground">
            {sectionLabel}
          </span>
        </div>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={names} strategy={verticalListSortingStrategy}>
          {names.map(name => {
            const decl = entries.get(name);
            if (!decl) return null;
            return (
              <VariableRow
                key={name}
                name={name}
                declaration={decl}
                allDiagnostics={allDiagnostics}
                expanded={expandedName === name}
                onToggle={() => handleToggle(name)}
                onDelete={() => onDelete(name)}
                onFieldChange={(field, value) =>
                  onFieldChange(name, field, value)
                }
                sortable={names.length > 1}
                showModifier={showModifier}
                showDefault={showDefault}
                propertyFields={propertyFields}
              />
            );
          })}
        </SortableContext>
      </DndContext>

      {/* Add row */}
      {showAdd ? (
        <div className="flex items-center gap-2 px-2 py-1">
          <Input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            placeholder={`${itemLabel} name`}
            autoFocus
            className="h-7 w-32 text-xs"
            onKeyDown={e => {
              if (e.key === 'Enter') handleAdd();
              if (e.key === 'Escape') {
                setShowAdd(false);
                setNewName('');
              }
            }}
          />
          <EnumField
            value={newType}
            options={PRIMITIVE_TYPES}
            onChange={v => setNewType(String(v))}
            className="w-24"
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={handleAdd}
          >
            Add
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              setShowAdd(false);
              setNewName('');
            }}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 text-xs text-muted-foreground"
          onClick={() => setShowAdd(true)}
        >
          <Plus className="h-3 w-3" />
          Add {itemLabel}
        </Button>
      )}
    </div>
  );
}
