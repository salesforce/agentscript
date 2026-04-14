/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Icon configuration for CST debug nodes
 * Maps node types to appropriate icons from react-icons
 */

import React from 'react';
import {
  Box,
  Hash,
  KeyRound,
  Quote,
  ToggleLeft,
  Variable,
  Sigma,
  PuzzleIcon,
  FunctionSquare,
  Tag,
  FileCode2,
  Type,
  Snowflake,
  Code,
  Ruler,
  Shapes,
  MessageSquare,
  ArrowRight,
  GitCompare,
  Beaker,
  Link,
  Play,
  Pencil,
  Circle,
  TriangleAlert,
  CircleAlert,
  Brackets,
} from 'lucide-react';

interface IconConfig {
  icon: React.ReactElement;
  iconClassName: string;
  iconBg: string;
  category:
    | 'structural'
    | 'literal'
    | 'operator'
    | 'keyword'
    | 'token'
    | 'other';
}

/**
 * Get icon configuration for a CST node type
 */
export function getCstNodeIcon(
  nodeType: string,
  options: {
    isNamed?: boolean;
    hasError?: boolean;
    isMissing?: boolean;
    iconSize?: number;
  } = {}
): IconConfig {
  const {
    isNamed = false,
    hasError = false,
    isMissing = false,
    iconSize = 14,
  } = options;

  // Error state takes precedence
  if (hasError) {
    return {
      icon: <CircleAlert size={iconSize} />,
      iconClassName: 'text-red-600 dark:text-red-400',
      iconBg: '#fee',
      category: 'other',
    };
  }

  // Missing node state
  if (isMissing) {
    return {
      icon: <TriangleAlert size={iconSize} />,
      iconClassName: 'text-orange-600 dark:text-orange-400',
      iconBg: '#ffedcc',
      category: 'other',
    };
  }

  // Structural nodes
  if (nodeType === 'source_file') {
    return {
      icon: <FileCode2 size={iconSize} />,
      iconClassName: 'text-blue-600',
      iconBg: '#e3f2fd',
      category: 'structural',
    };
  }

  if (nodeType === 'block') {
    return {
      icon: <Box size={iconSize} />,
      iconClassName: 'text-purple-600',
      iconBg: '#f3e5f5',
      category: 'structural',
    };
  }

  if (nodeType === 'field') {
    return {
      icon: <Hash size={iconSize} />,
      iconClassName: 'text-blue-500',
      iconBg: '#e3f2fd',
      category: 'structural',
    };
  }

  if (nodeType === 'statement') {
    return {
      icon: <FunctionSquare size={iconSize} />,
      iconClassName: 'text-green-600',
      iconBg: '#e8f5e9',
      category: 'structural',
    };
  }

  if (nodeType === 'clause') {
    return {
      icon: <PuzzleIcon size={iconSize} />,
      iconClassName: 'text-teal-600',
      iconBg: '#e0f2f1',
      category: 'structural',
    };
  }

  // Literals
  if (
    nodeType === 'string' ||
    nodeType === 'template_content' ||
    nodeType === 'text'
  ) {
    return {
      icon: <Quote size={iconSize} />,
      iconClassName: 'text-orange-600',
      iconBg: '#fff3e0',
      category: 'literal',
    };
  }

  if (nodeType === 'number') {
    return {
      icon: <Hash size={iconSize} />,
      iconClassName: 'text-green-700',
      iconBg: '#f1f8e9',
      category: 'literal',
    };
  }

  if (nodeType === 'boolean' || nodeType === 'True' || nodeType === 'False') {
    return {
      icon: <ToggleLeft size={iconSize} />,
      iconClassName: 'text-blue-700',
      iconBg: '#e1f5fe',
      category: 'literal',
    };
  }

  if (nodeType === 'null' || nodeType === 'None') {
    return {
      icon: <Snowflake size={iconSize} />,
      iconClassName: 'text-gray-600',
      iconBg: '#f5f5f5',
      category: 'literal',
    };
  }

  // Identifiers and references
  if (nodeType === 'identifier' || nodeType === 'block_type') {
    return {
      icon: <KeyRound size={iconSize} />,
      iconClassName: 'text-indigo-600',
      iconBg: '#e8eaf6',
      category: 'other',
    };
  }

  if (nodeType === 'variable_ref') {
    return {
      icon: <Variable size={iconSize} />,
      iconClassName: 'text-purple-500',
      iconBg: '#f3e5f5',
      category: 'other',
    };
  }

  // Expressions
  if (nodeType === 'expression' || nodeType === 'value') {
    return {
      icon: <Brackets size={iconSize} />,
      iconClassName: 'text-amber-600',
      iconBg: '#fff8e1',
      category: 'other',
    };
  }

  if (
    nodeType === 'comparison_expression' ||
    nodeType === 'logical_expression'
  ) {
    return {
      icon: <GitCompare size={iconSize} />,
      iconClassName: 'text-cyan-600',
      iconBg: '#e0f7fa',
      category: 'other',
    };
  }

  // Operators
  if (
    nodeType === '=' ||
    nodeType === '==' ||
    nodeType === '!=' ||
    nodeType === '<=' ||
    nodeType === 'logical_operator'
  ) {
    return {
      icon: <Sigma size={iconSize} />,
      iconClassName: 'text-pink-600',
      iconBg: '#fce4ec',
      category: 'operator',
    };
  }

  // Keywords
  if (
    nodeType === 'if' ||
    nodeType === 'else' ||
    nodeType === 'else_clause' ||
    nodeType === 'when' ||
    nodeType === 'and'
  ) {
    return {
      icon: <Type size={iconSize} />,
      iconClassName: 'text-pink-700',
      iconBg: '#fce4ec',
      category: 'keyword',
    };
  }

  if (nodeType === 'transition' || nodeType === 'to') {
    return {
      icon: <ArrowRight size={iconSize} />,
      iconClassName: 'text-blue-600',
      iconBg: '#e3f2fd',
      category: 'keyword',
    };
  }

  if (nodeType === 'run' || nodeType === 'set') {
    return {
      icon: <Play size={iconSize} />,
      iconClassName: 'text-green-600',
      iconBg: '#e8f5e9',
      category: 'keyword',
    };
  }

  // Type system
  if (nodeType === 'type' || nodeType === 'simple_type') {
    return {
      icon: <Tag size={iconSize} />,
      iconClassName: 'text-teal-700',
      iconBg: '#e0f2f1',
      category: 'other',
    };
  }

  // Variable modifiers
  if (
    nodeType === 'variable_modifier' ||
    nodeType === 'mutable' ||
    nodeType === 'available'
  ) {
    return {
      icon: <Pencil size={iconSize} />,
      iconClassName: 'text-amber-700',
      iconBg: '#fff8e1',
      category: 'keyword',
    };
  }

  // Special features
  if (nodeType === 'linked' || nodeType === 'with') {
    return {
      icon: <Link size={iconSize} />,
      iconClassName: 'text-blue-500',
      iconBg: '#e3f2fd',
      category: 'keyword',
    };
  }

  if (nodeType === 'slot_filled') {
    return {
      icon: <Beaker size={iconSize} />,
      iconClassName: 'text-purple-600',
      iconBg: '#f3e5f5',
      category: 'keyword',
    };
  }

  if (nodeType === 'placeholder') {
    return {
      icon: <Code size={iconSize} />,
      iconClassName: 'text-gray-500',
      iconBg: '#fafafa',
      category: 'other',
    };
  }

  // Comments
  if (nodeType === 'comment') {
    return {
      icon: <MessageSquare size={iconSize} />,
      iconClassName: 'text-gray-500',
      iconBg: '#f5f5f5',
      category: 'other',
    };
  }

  // Special arrow token
  if (nodeType === 'ARROW') {
    return {
      icon: <ArrowRight size={iconSize} />,
      iconClassName: 'text-gray-400',
      iconBg: '#fafafa',
      category: 'token',
    };
  }

  // Quote marks
  if (nodeType === '"') {
    return {
      icon: <Quote size={iconSize} />,
      iconClassName: 'text-orange-400',
      iconBg: '#fafafa',
      category: 'token',
    };
  }

  // Indentation tokens
  if (nodeType === 'INDENT' || nodeType === 'DEDENT') {
    return {
      icon: <Ruler size={iconSize} />,
      iconClassName: 'text-gray-300',
      iconBg: '#fafafa',
      category: 'token',
    };
  }

  // Other tokens and punctuation
  if (
    nodeType === 'NEWLINE' ||
    nodeType === 'newline' ||
    nodeType === 'PIPE' ||
    nodeType === '.' ||
    nodeType === ':' ||
    nodeType === '@'
  ) {
    return {
      icon: <Circle size={iconSize} />,
      iconClassName: 'text-gray-400',
      iconBg: '#fafafa',
      category: 'token',
    };
  }

  // Default for unnamed nodes or unknown types
  if (!isNamed) {
    return {
      icon: <Circle size={iconSize} />,
      iconClassName: 'text-gray-400',
      iconBg: '#fafafa',
      category: 'token',
    };
  }

  // Default fallback for named nodes
  return {
    icon: <Shapes size={iconSize} />,
    iconClassName: 'text-gray-600',
    iconBg: '#f5f5f5',
    category: 'other',
  };
}

/**
 * Get a human-readable category name for display
 */
export function getCategoryName(category: IconConfig['category']): string {
  switch (category) {
    case 'structural':
      return 'Structure';
    case 'literal':
      return 'Literal';
    case 'operator':
      return 'Operator';
    case 'keyword':
      return 'Keyword';
    case 'token':
      return 'Token';
    case 'other':
      return 'Other';
  }
}
