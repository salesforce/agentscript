/*
 * Copyright 2026 Salesforce Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'AgentScript',
  tagline:
    'A powerful language for building AI agents. An open source project by Salesforce.',
  favicon: undefined,

  // Set the production url of your site here
  url: 'https://TBD', // TODO: set final public docs URL before launch
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: process.env.DOCS_BASE_PATH || '/',

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: 'agentscript', // Usually your GitHub org/user name.
  projectName: 'agentscript', // Usually your repo name.

  onBrokenLinks: 'warn',

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          // Please change this to your repo.
          // Remove this to remove the "edit this page" links.
          editUrl:
            'https://github.com/salesforce/agentscript/tree/main/apps/docs/',
        },
        blog: false,
        debug: false, // Disable debug plugin to avoid build errors
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  plugins: [
    [
      'docusaurus-plugin-typedoc',
      {
        // TypeDoc options - aggregate from multiple packages
        entryPoints: [
          '../../packages/language/src/index.ts',
          '../../packages/monaco/src/index.ts',
        ],
        entryPointStrategy: 'expand',
        tsconfig: './tsconfig.typedoc.json',
        skipErrorChecking: true,
        out: 'docs/api',
        plugin: ['typedoc-plugin-markdown'],

        // Docusaurus plugin options
        sidebar: {
          categoryLabel: 'API Reference',
          position: 4,
        },

        // TypeDoc configuration
        name: 'AgentScript API',
        readme: 'none',
        hideGenerator: true,
        excludePrivate: true,
        excludeProtected: false,
        excludeExternals: true,
        excludeNotDocumented: false,

        // Markdown options
        hidePageHeader: false,

        // Navigation and organization
        categorizeByGroup: true,
        groupOrder: [
          'Classes',
          'Interfaces',
          'Type Aliases',
          'Enumerations',
          'Functions',
          'Variables',
          '*',
        ],
      },
    ],
  ],

  themeConfig: {
    navbar: {
      title: 'AgentScript',
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'tutorialSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          href: 'https://github.com/salesforce/agentscript',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Getting Started',
              to: '/getting-started/quickstart',
            },
            {
              label: 'Architecture',
              to: '/architecture/overview',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/salesforce/agentscript',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'Contributing',
              to: '/contributing/setup',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Salesforce, Inc. An open source project owned and sponsored by Salesforce.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'typescript'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
