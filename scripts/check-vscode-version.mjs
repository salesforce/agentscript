/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * CI version gate for the AgentScript VS Code extension.
 *
 * Compares the local packages/vscode version against the versions currently
 * published on the Microsoft Marketplace and the Open VSX Registry, checked
 * INDEPENDENTLY. Emits GitHub Actions outputs so downstream steps publish to
 * each registry only when the local version is a genuine upgrade:
 *   version        local version from package.json
 *   publish_vsce   'true' | 'false'  -> MS Marketplace is behind local
 *   publish_ovsx   'true' | 'false'  -> Open VSX is behind local
 *   any            'true' | 'false'  -> either of the above is true
 *
 * A registry publishes only when local is strictly greater than its published
 * version (semver), or when nothing is published there yet. This deliberately
 * does NOT publish when local equals published (already released) or when local
 * is older (both registries reject re-publishing an existing/lower version).
 *
 * Unexpected network/HTTP errors fail the check rather than silently skipping a
 * publish.
 */

import { readFileSync, appendFileSync } from 'node:fs';

/**
 * Compare two semver-ish versions. Returns >0 if a>b, <0 if a<b, 0 if equal.
 * Handles X.Y.Z with an optional prerelease (a release outranks its prerelease)
 * and ignores build metadata. Sufficient for the extension's plain versions.
 */
function compareSemver(a, b) {
  const parse = v => {
    const [core, pre] = String(v).split('+')[0].split('-');
    const nums = core.split('.').map(n => parseInt(n, 10) || 0);
    return { nums, pre: pre ?? null };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    if ((pa.nums[i] ?? 0) !== (pb.nums[i] ?? 0)) {
      return (pa.nums[i] ?? 0) - (pb.nums[i] ?? 0);
    }
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === null) return 1; // release > prerelease
  if (pb.pre === null) return -1;
  return pa.pre < pb.pre ? -1 : 1;
}

/** True when `local` should be published over `published` (null = nothing there). */
function needsPublish(local, published) {
  return published === null || compareSemver(local, published) > 0;
}

const PUBLISHER = 'Salesforce';
const NAME = 'agent-script-language-client';
const EXTENSION_ID = `${PUBLISHER}.${NAME}`;

const pkg = JSON.parse(
  readFileSync(
    new URL('../packages/vscode/package.json', import.meta.url),
    'utf8'
  )
);
const localVersion = pkg.version;
if (!localVersion) {
  console.error('No version found in packages/vscode/package.json');
  process.exit(1);
}

/** Latest version published to Open VSX, or null if not published. */
async function openVsxVersion() {
  const res = await fetch(`https://open-vsx.org/api/${PUBLISHER}/${NAME}`, {
    headers: { Accept: 'application/json' },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Open VSX query failed: ${res.status} ${res.statusText}`);
  }
  const body = await res.json();
  // `error` is present when the namespace/extension is unknown.
  if (body.error) return null;
  return body.version ?? null;
}

/** Latest version published to the MS Marketplace, or null if not published. */
async function marketplaceVersion() {
  const res = await fetch(
    'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery',
    {
      method: 'POST',
      headers: {
        Accept: 'application/json;api-version=3.0-preview.1',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        filters: [{ criteria: [{ filterType: 7, value: EXTENSION_ID }] }],
        // Flags: IncludeVersions (0x1) | IncludeLatestVersionOnly (0x200).
        flags: 0x1 | 0x200,
      }),
    }
  );
  if (!res.ok) {
    throw new Error(
      `MS Marketplace query failed: ${res.status} ${res.statusText}`
    );
  }
  const body = await res.json();
  const ext = body?.results?.[0]?.extensions?.[0];
  if (!ext) return null;
  return ext.versions?.[0]?.version ?? null;
}

const [ovsx, vsce] = await Promise.all([
  openVsxVersion(),
  marketplaceVersion(),
]);

const publishOvsx = needsPublish(localVersion, ovsx);
const publishVsce = needsPublish(localVersion, vsce);

console.log(`Local version:      ${localVersion}`);
console.log(
  `Open VSX published: ${ovsx ?? '(none)'}  -> publish: ${publishOvsx}`
);
console.log(
  `MS Marketplace:     ${vsce ?? '(none)'}  -> publish: ${publishVsce}`
);

const out = process.env.GITHUB_OUTPUT;
if (out) {
  appendFileSync(
    out,
    [
      `version=${localVersion}`,
      `publish_ovsx=${publishOvsx}`,
      `publish_vsce=${publishVsce}`,
      `any=${publishOvsx || publishVsce}`,
      '',
    ].join('\n')
  );
}
