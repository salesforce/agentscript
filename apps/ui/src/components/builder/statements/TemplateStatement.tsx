/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { TemplateEditor } from '../fields/TemplateEditor';
import { cn } from '~/lib/utils';

interface TemplateStatementProps {
  content: string;
  onChange: (content: string) => void;
  className?: string;
}

/**
 * Editor for Template statements (|text with {!expr} interpolations).
 * Uses the rich TemplateEditor with inline expression pills.
 */
export function TemplateStatement({
  content,
  onChange,
  className,
}: TemplateStatementProps) {
  return (
    <TemplateEditor
      content={content}
      onChange={onChange}
      placeholder="Template text&#8230; Press &#8984;E for expression"
      className={cn(className)}
    />
  );
}
