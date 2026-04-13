/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Content panel for the node detail drawer.
 * Shows contextual information based on the node type:
 * - Templates: full instruction text
 * - Transitions: target topic with navigation
 * - Conditionals: condition expression
 * - Phases: role description and hook status
 * - LLM: available reasoning actions
 * - Run/Set: target reference and value
 */

import { useParams, useNavigate } from 'react-router';
import {
  FileText,
  ArrowRight,
  ShieldCheck,
  Play,
  Layers,
  Variable,
  RotateCw,
  Sparkles,
  Zap,
} from 'lucide-react';
import type { NodeDrawerData, PhaseType } from '~/lib/ast-to-graph';
import { useAppStore } from '~/store';

interface NodeDrawerContentProps {
  data: NodeDrawerData;
}

export function NodeDrawerContent({ data }: NodeDrawerContentProps) {
  return (
    <div className="flex flex-col gap-4 px-4 pb-4 pt-2">
      {/* Type badge */}
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:bg-gray-800 dark:text-gray-400">
          {nodeTypeBadge(data.nodeType)}
        </span>
      </div>

      {/* Template: full text */}
      {data.nodeType === 'template' && (
        <Section icon={<FileText size={12} />} title="Template Content">
          <div className="whitespace-pre-wrap rounded-lg bg-gray-50 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-gray-700 dark:bg-gray-800/50 dark:text-gray-300">
            {data.label}
          </div>
        </Section>
      )}

      {/* Conditional: full condition expression */}
      {data.nodeType === 'conditional' && data.conditionText && (
        <Section icon={<ShieldCheck size={12} />} title="Condition">
          <div className="rounded-lg bg-amber-50 px-3 py-2.5 font-mono text-[11px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            {data.conditionText}
          </div>
        </Section>
      )}

      {/* Transition: target topic with navigation */}
      {data.nodeType === 'transition' && data.transitionTarget && (
        <TransitionSection target={data.transitionTarget} />
      )}

      {/* Phase info */}
      {(data.nodeType === 'phase' || data.nodeType === 'phase-label') &&
        data.phaseType && (
          <PhaseSection
            phaseType={data.phaseType}
            isEmpty={data.isEmpty}
            label={data.label}
          />
        )}

      {/* LLM: available actions */}
      {data.nodeType === 'llm' &&
        data.actionNames &&
        data.actionNames.length > 0 && (
          <LlmActionsSection
            actionNames={data.actionNames}
            actionKeys={data.actionKeys}
            topicName={data.topicName}
          />
        )}

      {/* Run node: target reference */}
      {data.nodeType === 'run' && (
        <Section icon={<Zap size={12} />} title="Action Reference">
          <div className="rounded-lg bg-blue-50 px-3 py-2.5 font-mono text-[11px] text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">
            {data.subtitle && `${data.subtitle}.`}
            {data.label}
          </div>
        </Section>
      )}

      {/* Set node: variable and value */}
      {data.nodeType === 'set' && (
        <Section icon={<Variable size={12} />} title="Assignment">
          <div className="flex flex-col gap-1.5">
            <div className="rounded-lg bg-gray-50 px-3 py-2 font-mono text-[11px] dark:bg-gray-800/50">
              <span className="text-purple-600 dark:text-purple-400">
                {data.label}
              </span>
              <span className="text-gray-400"> = </span>
              <span className="text-gray-700 dark:text-gray-300">
                {data.subtitle}
              </span>
            </div>
          </div>
        </Section>
      )}

      {/* Build Instructions */}
      {data.nodeType === 'build-instructions' && (
        <Section icon={<Layers size={12} />} title="Purpose">
          <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            Collects and assembles all instruction templates before passing them
            to the Agent Reasoning step.
          </p>
        </Section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-sections
// ---------------------------------------------------------------------------

function TransitionSection({ target }: { target: string }) {
  const { agentId } = useParams();
  const navigate = useNavigate();

  const displayName = target
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

  return (
    <Section icon={<ArrowRight size={12} />} title="Target Topic">
      <button
        type="button"
        onClick={() => void navigate(`/agents/${agentId}/graph/${target}`)}
        className="group flex w-full items-center justify-between rounded-lg bg-gray-50 px-3 py-2.5 text-left transition-colors hover:bg-gray-100 dark:bg-gray-800/50 dark:hover:bg-gray-700/50"
      >
        <div>
          <div className="text-xs font-medium text-gray-800 dark:text-gray-200">
            {displayName}
          </div>
          <div className="font-mono text-[10px] text-gray-400">
            @topic.{target}
          </div>
        </div>
        <ArrowRight
          size={14}
          className="text-gray-400 transition-transform group-hover:translate-x-0.5"
        />
      </button>
    </Section>
  );
}

function PhaseSection({
  phaseType,
  isEmpty,
  label,
}: {
  phaseType: PhaseType;
  isEmpty?: boolean;
  label: string;
}) {
  const descriptions: Record<PhaseType, string> = {
    'topic-header': `This is the entry point for the ${label} topic. It defines the topic's label, description, and routing configuration.`,
    before_reasoning:
      'Runs once per turn before the reasoning loop begins. Used for setting variables, running lookups, or other preparation steps.',
    after_reasoning:
      'Runs once per turn after the reasoning loop completes. Used for cleanup, setting variables, or transitions.',
    before_reasoning_iteration:
      'Runs at the start of each reasoning iteration within the loop. Used for building dynamic instructions from templates.',
  };

  return (
    <Section icon={<RotateCw size={12} />} title="Phase">
      <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
        {descriptions[phaseType]}
      </p>
      {isEmpty && (
        <div className="mt-2 rounded-md bg-gray-100 px-2.5 py-1.5 text-[11px] text-gray-400 dark:bg-gray-800/50">
          No hooks configured
        </div>
      )}
    </Section>
  );
}

function LlmActionsSection({
  actionNames,
  actionKeys,
  topicName,
}: {
  actionNames: string[];
  actionKeys?: string[];
  topicName?: string;
}) {
  const openActionDrawer = useAppStore(state => state.openActionDrawer);

  return (
    <Section icon={<Sparkles size={12} />} title="Available Actions">
      <div className="flex flex-col gap-1.5">
        {actionNames.map((name, index) => (
          <button
            key={actionKeys?.[index] ?? name}
            type="button"
            onClick={() =>
              openActionDrawer({
                actionDisplayName: name,
                actionIndex: index,
                topicName,
              })
            }
            className="group flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-left transition-colors hover:bg-indigo-100 dark:bg-indigo-950/30 dark:hover:bg-indigo-900/40"
          >
            <Play size={10} className="text-indigo-500 dark:text-indigo-400" />
            <span className="text-xs font-medium text-indigo-700 dark:text-indigo-300">
              {name}
            </span>
          </button>
        ))}
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

function nodeTypeBadge(nodeType: string): string {
  const map: Record<string, string> = {
    phase: 'Phase',
    'phase-label': 'Phase',
    template: 'Template',
    conditional: 'Conditional',
    transition: 'Transition',
    run: 'Action',
    set: 'Variable',
    llm: 'LLM',
    'build-instructions': 'Build Step',
  };
  return map[nodeType] ?? nodeType;
}

/** Compute drawer title for a node. */
export function nodeDrawerTitle(data: NodeDrawerData): string {
  switch (data.nodeType) {
    case 'template':
      return 'Template';
    case 'llm':
      return 'Agent Reasoning';
    case 'build-instructions':
      return 'Build Instructions';
    default:
      return data.label;
  }
}

/** Compute drawer subtitle for a node. */
export function nodeDrawerSubtitle(data: NodeDrawerData): string {
  switch (data.nodeType) {
    case 'phase':
    case 'phase-label':
      return data.subtitle ?? 'Phase';
    case 'template':
      return 'Instruction template';
    case 'conditional':
      return data.conditionLabel ?? 'Condition';
    case 'transition':
      return 'Transition';
    case 'run':
      return data.subtitle ?? 'Action';
    case 'set':
      return 'Variable assignment';
    case 'llm':
      return 'Selects and executes tools';
    case 'build-instructions':
      return 'Collects template outputs';
    default:
      return data.subtitle ?? '';
  }
}
