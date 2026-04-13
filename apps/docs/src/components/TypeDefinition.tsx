/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Component to display type definitions from source code
 *
 * Usage in MDX:
 * ```mdx
 * import TypeDefinition from '@site/src/components/TypeDefinition';
 *
 * <TypeDefinition name="LinterRule" />
 * ```
 */

import React from 'react';
import CodeBlock from '@theme/CodeBlock';
import extractedTypes from '../data/extracted-types.json';

interface TypeDefinitionProps {
  name: string;
  language?: string;
  showSource?: boolean;
}

export default function TypeDefinition({
  name,
  language = 'typescript',
  showSource = true,
}: TypeDefinitionProps) {
  const typeInfo = extractedTypes[name];

  if (!typeInfo) {
    return (
      <div className="alert alert--danger">
        <strong>Error:</strong> Type definition "{name}" not found. Available
        types: {Object.keys(extractedTypes).join(', ')}
      </div>
    );
  }

  const title = showSource
    ? `${typeInfo.kind} ${name} (${typeInfo.file}:${typeInfo.line})`
    : `${typeInfo.kind} ${name}`;

  return (
    <CodeBlock language={language} title={title} showLineNumbers>
      {typeInfo.code}
    </CodeBlock>
  );
}
