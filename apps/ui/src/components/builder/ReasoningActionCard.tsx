/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { useState, useMemo, useCallback } from 'react';
import { cn } from '~/lib/utils';
import { Input } from '~/components/ui/input';
import { Button } from '~/components/ui/button';
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from '~/components/ui/combobox';
import { VscChevronDown, VscChevronRight, VscClose } from 'react-icons/vsc';
import { PiDotsSixVerticalBold } from 'react-icons/pi';
import { StringLiteral, isNamedMap, NamedMap } from '@agentscript/language';
import type { Diagnostic, Range } from '@agentscript/types';
import type { VariableOption, TopicOption } from '~/lib/schema-introspection';
import { DiagnosticBadge } from './DiagnosticBadge';
import { useFieldDiagnostics } from './hooks/useFieldDiagnostics';
import { useSortable } from '@dnd-kit/sortable';

// ---------------------------------------------------------------------------
// AST node interfaces
// ---------------------------------------------------------------------------

interface AstNode {
  __kind?: string;
  __diagnostics?: Diagnostic[];
  [key: string]: unknown;
}

interface MemberExpression extends AstNode {
  __kind: 'MemberExpression';
  object: { name?: string; __kind?: string };
  property: string;
}

interface WithClause extends AstNode {
  __kind: 'WithClause';
  param: string;
  value: AstNode;
}

interface SetClause extends AstNode {
  __kind: 'SetClause';
  target: AstNode & { __emit?: (ctx: { indent: number }) => string };
  value: AstNode & { __emit?: (ctx: { indent: number }) => string };
}

interface ToClause extends AstNode {
  __kind: 'ToClause';
  target: AstNode & { __emit?: (ctx: { indent: number }) => string };
}

interface AvailableWhen extends AstNode {
  __kind: 'AvailableWhen';
  condition: AstNode & { __emit?: (ctx: { indent: number }) => string };
}

type Statement = WithClause | SetClause | ToClause | AvailableWhen | AstNode;

interface ParameterDeclaration extends AstNode {
  __kind: 'ParameterDeclaration';
  type?: { name?: string; __kind?: string };
}

interface ActionBlock extends AstNode {
  __kind: 'ActionBlock';
  __name?: string;
  inputs?: Record<string, ParameterDeclaration>;
  outputs?: Record<string, ParameterDeclaration>;
}

interface ReasoningActionBlock extends AstNode {
  __kind: 'ReasoningActionBlock';
  __name?: string;
  __scope?: string;
  __cst?: { range?: Range };
  value?: MemberExpression;
  statements?: Statement[];
  description?: { value?: string; __kind?: string };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emitExpr(
  expr: { __emit?: (ctx: { indent: number }) => string } | undefined
): string {
  return expr?.__emit?.({ indent: 0 }) ?? '';
}

/** Format a MemberExpression as `@object.property` */
function emitMemberExpr(expr: MemberExpression | undefined): string {
  if (!expr?.object?.name) return '';
  return `@${expr.object.name}.${expr.property}`;
}

/** Format the value of a WithClause for display */
function formatWithValue(value: AstNode): {
  display: string;
  isLlmFilled: boolean;
} {
  if (value.__kind === 'Ellipsis') {
    return { display: '...', isLlmFilled: true };
  }
  if (value.__kind === 'SlotFilled') {
    return { display: 'slot filled', isLlmFilled: true };
  }
  // For other expressions, try to emit
  const emittable = value as { __emit?: (ctx: { indent: number }) => string };
  const text = emittable.__emit?.({ indent: 0 }) ?? '';
  return { display: text, isLlmFilled: false };
}

/** Resolve the referenced action definition from the topic's actions map */
function resolveActionDef(
  reasoningAction: ReasoningActionBlock,
  topicActions: NamedMap<ActionBlock> | undefined
): ActionBlock | undefined {
  if (!topicActions || !reasoningAction.value) return undefined;

  const ref = reasoningAction.value;
  if (ref.__kind === 'MemberExpression' && ref.object?.name === 'actions') {
    return topicActions.get(ref.property);
  }
  return undefined;
}

/** Extract type name from a parameter declaration */
function getTypeName(param: ParameterDeclaration | undefined): string {
  if (!param?.type) return '';
  return param.type.name ?? '';
}

/** Safely iterate parameter entries from inputs/outputs (handles NamedMap, object, and __-prefixed metadata keys) */
function getParamEntries(
  params:
    | Record<string, ParameterDeclaration>
    | NamedMap<ParameterDeclaration>
    | undefined
): Array<[string, ParameterDeclaration]> {
  if (!params) return [];
  if (isNamedMap(params)) {
    return [...params.entries()];
  }
  return Object.entries(params).filter(
    ([key, val]) =>
      !key.startsWith('__') &&
      val &&
      typeof val === 'object' &&
      val.__kind === 'ParameterDeclaration'
  );
}

// ---------------------------------------------------------------------------
// Editable value cell for input rows
// ---------------------------------------------------------------------------

function InputValueCell({
  value,
  isLlmFilled,
  hasValue,
  onChange,
}: {
  value: string;
  isLlmFilled: boolean;
  hasValue: boolean;
  onChange: (value: string) => void;
}) {
  const [localValue, setLocalValue] = useState(isLlmFilled ? '' : value);
  const [mode, setMode] = useState<'expression' | 'llm'>(
    isLlmFilled ? 'llm' : 'expression'
  );

  const handleModeToggle = () => {
    if (mode === 'llm') {
      setMode('expression');
      // switching to expression — keep whatever was typed, commit empty → clears
    } else {
      setMode('llm');
      onChange('...');
    }
  };

  const handleBlur = () => {
    if (mode === 'expression') {
      onChange(localValue);
    }
  };

  return (
    <div className="flex flex-1 items-center gap-1.5">
      {mode === 'llm' ? (
        <button
          type="button"
          className="inline-flex items-center rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 hover:bg-violet-200 dark:bg-violet-900/30 dark:text-violet-400 dark:hover:bg-violet-900/50"
          onClick={handleModeToggle}
          title="Click to set a specific value"
        >
          LLM fills in
        </button>
      ) : (
        <>
          <Input
            value={localValue}
            onChange={e => setLocalValue(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={e => {
              if (e.key === 'Enter') handleBlur();
            }}
            placeholder={hasValue ? '' : 'value...'}
            className="h-7 flex-1 font-mono text-xs"
          />
          <button
            type="button"
            className="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={handleModeToggle}
            title="Let LLM fill in this value"
          >
            ...
          </button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editable target cell for output rows (variable combobox)
// ---------------------------------------------------------------------------

function OutputTargetCell({
  target,
  outputType,
  variableOptions,
  onChange,
}: {
  target: string;
  /** The type of the output parameter — used to filter compatible variables */
  outputType: string;
  variableOptions: VariableOption[];
  onChange: (value: string) => void;
}) {
  // Filter variables to those matching the output type
  const filtered = useMemo(() => {
    if (!outputType) return variableOptions;
    return variableOptions.filter(
      v => !v.type || v.type.toLowerCase() === outputType.toLowerCase()
    );
  }, [variableOptions, outputType]);

  // Find the selected option to set defaultValue
  const selectedOption = filtered.find(v => v.value === target);

  return (
    <Combobox
      defaultValue={selectedOption?.name ?? ''}
      onValueChange={(val: string | null) => {
        if (!val) {
          onChange('');
          return;
        }
        const option = filtered.find(v => v.name === val);
        if (option) onChange(option.value);
      }}
    >
      <ComboboxInput
        placeholder="Select variable..."
        showClear
        className="h-7 flex-1 font-mono text-xs"
      />
      <ComboboxContent>
        <ComboboxList>
          <ComboboxEmpty>No matching variables.</ComboboxEmpty>
          {filtered.map(option => (
            <ComboboxItem key={option.name} value={option.name}>
              <span className="font-mono text-xs">{option.name}</span>
              <span className="ml-auto rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                {option.type}
              </span>
            </ComboboxItem>
          ))}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

// ---------------------------------------------------------------------------
// Editable clause rows for available_when / to
// ---------------------------------------------------------------------------

/** Decompose an AvailableWhen condition into left / operator / right parts */
function decomposeCondition(condition: AstNode): {
  left: string;
  operator: string;
  right: string;
  isComplex: boolean;
} {
  // ComparisonExpression: @variables.x != 0
  if (condition.__kind === 'ComparisonExpression') {
    const cmp = condition as {
      left?: AstNode;
      operator?: string;
      right?: AstNode;
    };
    return {
      left: emitExpr(
        cmp.left as { __emit?: (ctx: { indent: number }) => string }
      ),
      operator: (cmp.operator as string) ?? '==',
      right: emitExpr(
        cmp.right as { __emit?: (ctx: { indent: number }) => string }
      ),
      isComplex: false,
    };
  }
  // BinaryExpression with and/or: too complex for structured editing
  if (condition.__kind === 'BinaryExpression') {
    return {
      left: emitExpr(
        condition as { __emit?: (ctx: { indent: number }) => string }
      ),
      operator: '',
      right: '',
      isComplex: true,
    };
  }
  // Simple MemberExpression: @variables.x (boolean truthy check)
  return {
    left: emitExpr(
      condition as { __emit?: (ctx: { indent: number }) => string }
    ),
    operator: 'is truthy',
    right: '',
    isComplex: false,
  };
}

const CONDITION_OPERATORS = [
  { value: 'is truthy', label: 'is truthy' },
  { value: '==', label: '==' },
  { value: '!=', label: '!=' },
  { value: '<', label: '<' },
  { value: '>', label: '>' },
  { value: '<=', label: '<=' },
  { value: '>=', label: '>=' },
  { value: 'is', label: 'is' },
  { value: 'is not', label: 'is not' },
];

function AvailableWhenRow({
  clause,
  variableOptions,
  onRemove,
  onReemit,
}: {
  clause: AvailableWhen;
  variableOptions: VariableOption[];
  onRemove: () => void;
  onReemit?: () => void;
}) {
  const { left, operator, right, isComplex } = useMemo(
    () => decomposeCondition(clause.condition),
    [clause.condition]
  );

  const selectedVar = variableOptions.find(v => v.value === left);

  // Complex expressions (and/or chains) — fall back to raw text display
  if (isComplex) {
    return (
      <div className="group/clause flex items-center gap-2 rounded border border-amber-200/50 bg-amber-50/30 px-2 py-1.5 dark:border-amber-800/30 dark:bg-amber-950/20">
        <span className="shrink-0 text-xs font-medium text-amber-600 dark:text-amber-400">
          available when
        </span>
        <span className="flex-1 font-mono text-xs">{left}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 shrink-0 text-muted-foreground opacity-0 group-hover/clause:opacity-100 hover:text-red-500"
          onClick={onRemove}
          title="Remove available when condition"
        >
          <VscClose className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <div className="group/clause flex items-center gap-2 rounded border border-amber-200/50 bg-amber-50/30 px-2 py-1.5 dark:border-amber-800/30 dark:bg-amber-950/20">
      <span className="shrink-0 text-xs font-medium text-amber-600 dark:text-amber-400">
        available when
      </span>

      {/* Left: variable combobox */}
      <Combobox
        defaultValue={selectedVar?.name ?? left}
        onValueChange={(val: string | null) => {
          // TODO: update AST condition left expression and re-emit
          void val;
          onReemit?.();
        }}
      >
        <ComboboxInput
          placeholder="Variable..."
          className="h-6 w-48 font-mono text-xs"
        />
        <ComboboxContent>
          <ComboboxList>
            <ComboboxEmpty>No matching variables.</ComboboxEmpty>
            {variableOptions.map(option => (
              <ComboboxItem key={option.value} value={option.name}>
                <span className="font-mono text-xs">{option.value}</span>
                <span className="ml-auto rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                  {option.type}
                </span>
              </ComboboxItem>
            ))}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>

      {/* Operator dropdown */}
      <select
        value={operator}
        onChange={() => {
          // TODO: update AST condition operator and re-emit
          onReemit?.();
        }}
        className="h-6 rounded border border-amber-200/50 bg-transparent px-1.5 text-xs dark:border-amber-800/30"
      >
        {CONDITION_OPERATORS.map(op => (
          <option key={op.value} value={op.value}>
            {op.label}
          </option>
        ))}
      </select>

      {/* Right: value input (hidden for "is truthy") */}
      {operator !== 'is truthy' && (
        <Input
          defaultValue={right}
          onBlur={() => {
            // TODO: update AST condition right expression and re-emit
            onReemit?.();
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="value"
          className="h-6 w-24 font-mono text-xs"
        />
      )}

      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 shrink-0 text-muted-foreground opacity-0 group-hover/clause:opacity-100 hover:text-red-500"
        onClick={onRemove}
        title="Remove available when condition"
      >
        <VscClose className="h-3 w-3" />
      </Button>
    </div>
  );
}

function ToClauseRow({
  clause,
  topicOptions,
  onRemove,
  onReemit,
}: {
  clause: ToClause;
  topicOptions: TopicOption[];
  onRemove: () => void;
  onReemit?: () => void;
}) {
  const currentValue = emitExpr(clause.target);
  const selectedOption = topicOptions.find(t => t.value === currentValue);

  return (
    <div className="group/clause flex items-center gap-2 rounded border border-cyan-200/50 bg-cyan-50/30 px-2 py-1.5 dark:border-cyan-800/30 dark:bg-cyan-950/20">
      <span className="shrink-0 text-xs font-medium text-cyan-600 dark:text-cyan-400">
        transition to
      </span>
      <Combobox
        defaultValue={selectedOption?.name ?? currentValue}
        onValueChange={(val: string | null) => {
          // TODO: update AST target expression and re-emit
          void val;
          onReemit?.();
        }}
      >
        <ComboboxInput
          placeholder="Select topic..."
          className="h-6 flex-1 font-mono text-xs"
        />
        <ComboboxContent>
          <ComboboxList>
            <ComboboxEmpty>No matching topics.</ComboboxEmpty>
            {topicOptions.map(option => (
              <ComboboxItem key={option.value} value={option.name}>
                <span className="font-mono text-xs">{option.value}</span>
                {option.description && (
                  <span className="ml-auto max-w-48 truncate text-[10px] text-muted-foreground">
                    {option.description}
                  </span>
                )}
              </ComboboxItem>
            ))}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 shrink-0 text-muted-foreground opacity-0 group-hover/clause:opacity-100 hover:text-red-500"
        onClick={onRemove}
        title="Remove transition target"
      >
        <VscClose className="h-3 w-3" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editable description field
// ---------------------------------------------------------------------------

function DescriptionField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [localValue, setLocalValue] = useState(value);

  const commit = () => {
    if (localValue !== value) {
      onChange(localValue);
    }
  };

  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-foreground">Description</label>
      <Input
        value={localValue}
        onChange={e => setLocalValue(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder="Describe this action..."
        className="h-7 text-xs"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editable with-clause rows for builtin actions (no action definition)
// ---------------------------------------------------------------------------

function WithClauseRow({
  clause,
  onValueChange,
  onRemove,
}: {
  clause: WithClause;
  onValueChange: (newValue: string) => void;
  onRemove: () => void;
}) {
  const { display } = formatWithValue(clause.value);
  const [localValue, setLocalValue] = useState(display);

  const commit = () => {
    if (localValue !== display) {
      onValueChange(localValue);
    }
  };

  return (
    <div className="group/clause flex items-center gap-2 rounded border border-blue-200/50 bg-blue-50/30 px-2 py-1.5 dark:border-blue-800/30 dark:bg-blue-950/20">
      <span className="shrink-0 text-xs font-medium text-blue-600 dark:text-blue-400">
        with
      </span>
      <span className="w-32 shrink-0 truncate font-mono text-xs font-medium">
        {clause.param}
      </span>
      <span className="text-xs text-muted-foreground">=</span>
      <Input
        value={localValue}
        onChange={e => setLocalValue(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder="value..."
        className="h-6 flex-1 font-mono text-xs"
      />
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 shrink-0 text-muted-foreground opacity-0 group-hover/clause:opacity-100 hover:text-red-500"
        onClick={onRemove}
        title="Remove with clause"
      >
        <VscClose className="h-3 w-3" />
      </Button>
    </div>
  );
}

/** Mutate a ReasoningActionBlock's description in-place (outside component boundary). */
function mutateDescription(instance: ReasoningActionBlock, newValue: string) {
  if (instance.description) {
    (instance.description as { value: string }).value = newValue;
  } else {
    const lit = new StringLiteral(newValue);
    (instance as Record<string, unknown>).description = lit;
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface ReasoningActionCardProps {
  id: string;
  instance: ReasoningActionBlock;
  /** Topic-level action definitions for resolving input/output types */
  topicActions?: NamedMap<ActionBlock>;
  /** Available variables for output assignment combobox */
  variableOptions: VariableOption[];
  /** Available topics for transition "to" clause combobox */
  topicOptions: TopicOption[];
  allDiagnostics: Diagnostic[];
  /** Called after any edit so the document can be re-emitted */
  onReemit?: () => void;
  sortable?: boolean;
  className?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ReasoningActionCard({
  id,
  instance,
  topicActions,
  variableOptions,
  topicOptions,
  allDiagnostics,
  onReemit,
  sortable = false,
  className,
}: ReasoningActionCardProps) {
  const [collapsed, setCollapsed] = useState(false);

  const name = instance.__name ?? 'unnamed';
  const range = instance.__cst?.range;
  const blockDiags = useFieldDiagnostics(allDiagnostics, range);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !sortable });

  const style: React.CSSProperties = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    transition,
    opacity: isDragging ? 0.5 : undefined,
  };

  // Resolve the referenced action definition
  const actionDef = useMemo(
    () => resolveActionDef(instance, topicActions),
    [instance, topicActions]
  );

  // Classify statements
  const { withClauses, setClauses, toClauses, availableWhens } = useMemo(() => {
    const result = {
      withClauses: [] as WithClause[],
      setClauses: [] as SetClause[],
      toClauses: [] as ToClause[],
      availableWhens: [] as AvailableWhen[],
    };
    for (const stmt of instance.statements ?? []) {
      switch (stmt.__kind) {
        case 'WithClause':
          result.withClauses.push(stmt as WithClause);
          break;
        case 'SetClause':
          result.setClauses.push(stmt as SetClause);
          break;
        case 'ToClause':
          result.toClauses.push(stmt as ToClause);
          break;
        case 'AvailableWhen':
          result.availableWhens.push(stmt as AvailableWhen);
          break;
      }
    }
    return result;
  }, [instance.statements]);

  // Build input rows: all inputs from the action definition, with values from WithClauses
  const inputRows = useMemo(() => {
    const entries = getParamEntries(actionDef?.inputs);
    return entries.map(([paramName, paramDecl]) => {
      const withClause = withClauses.find(w => w.param === paramName);
      const valueInfo = withClause
        ? formatWithValue(withClause.value)
        : { display: '', isLlmFilled: false };
      return {
        name: paramName,
        type: getTypeName(paramDecl),
        value: valueInfo.display,
        isLlmFilled: valueInfo.isLlmFilled,
        hasValue: !!withClause,
      };
    });
  }, [actionDef, withClauses]);

  // Build output rows: all outputs from the action definition, with targets from SetClauses
  const outputRows = useMemo(() => {
    const entries = getParamEntries(actionDef?.outputs);
    return entries.map(([paramName, paramDecl]) => {
      // SetClause value references @outputs.paramName, target is the variable
      const setClause = setClauses.find(s => {
        const val = emitExpr(s.value);
        return val === `@outputs.${paramName}` || val.endsWith(`.${paramName}`);
      });
      return {
        name: paramName,
        type: getTypeName(paramDecl),
        target: setClause ? emitExpr(setClause.target) : '',
        hasTarget: !!setClause,
      };
    });
  }, [actionDef, setClauses]);

  const description =
    typeof instance.description?.value === 'string'
      ? instance.description.value
      : undefined;

  // Determine what kind of action this is
  const isTransition =
    instance.value?.object?.name === 'utils' &&
    instance.value?.property === 'transition';

  const isBuiltinAction = instance.value?.object?.name !== 'actions';

  const actionRef = emitMemberExpr(instance.value);

  // --- Mutation handlers ---
  const handleInputChange = (_paramName: string, _value: string) => {
    // TODO: mutate WithClause AST node and re-emit
    onReemit?.();
  };

  const handleOutputChange = (_paramName: string, _target: string) => {
    // TODO: mutate SetClause AST node and re-emit
    onReemit?.();
  };

  const handleDescriptionChange = useCallback(
    (newValue: string) => {
      mutateDescription(instance, newValue);
      onReemit?.();
    },
    [instance, onReemit]
  );

  /** Remove a statement by index from the instance's statements array. */
  const handleRemoveStatement = useCallback(
    (stmt: Statement) => {
      const stmts = instance.statements;
      if (!stmts) return;
      const idx = stmts.indexOf(stmt);
      if (idx !== -1) {
        stmts.splice(idx, 1);
        onReemit?.();
      }
    },
    [instance.statements, onReemit]
  );

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group/block rounded-lg border border-border/70 bg-card shadow-sm',
        isTransition &&
          'border-l-2 border-l-indigo-500 dark:border-l-indigo-400',
        isDragging && 'shadow-lg',
        className
      )}
    >
      {/* Header */}
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2 select-none',
          'hover:bg-muted/50 rounded-t-lg transition-colors',
          collapsed && 'rounded-b-lg'
        )}
      >
        {sortable && (
          <span
            className="cursor-grab text-muted-foreground hover:text-foreground"
            {...attributes}
            {...listeners}
          >
            <PiDotsSixVerticalBold className="h-4 w-4" />
          </span>
        )}
        <button
          className="flex items-center gap-1.5"
          onClick={() => setCollapsed(prev => !prev)}
        >
          {collapsed ? (
            <VscChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <VscChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span className="text-xs font-medium text-muted-foreground">
            Actions
          </span>
        </button>

        <span className="text-sm font-semibold">{name}</span>

        {isBuiltinAction && actionRef && (
          <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">
            {actionRef}
          </span>
        )}

        <DiagnosticBadge diagnostics={blockDiags} />
      </div>

      {/* Body */}
      {!collapsed && (
        <div className="space-y-3 px-3 pb-3">
          {/* Description (editable) */}
          <DescriptionField
            value={description ?? ''}
            onChange={handleDescriptionChange}
          />

          {/* Transition actions: show to/available_when */}
          {isTransition && (
            <>
              {availableWhens.map((aw, i) => (
                <AvailableWhenRow
                  key={`aw-${i}`}
                  clause={aw}
                  variableOptions={variableOptions}
                  onRemove={() => handleRemoveStatement(aw)}
                  onReemit={onReemit}
                />
              ))}
              {toClauses.map((tc, i) => (
                <ToClauseRow
                  key={`to-${i}`}
                  clause={tc}
                  topicOptions={topicOptions}
                  onRemove={() => handleRemoveStatement(tc)}
                  onReemit={onReemit}
                />
              ))}
            </>
          )}

          {/* Action invocation: show inputs/outputs */}
          {!isTransition && (
            <>
              {/* Inputs (when action definition is available) */}
              {inputRows.length > 0 && (
                <div className="space-y-1">
                  <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Inputs
                  </label>
                  <div className="rounded border border-border/50 bg-muted/20">
                    {/* Header */}
                    <div className="flex items-center gap-2 border-b border-border/30 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      <span className="w-36">Name</span>
                      <span className="w-20">Type</span>
                      <span className="flex-1">Value</span>
                    </div>
                    {/* Rows */}
                    {inputRows.map(row => (
                      <div
                        key={row.name}
                        className="flex items-center gap-2 px-2 py-1.5"
                      >
                        <span className="w-36 truncate font-mono text-xs">
                          {row.name}
                        </span>
                        <span className="w-20">
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {row.type}
                          </span>
                        </span>
                        <InputValueCell
                          value={row.value}
                          isLlmFilled={row.isLlmFilled}
                          hasValue={row.hasValue}
                          onChange={v => handleInputChange(row.name, v)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* With clauses (shown directly when no action definition) */}
              {!actionDef && withClauses.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Parameters
                  </label>
                  {withClauses.map((wc, i) => (
                    <WithClauseRow
                      key={`with-${i}`}
                      clause={wc}
                      onValueChange={_newValue => {
                        // TODO: parse expression and mutate WithClause value
                        onReemit?.();
                      }}
                      onRemove={() => handleRemoveStatement(wc)}
                    />
                  ))}
                </div>
              )}

              {/* Outputs */}
              {outputRows.length > 0 && (
                <div className="space-y-1">
                  <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    Outputs
                  </label>
                  <div className="rounded border border-border/50 bg-muted/20">
                    {/* Header */}
                    <div className="flex items-center gap-2 border-b border-border/30 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      <span className="w-36">Name</span>
                      <span className="w-20">Type</span>
                      <span className="flex-1">Assigned To</span>
                    </div>
                    {/* Rows */}
                    {outputRows.map(row => (
                      <div
                        key={row.name}
                        className="flex items-center gap-2 px-2 py-1.5"
                      >
                        <span className="w-36 truncate font-mono text-xs">
                          {row.name}
                        </span>
                        <span className="w-20">
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {row.type}
                          </span>
                        </span>
                        <OutputTargetCell
                          target={row.target}
                          outputType={row.type}
                          variableOptions={variableOptions}
                          onChange={v => handleOutputChange(row.name, v)}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Available When (for non-transition actions) */}
              {availableWhens.map((aw, i) => (
                <AvailableWhenRow
                  key={`aw-${i}`}
                  clause={aw}
                  variableOptions={variableOptions}
                  onRemove={() => handleRemoveStatement(aw)}
                  onReemit={onReemit}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
