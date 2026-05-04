/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import type { ReactNode } from 'react';
import {
  Settings,
  Cog,
  Variable,
  Play,
  BookOpen,
  Link,
  Hash,
  GitPullRequest,
  Languages,
  Users,
} from 'lucide-react';

export interface BlockTypeConfig {
  icon: ReactNode;
  iconBg: string;
  iconClassName: string;
  subtitle?: string;
}

/**
 * Single source of truth for block type visual configuration
 * Used by: Canvas graph nodes, Explorer tree, BlockNote headers
 */
export function getBlockTypeConfig(
  blockType: string,
  options?: {
    isStartAgent?: boolean;
    iconSize?: number;
  }
): BlockTypeConfig {
  const { isStartAgent = false, iconSize = 16 } = options || {};

  // Special case: start_agent — uses intelligence (indigo) color, it makes routing decisions
  if (
    (blockType === 'topic' ||
      blockType === 'start_agent' ||
      blockType === 'subagent') &&
    isStartAgent
  ) {
    return {
      icon: (
        <GitPullRequest
          size={iconSize}
          className="text-indigo-500 dark:text-indigo-400"
        />
      ),
      iconClassName: 'text-indigo-500 dark:text-indigo-400',
      iconBg: 'rgba(99,102,241,0.40)',
      subtitle: 'Start Agent',
    };
  }

  // Block type configurations
  const configs: Record<
    string,
    Omit<BlockTypeConfig, 'icon'> & { iconComponent: typeof Hash }
  > = {
    system: {
      iconComponent: Settings,
      iconClassName: 'text-blue-600',
      iconBg: '#dbeafe',
    },
    config: {
      iconComponent: Cog,
      iconClassName: 'text-purple-600',
      iconBg: '#f3e8ff',
    },
    variables: {
      iconComponent: Variable,
      iconClassName: 'text-orange-600',
      iconBg: '#fed7aa',
    },
    actions: {
      iconComponent: Play,
      iconClassName: 'text-green-600',
      iconBg: '#d1fae5',
    },
    knowledge: {
      iconComponent: BookOpen,
      iconClassName: 'text-teal-600',
      iconBg: '#ccfbf1',
      subtitle: 'Knowledge',
    },
    knowledge_action: {
      iconComponent: BookOpen,
      iconClassName: 'text-teal-600',
      iconBg: '#ccfbf1',
    },
    language: {
      iconComponent: Languages,
      iconClassName: 'text-indigo-600',
      iconBg: '#e0e7ff',
    },
    connection: {
      iconComponent: Link,
      iconClassName: 'text-cyan-600',
      iconBg: '#cffafe',
      subtitle: 'Connection',
    },
    topic: {
      iconComponent: Hash,
      iconClassName: 'text-sky-500 dark:text-sky-400',
      iconBg: 'rgba(14,165,233,0.35)',
      subtitle: 'Topic',
    },
    subagent: {
      iconComponent: Hash,
      iconClassName: 'text-sky-500 dark:text-sky-400',
      iconBg: 'rgba(14,165,233,0.35)',
      subtitle: 'Subagent',
    },
    start_agent: {
      iconComponent: GitPullRequest,
      iconClassName: 'text-indigo-500 dark:text-indigo-400',
      iconBg: 'rgba(99,102,241,0.40)',
      subtitle: 'Start Agent',
    },
    related_agent: {
      iconComponent: Users,
      iconClassName: 'text-rose-600',
      iconBg: '#ffe4e6',
      subtitle: 'Related Agent',
    },
  };

  const config = configs[blockType];

  if (config) {
    const IconComponent = config.iconComponent;
    return {
      icon: <IconComponent size={iconSize} className={config.iconClassName} />,
      iconClassName: config.iconClassName,
      iconBg: config.iconBg,
      subtitle: config.subtitle,
    };
  }

  // Default fallback
  return {
    icon: <Hash size={iconSize} className="text-gray-600" />,
    iconClassName: 'text-gray-600',
    iconBg: '#f3f4f6',
    subtitle: blockType,
  };
}
