/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

/**
 * Feature gates: boolean flags that consumers resolve themselves and pass into
 * the parse/compile pipeline. The language layer never resolves a gate.
 *
 * A gate is an opaque string id. It is open only when its value is exactly
 * `true`; an absent gate, or any other value, is closed (fail-closed).
 */
import type { FieldMetadata } from './types.js';

export type Gates = Readonly<Record<string, boolean>>;

/** Pre-release stage of a gated feature, shown to authors whose gate is open. */
export type ReleaseStage = 'pilot' | 'beta';

/** Schema metadata for a gated field, block, or value. */
export interface GateRequirement {
  /** Gate id that must be open for the feature to be allowed. */
  readonly id: string;
  readonly stage: ReleaseStage;
}

/**
 * Whether a gate is open in a (possibly undefined) resolved gate map.
 *
 * Only a literal `true` opens a gate. Gates can cross JSON boundaries (LSP
 * initializationOptions, HTTP bodies), so the value is compared rather than
 * trusted to match the `Gates` type.
 */
export function isGateOpen(gates: Gates | undefined, id: string): boolean {
  return gates?.[id] === true;
}

/**
 * Throw if a type passed into another type (a collection entry, sequence item,
 * union member, …) carries a gate. Gates are only checked at schema keys, so a
 * gate on a nested type would silently never apply (fail-open).
 */
export function assertUngated(
  type: { readonly __metadata?: FieldMetadata } | undefined,
  where: string
): void {
  if (type?.__metadata?.gatedBy || type?.__metadata?.gatedValues) {
    throw new Error(
      `${where}() cannot take a gated type: gates are only checked at schema keys, so the gate would never apply. Gate the schema key instead.`
    );
  }
}
