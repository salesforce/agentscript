/*
 * Copyright (c) 2026, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 * For full license text, see the LICENSE file in the repo root or https://www.apache.org/licenses/LICENSE-2.0
 */

import * as vscode from 'vscode';
import type { TelemetryService } from './telemetry';

export interface CoreExtensionExports {
  services: {
    TelemetryService: {
      getInstance(name: string): TelemetryService;
    };
  };
}

const CORE_EXTENSION_ID = 'salesforce.salesforcedx-vscode-core';

let coreExtension: vscode.Extension<CoreExtensionExports> | undefined;

export const getCoreExtension = async (): Promise<
  vscode.Extension<CoreExtensionExports>
> => {
  if (!coreExtension) {
    coreExtension =
      vscode.extensions.getExtension<CoreExtensionExports>(CORE_EXTENSION_ID);
    if (!coreExtension) {
      throw new Error('Salesforce core extension not found');
    }
  }
  if (!coreExtension.isActive) {
    await coreExtension.activate();
  }
  return coreExtension;
};
