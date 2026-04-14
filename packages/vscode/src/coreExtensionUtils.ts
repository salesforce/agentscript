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
