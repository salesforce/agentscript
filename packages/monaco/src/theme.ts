/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * AgentScript theme color definitions — SINGLE SOURCE OF TRUTH.
 *
 * All syntax highlighting colors for Monaco are defined here.
 * Monaco imports these directly.
 */

export interface TokenStyle {
  foreground?: string;
  bold?: boolean;
  italic?: boolean;
}

export interface ThemeColors {
  keyword: TokenStyle;
  'keyword.modification': TokenStyle;
  'keyword.block': TokenStyle;
  'keyword.blockName': TokenStyle;
  type: TokenStyle;
  function: TokenStyle;
  variable: TokenStyle;
  'variable.readonly.defaultLibrary': TokenStyle;
  string: TokenStyle;
  number: TokenStyle;
  operator: TokenStyle;
  comment: TokenStyle;
  namespace: TokenStyle;
  property: TokenStyle;
  decorator: TokenStyle;
  default: TokenStyle;
}

export const darkThemeColors: ThemeColors = {
  keyword: { foreground: 'c586c0', bold: true },
  'keyword.modification': { foreground: 'd7ba7d', bold: true, italic: true },
  'keyword.block': { foreground: '569cd6', bold: true },
  'keyword.blockName': { foreground: 'd7ba7d', bold: false },
  type: { foreground: '4ec9b0' },
  function: { foreground: 'dcdcaa', bold: true },
  variable: { foreground: '9cdcfe' },
  'variable.readonly.defaultLibrary': { foreground: '569cd6' },
  string: { foreground: 'ce9178' },
  number: { foreground: 'b5cea8' },
  operator: { foreground: 'd4d4d4' },
  comment: { foreground: '6a9955', italic: true },
  namespace: { foreground: '4ec9b0' },
  property: { foreground: 'd4d4d4' },
  decorator: { foreground: 'e06c75' },
  default: { foreground: 'd4d4d4' },
};

export const lightThemeColors: ThemeColors = {
  keyword: { foreground: 'A626A4', bold: true },
  'keyword.modification': { foreground: 'A626A4', bold: true, italic: true },
  'keyword.block': { foreground: '0550AE', bold: true },
  'keyword.blockName': { foreground: 'A626A4', bold: false },
  type: { foreground: '0A6577' },
  function: { foreground: 'B45309', bold: true },
  variable: { foreground: '24292F' },
  'variable.readonly.defaultLibrary': { foreground: 'A626A4', bold: true },
  string: { foreground: 'a31415' },
  number: { foreground: '7A3E00' },
  operator: { foreground: '586069' },
  comment: { foreground: '6B7783', italic: true },
  namespace: { foreground: 'a31415' },
  property: { foreground: '111dff' },
  decorator: { foreground: 'a31415' },
  default: { foreground: '24292F' },
};

/**
 * Build Monaco theme rules from color definitions.
 */
export function buildMonacoRules(
  colors: ThemeColors
): { token: string; foreground?: string; fontStyle?: string }[] {
  const rules: { token: string; foreground?: string; fontStyle?: string }[] =
    [];

  for (const [token, style] of Object.entries(colors)) {
    const fontParts: string[] = [];
    if (style.bold) fontParts.push('bold');
    if (style.italic) fontParts.push('italic');

    rules.push({
      token: token === 'default' ? '' : token,
      ...(style.foreground ? { foreground: style.foreground } : {}),
      ...(fontParts.length > 0 ? { fontStyle: fontParts.join(' ') } : {}),
    });
  }

  return rules;
}

